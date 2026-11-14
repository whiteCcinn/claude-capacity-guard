import type { EngineInterface, On, PluginOptions, SessionRateLimit, TurnStepInput, TurnStepResult } from "claude-code"
import { capacityDecision, describeWindows, guardSettings, validWindows } from "./policy"
import type { GuardSettings } from "./policy"
import { mergeWindows, savedCheckpoint } from "./checkpoint"
import type { Checkpoint } from "./checkpoint"

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
}

const CONTINUE = "额度守卫等待已结束。请在当前会话中继续刚才因额度不足暂停的原任务。先核对已有工具结果、文件改动和任务进度，从尚未完成的步骤继续；不要重复执行已经成功的有副作用操作。遵循用户最新指示和现有权限要求；若任务已经完成，仅报告完成状态。"
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
  if (checkpoint.phase === "manual") return `任务已暂停，需手动继续。${checkpoint.note ?? ""} ${detail}`
  if (checkpoint.phase === "submitting") return "额度守卫正在提交继续指令。"
  return `任务已暂停。${detail}。${checkpoint.resumeAt === null ? "尚无有效重置时间，继续等待用量数据。" : `将在 ${new Date(checkpoint.resumeAt).toLocaleString()} 之后继续。`} /capacity cancel 可取消等待。`
}

function showStatus($: EngineInterface, text: string | undefined): void {
  try { $.ui.status(text) } catch { /* Presentation must not change admission. */ }
}

async function clearCheckpoint($: EngineInterface, runtime: Runtime): Promise<void> {
  runtime.epoch++
  runtime.checkpoint = undefined
  await persist($, runtime)
  showStatus($, undefined)
}

async function refresh($: EngineInterface, runtime: Runtime): Promise<void> {
  if (runtime.busy || runtime.mainTurn || runtime.inputPending || !runtime.interactive || !runtime.settings.enabled || runtime.checkpoint?.phase !== "waiting") return
  runtime.busy = true
  const epoch = runtime.epoch
  const held = runtime.checkpoint
  try {
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
    runtime.checkpoint = { ...held, phase: "submitting" }
    await persist($, runtime)
    if (epoch !== runtime.epoch || runtime.inputPending || runtime.checkpoint?.token !== held.token) return
    showStatus($, "额度等待已结束，正在继续原任务。")
    // Do not await a queued prompt inside a running-turn event. This helper
    // only runs in a timer callback or an immediate command while idle.
    const result = await $.prompt.submit({ text: CONTINUE })
    if (epoch !== runtime.epoch || runtime.checkpoint?.token !== held.token) return
    if (result.drop !== undefined) {
      runtime.checkpoint = { ...held, phase: "manual", note: "继续指令被拒绝或取消；请检查会话后输入继续。" }
      await persist($, runtime)
      showStatus($, pauseStatus(runtime.checkpoint))
    } else await clearCheckpoint($, runtime)
  } catch {
    if (epoch !== runtime.epoch || !runtime.checkpoint) return
    if (runtime.checkpoint.phase === "submitting") {
      runtime.checkpoint = { ...runtime.checkpoint, phase: "manual", note: "无法确认继续指令是否已接收；为避免重复，不会自动重试。" }
      try { await persist($, runtime) } catch { /* A persisted submitting claim is also manual after reload. */ }
    }
    showStatus($, runtime.checkpoint.phase === "manual" ? pauseStatus(runtime.checkpoint) : "任务保持暂停：读取额度或保存状态失败，稍后重试。")
  } finally { runtime.busy = false }
}

async function initialize($: EngineInterface, runtime: Runtime, interactive: boolean): Promise<void> {
  runtime.timer?.cancel()
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
  if (!runtime.settings.enabled) return
  if (runtime.checkpoint) showStatus($, pauseStatus(runtime.checkpoint))
  if (interactive) runtime.timer = $.clock.every(runtime.settings.intervalMs, async () => { await refresh($, runtime) })
}

