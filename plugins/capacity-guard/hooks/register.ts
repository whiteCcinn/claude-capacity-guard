import type { EngineInterface, On, PluginOptions, SessionRateLimit, TurnStepInput, TurnStepResult } from "claude-code"
import { capacityDecision, describeWindows, guardSettings, validWindows } from "./policy"
import type { GuardSettings } from "./policy"
import { mergeWindows, savedCheckpoint } from "./checkpoint"
import type { Checkpoint } from "./checkpoint"
import type { TeamMember } from "../types"
import { captureTeam, MAX_TEAM_MEMBERS, teamAllows, teamSummary } from "./team"

type Runtime = {
  settings: GuardSettings
  interactive: boolean
  sessionId?: string
  mainTurn?: string
  abortingTurn?: string
  checkpoint?: Checkpoint
  epoch: number
  busy: boolean
  pausing: boolean
  saving: Promise<void>
  timer?: { cancel(): void }
  inputPending: number
  immediate?: { cancel(): void }
  kick?: () => void
}

const CHECKPOINT = { plugin: "capacity-guard", key: "checkpoint" } as const

function stopped(e: TurnStepInput): TurnStepResult {
  return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: null, usage: null }
}

// Serialize the durable writes too: cancelling during an earlier write must
// leave a tombstone last, rather than resurrecting an obsolete checkpoint.
async function persist($: EngineInterface, runtime: Runtime): Promise<void> {
  const key = runtime.sessionId ? `pause:${runtime.sessionId}` : undefined
  if (!key) throw new Error("Session identity unavailable")
  const value = runtime.checkpoint ? { ...runtime.checkpoint } : null
  const previous = runtime.saving
  const writing = (async () => {
    await previous.catch(() => {})
    const result = await $.state.set(CHECKPOINT, value)
    if (!result.isSet) throw new Error("Live checkpoint write refused")
    await $.store.set(key, value)
  })()
  runtime.saving = writing
  await writing
}

function pauseStatus(checkpoint: Checkpoint): string {
  const detail = describeWindows(checkpoint.windows)
  const team = checkpoint.team ? ` ${teamSummary(checkpoint.team)}` : ""
  if (checkpoint.phase === "manual") return `任务已暂停，需手动继续。${checkpoint.note ?? ""} ${detail}${team}`
  if (checkpoint.phase === "submitting") return "额度守卫正在提交继续指令。"
  return `任务已暂停。${detail}。${checkpoint.resumeAt === null ? "尚无有效重置时间，继续等待用量数据。" : `将在 ${new Date(checkpoint.resumeAt).toLocaleString()} 之后继续。`}${team} /capacity cancel 可取消等待。`
}

function owned(runtime: Runtime, epoch: number, token: string): boolean {
  return runtime.epoch === epoch && runtime.checkpoint?.token === token
}

async function memberState($: EngineInterface, runtime: Runtime, id: string, state: TeamMember["state"]): Promise<void> {
  const held = runtime.checkpoint
  if (!held?.team) return
  runtime.checkpoint = { ...held, team: { ...held.team, members: held.team.members.map(m => m.id === id ? { ...m, state } : m) } }
  await persist($, runtime)
}

