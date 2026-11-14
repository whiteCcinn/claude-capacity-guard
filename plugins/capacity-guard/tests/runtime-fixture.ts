import { mock } from "claude-code/testing"
import type { On, SessionRateLimit, AgentInfo } from "claude-code"

export function fixture(on: On) {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  const sent: string[] = []
  const resumeOrigins: unknown[] = []
  const aborted: string[] = []
  const memberStops: string[] = []
  const memberMessages: { to: string; text: string }[] = []
  let usageRead: (() => Promise<void>) | undefined
  const state = { limits: [] as SessionRateLimit[], agents: [] as AgentInfo[], requests: 0, usageFails: false, storeFails: false, rejectInput: false, rejectResume: false, abortFails: false, failStop: "", failMemberSend: "", uncertainMemberSend: "", agentListFails: false, onAgentList: undefined as (() => Promise<void>) | undefined, onStop: undefined as ((id: string) => void) | undefined, onResume: undefined as (() => Promise<void>) | undefined, onMemberSend: undefined as ((id: string) => Promise<void>) | undefined }
  on("session.start", (_, e) => ({ cwd: e.cwd }))
  on("session.end", () => ({ sessionId: "session-a" }))
  on("command.register", (_, e) => ({ value: { command: e.name } }))
  on("session.id", () => ({ value: "session-a" }))
  on("agent.list", async () => { if (state.agentListFails) throw new Error("unavailable roster"); await state.onAgentList?.(); return { value: state.agents } })
  on("agent.spawn", (_, e) => ({ model: "fixture", agentId: e.resume?.agentId ?? "new-worker" }))
  on("tool.call", { tool: "TaskStop" }, (_, e) => {
    const id = e.task_id ?? ""
    memberStops.push(id)
    if (id === state.failStop) return { deny: "fixture stop refused" }
    const member = state.agents.find(a => a.id === id)
    if (member) member.status = "killed"
    state.onStop?.(id)
    return { result: { message: "Stopped", task_id: id, task_type: "in_process_teammate" } }
  })
  on("session.send", async (_, e) => {
    memberMessages.push({ to: e.to, text: e.text })
    if (e.to === state.uncertainMemberSend) throw new Error("uncertain delivery")
    if (e.to === state.failMemberSend) return { isDelivered: false, reason: "fixture not delivered" }
    const member = state.agents.find(a => a.id === e.to)
    if (member) member.status = "running"
    await state.onMemberSend?.(e.to)
    return { isDelivered: true }
  })
  on("session.usage", async () => { if (state.usageFails) throw new Error("private error"); await usageRead?.(); return { value: { startedAt: 0, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: state.limits } } })
  on("store.get", (_, e) => ({ value: store.get(e.key) }))
  on("store.set", (_, e) => { if (state.storeFails) throw new Error("disk full"); store.set(e.key, e.value); return { value: undefined } })
  on("ui.status", () => ({ value: undefined }))
  on("turn.abort", (_, e) => { if (state.abortFails) throw new Error("abort refused"); aborted.push(e.turnId); return { value: undefined } })
  on("turn.start", (_, e) => ({ turnId: e.turnId }))
  on("turn.complete", (_, e) => ({ text: e.answer }))
  on("prompt.submit", async (_, e) => {
    if (e.origin?.kind === "plugin") {
      sent.push(e.text)
      resumeOrigins.push(e.origin)
      if (state.rejectResume) return { drop: "the session was stopped and nobody has sent input since" }
      await state.onResume?.()
    } else if (state.rejectInput) return { drop: "rejected" }
    return { text: e.text, origin: e.origin }
  })
  on("turn.step", async function* (_, e) {
    state.requests++
    yield { kind: "text", index: 0, text: "answer" }
    yield { kind: "stop", stopReason: "end_turn", usage: null }
    return { turnId: e.turnId, index: e.index, answer: "answer", toolUses: [], stopReason: "end_turn", usage: null }
  })
  return { clock, store, sent, resumeOrigins, aborted, memberStops, memberMessages, state, deferUsage(read: () => Promise<void>) { usageRead = read } }
}