export function register(on: On, options: PluginOptions) {
  const runtime: Runtime = { settings: guardSettings(options), interactive: false, epoch: 0, busy: false, pausing: false, saving: Promise.resolve(), inputPending: 0 }

  on("session.start", async ($, e, next) => {
    if (runtime.settings.enabled) {
      try { await initialize($, runtime, e.isInteractive) }
      catch { showStatus($, "额度守卫初始化失败；请运行 /capacity 检查。") }
    }
    await $.command.register({ name: "capacity", description: "查看额度与暂停状态，或取消自动恢复", argumentHint: "[status|cancel]", immediate: true })
    return next(e)
  })

  on("classic.SessionStart", { source: ["clear", "resume", "fork"] }, async ($, e, next) => {
    if (runtime.settings.enabled) await initialize($, runtime, runtime.interactive)
    return next(e)
  })

  on("session.end", async ($, e, next) => {
    runtime.timer?.cancel()
    runtime.timer = undefined
    runtime.epoch++
    runtime.mainTurn = undefined
    if (e.reason === "clear" || e.reason === "resume" || e.reason === "logout") {
      try { await clearCheckpoint($, runtime) } catch { showStatus($, "取消等待状态保存失败，请检查 /capacity。") }
    }
    return next(e)
  })

  on("prompt.submit", async ($, e, next) => {
    if (e.origin?.kind === "plugin" && e.origin.name === $.plugin.name) return next(e)
    if (!runtime.checkpoint) return next(e)
    // Scheduled triggers and agent notifications are not a new user intent.
    const human = !e.isMeta && (!e.origin || ["composer", "bridge", "sdk", "unclassified"].includes(e.origin.kind))
    if (!human) return next(e)
    runtime.inputPending++
    try {
      const result = await next(e)
      if (result.drop === undefined) await clearCheckpoint($, runtime)
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
    let limits: SessionRateLimit[]
    try { limits = (await $.session.usage()).rateLimits }
    catch {
      // Before any known low reading, preserve normal native behavior.
      if (!runtime.checkpoint) { showStatus($, "暂时无法读取额度；本次由 Claude 原生限额处理。"); return yield* next(e) }
      return stopped(e)
    }
    const now = await $.clock.now()
    if (next.signal.aborted) return stopped(e)
    const decision = capacityDecision(limits, now, runtime.settings)
    if (!decision.blocked) return yield* next(e)
    if (runtime.checkpoint || runtime.pausing) return stopped(e)
    const turnId = runtime.mainTurn ?? (!e.agentId ? e.turnId : undefined)
    if (!turnId) {
      showStatus($, "子任务因额度不足停止；主任务将在下一次模型请求前暂停。")
      yield { kind: "stop", stopReason: "end_turn", usage: null }
      return { ...stopped(e), stopReason: "end_turn" }
    }
    runtime.pausing = true
    runtime.epoch++
    const epoch = runtime.epoch
    let sessionId = runtime.sessionId
    try { sessionId ??= await $.session.id() }
    catch { runtime.pausing = false; showStatus($, "无法获取会话标识，本次模型请求已拦截。"); return stopped(e) }
    if (epoch !== runtime.epoch || next.signal.aborted) { runtime.pausing = false; return stopped(e) }
    runtime.checkpoint = {
      version: 1, sessionId, token: `${turnId}:${now}:${epoch}`,
      turnId, pausedAt: now, resumeAt: decision.resumeAt, windows: decision.windows.slice(0, 32),
      phase: runtime.interactive ? "waiting" : "manual",
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
    runtime.abortingTurn = turnId
    try { await $.turn.abort({ turnId }) }
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
    if (action === "cancel") {
      await clearCheckpoint($, runtime)
      return { text: "已取消自动恢复。需要继续时，请发送新消息。" }
    }
    if (action && action !== "status") return { text: "用法：/capacity [status|cancel]" }
    let detail = "暂无原生额度读数；首个模型响应后才可能可用。"
    try {
      const usage = await $.session.usage()
      if (usage.rateLimits.length) detail = describeWindows(usage.rateLimits)
    } catch { detail = "暂时无法读取原生额度。" }
    return { text: `${runtime.settings.enabled ? "已启用" : "已关闭"}额度守卫；剩余低于 ${runtime.settings.threshold}% 时暂停。\n${detail}\n${runtime.checkpoint ? pauseStatus(runtime.checkpoint) : "当前没有等待恢复的任务。"}` }
  })
}