async function stopTeam($: EngineInterface, runtime: Runtime, epoch: number, token: string): Promise<void> {
  // Every native control originates from the main session's timer, never
  // from a member trying to stop the hook it is currently executing.
  for (let scan = 0; scan < 4; scan++) {
    if (!owned(runtime, epoch, token)) return
    const team = runtime.checkpoint?.team
    if (!team) return
    for (const member of team.members) {
      if (!owned(runtime, epoch, token)) return
      if (member.state !== "pending") continue
      await memberState($, runtime, member.id, "stopping")
      if (!owned(runtime, epoch, token)) return
      try {
        const result = await $.tool.call({ tool: "TaskStop", task_id: member.id })
        if (!owned(runtime, epoch, token)) return
        const confirmed = !result.deny && !result.isError && typeof result.result === "object" && result.result !== null && "task_id" in result.result && typeof result.result.task_id === "string" && "task_type" in result.result && typeof result.result.task_type === "string"
        await memberState($, runtime, member.id, confirmed ? "stopped" : "stop_failed")
      } catch {
        if (!owned(runtime, epoch, token)) return
        await memberState($, runtime, member.id, "uncertain")
      }
    }
    const current = captureTeam(await $.agent.list())
    if (!owned(runtime, epoch, token)) return
    const held = runtime.checkpoint!
    const additions = current?.members.filter(m => !held.team!.members.some(old => old.id === m.id)) ?? []
    if (held.team!.members.length + additions.length > MAX_TEAM_MEMBERS) throw new Error("Team roster exceeds the coordination limit")
    if (additions.length) {
      runtime.checkpoint = { ...held, team: { phase: "pausing", members: [...held.team!.members, ...additions] } }
      await persist($, runtime)
      continue
    }
    if (held.team!.members.some(m => m.resume && m.state !== "stopped")) throw new Error("Not every active member confirmed stopping")
    runtime.checkpoint = { ...held, team: { ...held.team!, phase: "paused" } }
    await persist($, runtime)
    showStatus($, pauseStatus(runtime.checkpoint))
    return
  }
  throw new Error("Team roster did not settle")
}

async function resumeTeam($: EngineInterface, runtime: Runtime, epoch: number, token: string): Promise<boolean> {
  const held = runtime.checkpoint
  if (!held?.team) return true
  runtime.checkpoint = { ...held, team: { ...held.team, phase: "resuming" } }
  await persist($, runtime)
  for (const member of held.team.members) {
    if (!owned(runtime, epoch, token)) return false
    if (!member.resume || member.state === "sent") continue
    if (member.state !== "stopped" && member.state !== "resume_failed") throw new Error("Unconfirmed team member state")
    await memberState($, runtime, member.id, "sending")
    if (!owned(runtime, epoch, token)) return false
    try {
      const result = await $.session.send({ to: { agentId: member.id }, text: runtime.settings.resumeText })
      if (!owned(runtime, epoch, token)) return false
      await memberState($, runtime, member.id, result.isDelivered ? "sent" : "resume_failed")
      if (!result.isDelivered) throw new Error("Team continuation was refused")
    } catch (error) {
      if (!owned(runtime, epoch, token)) return false
      if (runtime.checkpoint?.team?.members.find(m => m.id === member.id)?.state === "sending") await memberState($, runtime, member.id, "uncertain")
      throw error
    }
  }
  return owned(runtime, epoch, token)
}

function showStatus($: EngineInterface, text: string | undefined): void {
  try { $.ui.status(text) } catch { /* Presentation must not change admission. */ }
}

async function clearCheckpoint($: EngineInterface, runtime: Runtime): Promise<void> {
  runtime.epoch++
  runtime.pausing = false
  runtime.checkpoint = undefined
  await persist($, runtime)
  showStatus($, undefined)
}

async function refresh($: EngineInterface, runtime: Runtime): Promise<void> {
  if (runtime.busy || runtime.inputPending || !runtime.interactive || !runtime.settings.enabled || runtime.checkpoint?.phase !== "waiting") return
  if (runtime.mainTurn && runtime.checkpoint.team?.phase !== "pausing") return
  runtime.busy = true
  const epoch = runtime.epoch
  const held = runtime.checkpoint
  try {
    if (held.team?.phase === "pausing") {
      await stopTeam($, runtime, epoch, held.token)
      return
    }
    const usage = await $.session.usage()
    const now = await $.clock.now()
    if (epoch !== runtime.epoch || runtime.checkpoint !== held || runtime.inputPending) return
    // An empty cache while already paused is unknown, never evidence of a reset.
    const current = validWindows(usage.rateLimits)
    if (!current.length) { showStatus($, "任务保持暂停：暂时没有有效原生额度读数。"); return }
    const decision = capacityDecision(mergeWindows(held.windows, current), now, runtime.settings)
    if (decision.blocked) {
      runtime.checkpoint = { ...held, windows: decision.windows, resumeAt: decision.resumeAt }
      if (JSON.stringify(runtime.checkpoint) !== JSON.stringify(held)) await persist($, runtime)
      if (epoch === runtime.epoch && runtime.checkpoint) showStatus($, pauseStatus(runtime.checkpoint))
      return
    }
    // A changed reading can free the quota early. A cached expired reading
    // permits one real continuation after its server-provided reset + buffer.
    if (held.team && !await resumeTeam($, runtime, epoch, held.token)) return
    if (!owned(runtime, epoch, held.token)) return
    runtime.checkpoint = { ...runtime.checkpoint!, phase: "submitting" }
    await persist($, runtime)
    if (epoch !== runtime.epoch || runtime.inputPending || runtime.checkpoint?.token !== held.token) return
    showStatus($, "额度等待已结束，正在继续原任务。")
    // Do not await a queued prompt inside a running-turn event. This helper
    // only runs in a timer callback or an immediate command while idle.
    const result = await $.prompt.submit({ text: runtime.settings.resumeText })
    if (epoch !== runtime.epoch || runtime.checkpoint?.token !== held.token) return
    if (result.drop !== undefined) {
      runtime.checkpoint = { ...runtime.checkpoint!, phase: "manual", note: "继续指令被拒绝或取消；请检查会话后输入继续。" }
      await persist($, runtime)
      showStatus($, pauseStatus(runtime.checkpoint))
    } else await clearCheckpoint($, runtime)
  } catch {
    if (epoch !== runtime.epoch || !runtime.checkpoint) return
    if (runtime.checkpoint.team || runtime.checkpoint.phase === "submitting") {
      runtime.checkpoint = { ...runtime.checkpoint, phase: "manual", note: runtime.checkpoint.team ? "队伍控制未全部确认；已保留逐成员状态，请检查 /capacity。" : "无法确认继续指令是否已接收；为避免重复，不会自动重试。" }
      try { await persist($, runtime) } catch { /* A persisted submitting claim is also manual after reload. */ }
    }
    showStatus($, runtime.checkpoint.phase === "manual" ? pauseStatus(runtime.checkpoint) : "任务保持暂停：读取额度或保存状态失败，稍后重试。")
  } finally { runtime.busy = false }
}

async function initialize($: EngineInterface, runtime: Runtime, interactive: boolean): Promise<void> {
  runtime.timer?.cancel()
  runtime.immediate?.cancel()
  runtime.epoch++
  runtime.interactive = interactive
  runtime.sessionId = await $.session.id()
  const live = await $.state.get(CHECKPOINT)
  // Live state survives hot reload. A fresh process has no live ownership, so
  // never turn an old disk record into a surprise background continuation.
  runtime.checkpoint = savedCheckpoint(live.value !== undefined ? live.value : await $.store.get(`pause:${runtime.sessionId}`), runtime.sessionId)
  if (live.value === undefined && runtime.checkpoint?.phase === "waiting") {
    runtime.checkpoint = { ...runtime.checkpoint, phase: "manual", note: "本会话已重新启动；请检查进度后手动输入继续。" }
    await persist($, runtime)
  }
  if (runtime.checkpoint?.phase === "submitting") {
    runtime.checkpoint = { ...runtime.checkpoint, phase: "manual", note: "上次继续指令的交付状态不确定，请手动检查后继续。" }
    await persist($, runtime)
  }
  if (runtime.checkpoint?.team?.members.some(m => m.state === "stopping" || m.state === "sending" || m.state === "uncertain")) {
    runtime.checkpoint = { ...runtime.checkpoint, phase: "manual", note: "队伍控制交付状态不确定，请手动核对成员。" }
    await persist($, runtime)
  }
  if (!runtime.settings.enabled) return
  if (runtime.checkpoint) showStatus($, pauseStatus(runtime.checkpoint))
  if (interactive) {
    runtime.kick = () => {
      runtime.immediate?.cancel()
      runtime.immediate = $.clock.after(0, async () => { runtime.immediate = undefined; await refresh($, runtime) })
    }
    runtime.timer = $.clock.every(runtime.settings.intervalMs, async () => { await refresh($, runtime) })
  }
}

export function register(on: On, options: PluginOptions) {
  const runtime: Runtime = { settings: guardSettings(options), interactive: false, epoch: 0, busy: false, pausing: false, saving: Promise.resolve(), inputPending: 0 }

  on("session.start", async ($, e, next) => {
    if (runtime.settings.enabled) {
      try { await initialize($, runtime, e.isInteractive) }
      catch { showStatus($, "额度守卫初始化失败；请运行 /capacity 检查。") }
    }
    await $.command.register({ name: "capacity", description: "查看额度和 Team 状态、取消等待或重试确认失败的成员", argumentHint: "[status|cancel|resume]", immediate: true })
    return next(e)
  })

  on("classic.SessionStart", { source: ["clear", "resume", "fork"] }, async ($, e, next) => {
    if (runtime.settings.enabled) await initialize($, runtime, runtime.interactive)
    return next(e)
  })

  on("session.end", async ($, e, next) => {
    runtime.timer?.cancel()
    runtime.immediate?.cancel()
    runtime.kick = undefined
    runtime.timer = undefined
    runtime.epoch++
    runtime.pausing = false
    runtime.mainTurn = undefined
    if (e.reason === "clear" || e.reason === "resume" || e.reason === "logout") {
      try { await clearCheckpoint($, runtime) } catch { showStatus($, "取消等待状态保存失败，请检查 /capacity。") }
    }
    return next(e)
  })

  on("prompt.submit", async ($, e, next) => {
    if (e.origin?.kind === "plugin" && e.origin.name === $.plugin.name) return next(e)
    // Scheduled triggers and agent notifications are not a new user intent.
    const human = !e.isMeta && (!e.origin || ["composer", "bridge", "sdk", "unclassified"].includes(e.origin.kind))
    if (!human) return next(e)
    runtime.inputPending++
    try {
      const result = await next(e)
      if (result.drop === undefined) {
        if (runtime.checkpoint || runtime.pausing) await clearCheckpoint($, runtime)
        else runtime.epoch++ // Also invalidate quota reads that have not claimed a pause yet.
      }
      return result
    } finally { runtime.inputPending-- }
  })

  on("turn.start", async ($, e, next) => {
    if (!e.agentId) {
      runtime.mainTurn = e.turnId
      // Starting the continuation is authoritative proof of delivery. Release
      // its claim now so a fresh low reading can create a new pause immediately.
      if (runtime.checkpoint?.phase === "submitting") {
        try { await clearCheckpoint($, runtime) } catch { showStatus($, "恢复已开始，但状态保存失败。") }
      }
    }
    return next(e)
  })

  on("agent.spawn", async ($, e, next) => {
    const checkpoint = runtime.checkpoint
    if (checkpoint?.team && checkpoint.phase !== "submitting" && !(e.resume && teamAllows(checkpoint.team, e.resume.agentId))) return { deny: "额度守卫正在协调队伍暂停或恢复，暂不启动新成员。" }
    const result = await next(e)
    const held = runtime.checkpoint
    if (held?.team && result.agentId && result.teammateId && !held.team.members.some(m => m.id === result.agentId)) {
      if (held.team.members.length >= MAX_TEAM_MEMBERS) {
        runtime.checkpoint = { ...held, phase: "manual", note: "成员数量超过协调上限，请手动检查队伍。" }
      } else {
        runtime.epoch++
        runtime.checkpoint = { ...held, phase: "waiting", team: { phase: "pausing", members: [...held.team.members, { id: result.agentId, address: result.teammateId, name: (e.name ?? result.agentId).slice(0, 200), resume: true, state: "pending" }] } }
      }
      await persist($, runtime)
      runtime.kick?.()
    }
    return result
  })

  on("turn.complete", async ($, e, next) => {
    if (!e.agentId && runtime.mainTurn === e.turnId) runtime.mainTurn = undefined
    if (!e.agentId && e.isAborted && runtime.checkpoint && runtime.abortingTurn !== e.turnId) {
      try { await clearCheckpoint($, runtime) } catch { /* In-memory cancellation still prevents this timer from starting work. */ }
    }
    if (!e.agentId && runtime.abortingTurn === e.turnId) runtime.abortingTurn = undefined
    return next(e)
  })

  on("turn.step", async function* ($, e, next) {
    if (!runtime.settings.enabled) return yield* next(e)
    const requestEpoch = runtime.epoch
    const heldTeam = runtime.checkpoint?.team
    if (heldTeam && runtime.checkpoint?.phase !== "submitting" && (!e.agentId || !teamAllows(heldTeam, e.agentId))) {
      if (!e.agentId) {
        runtime.abortingTurn = e.turnId
        try { await $.turn.abort({ turnId: e.turnId }) } catch { /* The request is still withheld. */ }
      }
      return stopped(e)
    }
    let limits: SessionRateLimit[]
    try { limits = (await $.session.usage()).rateLimits }
    catch {
      if (requestEpoch !== runtime.epoch || next.signal.aborted) return stopped(e)
      // Before any known low reading, preserve normal native behavior.
      if (!runtime.checkpoint) { showStatus($, "暂时无法读取额度；本次由 Claude 原生限额处理。"); return yield* next(e) }
      return stopped(e)
    }
    const now = await $.clock.now()
    if (requestEpoch !== runtime.epoch || next.signal.aborted) return stopped(e)
    const decision = capacityDecision(limits, now, runtime.settings)
    if (!decision.blocked) return yield* next(e)
    if (runtime.checkpoint?.team && heldTeam) {
      runtime.epoch++
      runtime.checkpoint = { ...runtime.checkpoint, token: `${e.turnId}:${now}:${runtime.epoch}`, phase: "waiting", windows: decision.windows, resumeAt: decision.resumeAt, team: { phase: "pausing", members: heldTeam.members.map(m => m.state === "sent" || m.state === "sending" ? { ...m, state: "pending" } : m) } }
      await persist($, runtime)
      runtime.kick?.()
      if (runtime.mainTurn) {
        runtime.abortingTurn = runtime.mainTurn
        try { await $.turn.abort({ turnId: runtime.mainTurn }) }
        catch {
          if (runtime.checkpoint) {
            runtime.checkpoint = { ...runtime.checkpoint, phase: "manual", note: "再次低额度时无法确认主轮次已停止，请核对队伍。" }
            await persist($, runtime)
          }
        }
      }
      return stopped(e)
    }
    if (runtime.checkpoint || runtime.pausing) return stopped(e)
    runtime.pausing = true
    runtime.epoch++
    const epoch = runtime.epoch
    const abortTarget = runtime.mainTurn ?? (!e.agentId ? e.turnId : undefined)
    let team: Checkpoint["team"]
    let rosterFailed = false
    try { team = captureTeam(await $.agent.list()) } catch { rosterFailed = true }
    if (epoch !== runtime.epoch || next.signal.aborted) {
      if (epoch === runtime.epoch) runtime.pausing = false
      return stopped(e)
    }
    const turnId = abortTarget ?? (team || rosterFailed ? e.turnId : undefined)
    if (!turnId) {
      runtime.pausing = false
      showStatus($, "子任务因额度不足停止；主任务将在下一次模型请求前暂停。")
      yield { kind: "stop", stopReason: "end_turn", usage: null }
      return { ...stopped(e), stopReason: "end_turn" }
    }
    let sessionId = runtime.sessionId
    try { sessionId ??= await $.session.id() }
    catch { if (epoch === runtime.epoch) { runtime.pausing = false; showStatus($, "无法获取会话标识，本次模型请求已拦截。") }; return stopped(e) }
    if (epoch !== runtime.epoch || next.signal.aborted) { if (epoch === runtime.epoch) runtime.pausing = false; return stopped(e) }
    runtime.checkpoint = {
      version: 1, sessionId, token: `${turnId}:${now}:${epoch}`,
      turnId, pausedAt: now, resumeAt: decision.resumeAt, windows: decision.windows.slice(0, 32),
      phase: runtime.interactive && !rosterFailed ? "waiting" : "manual",
      ...(team ? { team } : {}),
      ...(rosterFailed ? { note: "无法确认 Team 成员列表，请手动核对队伍。" } : {}),
      ...(!runtime.interactive ? { note: "无界面进程结束后没有定时器；请恢复本会话后输入继续。" } : {}),
    }
    runtime.pausing = false
    runtime.sessionId = runtime.checkpoint.sessionId
    try { await persist($, runtime) }
    catch {
      if (runtime.checkpoint && epoch === runtime.epoch) {
        runtime.checkpoint = { ...runtime.checkpoint, phase: "manual", note: "暂停记录保存失败，请手动继续。" }
        // If the live write succeeded but the disk write failed, replace the
        // live waiting record too so hot reload cannot re-arm it accidentally.
        try { await persist($, runtime) } catch { /* Request remains blocked even with unavailable storage. */ }
      }
    }
    if (epoch !== runtime.epoch) return stopped(e)
    if (next.signal.aborted) {
      try { await clearCheckpoint($, runtime) } catch { /* User cancellation takes precedence in memory. */ }
      return stopped(e)
    }
    if (runtime.checkpoint) showStatus($, pauseStatus(runtime.checkpoint))
    if (team) runtime.kick?.()
    if (!abortTarget) return stopped(e)
    runtime.abortingTurn = abortTarget
    try { await $.turn.abort({ turnId: abortTarget }) }
    catch {
      if (epoch === runtime.epoch && runtime.checkpoint) {
        runtime.checkpoint = { ...runtime.checkpoint, phase: "manual", note: "无法确认任务已停止；为避免重复，不会自动恢复。" }
        try { await persist($, runtime) } catch { /* No automatic resume from memory. */ }
      }
    }
    return stopped(e)
  }).catch(async function* ($, e) {
    showStatus($, "额度守卫检查异常，本次模型请求已拦截。请检查 /capacity。")
    return stopped(e)
  })

  on("command.run", { command: "capacity" }, async ($, e) => {
    const action = e.args.trim().toLowerCase()
    if (action === "resume") {
      const held = runtime.checkpoint
      if (!held?.team || held.phase !== "manual") return { text: "没有需要手动重试的 Team 暂停记录。" }
      if (held.team.members.some(m => ["sending", "uncertain", "stopping"].includes(m.state))) return { text: "有成员的交付状态不确定，请手动核对，不能自动重发。" }
      // The member batch finished. Only the lead submission may be uncertain;
      // team retry must not turn that uncertainty into a duplicate lead turn.
      if (held.team.phase === "resuming" && held.team.members.every(m => !m.resume || m.state === "sent")) return { text: "成员恢复指令均已送达；请核对主会话是否已继续，不能通过 Team 重试再次提交主会话指令。" }
      runtime.epoch++
      runtime.checkpoint = { ...held, phase: "waiting", note: undefined, team: { phase: held.team.members.some(m => m.state === "pending" || m.state === "stop_failed") ? "pausing" : "paused", members: held.team.members.map(m => m.state === "stop_failed" ? { ...m, state: "pending" } : m) } }
      await persist($, runtime)
      runtime.kick?.()
      return { text: "已恢复 Team 协调，仍会检查额度；已送达的成员不会重复发送。" }
    }
    if (action === "cancel") {
      const team = runtime.checkpoint?.team
      await clearCheckpoint($, runtime)
      return { text: `已取消自动恢复。需要继续时，请发送新消息。${team ? ` 已停止成员不会自动唤醒，请由主会话核对并按原 ID 手动继续：${team.members.filter(m => m.resume).map(m => `${m.name} [${m.id}]`).join("；")}` : ""}` }
    }
    if (action && action !== "status") return { text: "用法：/capacity [status|cancel|resume]" }
    let detail = "暂无原生额度读数；首个模型响应后才可能可用。"
    try {
      const usage = await $.session.usage()
      if (usage.rateLimits.length) detail = describeWindows(usage.rateLimits)
    } catch { detail = "暂时无法读取原生额度。" }
    let roster = "Team 状态暂时无法读取。"
    try { const team = captureTeam(await $.agent.list()); roster = team ? `当前探测到 Team：${team.members.length} 名活动或空闲成员。` : "当前没有活动 Team 成员。" } catch { /* Unknown is not an empty roster. */ }
    const members = runtime.checkpoint?.team?.members.map(m => `${m.name} [${m.id}]：${m.state}`).join("\n")
    return { text: `${runtime.settings.enabled ? "已启用" : "已关闭"}额度守卫；剩余低于 ${runtime.settings.threshold}% 时暂停。\n${detail}\n${roster}\n${runtime.checkpoint ? pauseStatus(runtime.checkpoint) : "当前没有等待恢复的任务。"}${members ? `\n${members}` : ""}` }
  })
}
