import { expect, mock, test } from "claude-code/testing"
import type { On, SessionRateLimit } from "claude-code"

function fixture(on: On) {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  const sent: string[] = []
  const resumeOrigins: unknown[] = []
  const aborted: string[] = []
  const state = { limits: [] as SessionRateLimit[], requests: 0, usageFails: false, storeFails: false, rejectInput: false, rejectResume: false, abortFails: false, onResume: undefined as (() => Promise<void>) | undefined }
  on("session.start", (_, e) => ({ cwd: e.cwd }))
  on("session.end", () => ({ sessionId: "session-a" }))
  on("command.register", (_, e) => ({ value: { command: e.name } }))
  on("session.id", () => ({ value: "session-a" }))
  on("session.usage", () => { if (state.usageFails) throw new Error("private error"); return { value: { startedAt: 0, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: state.limits } } })
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
  return { clock, store, sent, resumeOrigins, aborted, state }
}

const options = { reset_buffer_seconds: 1, check_interval_seconds: 5 }
const start = { cwd: "/tmp/capacity-test", surface: "terminal" as const, isInteractive: true }
const step = { turnId: "main", index: 0, model: "fixture", messageCount: 1 }
const command = { command: "capacity", origin: { kind: "composer" as const }, presentation: { isFullscreen: false, columns: 80 } }
async function consume(stream: AsyncIterable<unknown>) { const chunks: unknown[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks }

test("healthy and initially unknown readings permit the original request", { options }, async ($, on) => {
  const f = fixture(on)
  await $.session.start(start)
  await consume($.turn.step(step))
  f.state.limits = [{ kind: "five_hour", percentUsed: 40 }]
  await consume($.turn.step({ ...step, index: 1 }))
  expect(f.state.requests).toBe(2)
  expect(f.aborted).toEqual([])
})

test("low quota saves first, blocks the model, then submits one continuation after reset", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 95, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await $.turn.start({ text: "finish task", turnId: "main" })
  await consume($.turn.step(step))
  expect(f.state.requests).toBe(0)
  expect(f.aborted).toEqual(["main"])
  expect(f.store.get("pause:session-a")).toBeDefined()
  await $.turn.complete({ turnId: "main", answer: "", reason: "aborted", isAborted: true, durationMs: 1 })
  await f.clock.advance(14_999)
  expect(f.sent.length).toBe(0)
  await f.clock.advance(1)
  expect(f.sent.length).toBe(1)
  expect(f.sent[0]).toContain("继续")
  expect(f.resumeOrigins).toEqual([{ kind: "plugin", name: "capacity-guard" }])
  await f.clock.advance(60_000)
  expect(f.sent.length).toBe(1)
})

test("weekly quota prevents an early five-hour wake", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 95, resetsAt: new Date(10_000).toISOString() }, { kind: "seven_day", percentUsed: 95, resetsAt: new Date(30_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(15_000)
  expect(f.sent.length).toBe(0)
  await f.clock.advance(20_000)
  expect(f.sent.length).toBe(1)
})

test("accepted user input cancels the old automatic continuation", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 95, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await $.prompt.submit({ text: "do something else", origin: { kind: "composer" }, wait: false })
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
})

test("a rejected user submission preserves the waiting task", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 95, resetsAt: new Date(10_000).toISOString() }]
  f.state.rejectInput = true
  await $.session.start(start)
  await consume($.turn.step(step))
  await $.prompt.submit({ text: "rejected", origin: { kind: "composer" }, wait: false })
  await f.clock.advance(15_000)
  expect(f.sent.length).toBe(1)
})

test("cancel is immediate and leaves no automatic wake", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99 }]
  await $.session.start(start)
  await consume($.turn.step(step))
  const result = await $.command.run({ ...command, args: "cancel" })
  expect(result.text).toContain("取消")
  f.state.limits = [{ kind: "five_hour", percentUsed: 0 }]
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
})

test("a refused continuation is retained for manual recovery without retry loops", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.rejectResume = true
  f.state.limits = [{ kind: "five_hour", percentUsed: 95, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(60_000)
  expect(f.sent.length).toBe(1)
  expect((await $.command.run({ ...command, args: "" })).text).toContain("手动")
})

test("missing reset and failed usage reads cannot wake the task", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99 }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
  f.state.usageFails = true
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
})

test("parallel subagent and main gates create one checkpoint and one continuation", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await $.turn.start({ text: "task", turnId: "main" })
  await Promise.all([consume($.turn.step({ ...step, agentId: "child" })), consume($.turn.step(step))])
  expect(f.state.requests).toBe(0)
  expect(f.aborted).toEqual(["main"])
  await $.turn.complete({ turnId: "main", answer: "", reason: "aborted", isAborted: true, durationMs: 1 })
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(1)
})

test("clear cancels timers and the saved checkpoint", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await $.session.end({ reason: "clear", sessionId: "session-a", resume: { id: "session-a" } })
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
  expect(f.store.get("pause:session-a")).toBe(null)
})

test("headless pauses are durable but never claim an in-process automatic wake", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start({ ...start, isInteractive: false })
  await consume($.turn.step(step))
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
  expect((await $.command.run({ ...command, args: "" })).text).toContain("无界面")
})

test("disabled guard passes requests and creates no checkpoint", { options: { ...options, enabled: false } }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 100 }]
  await $.session.start(start)
  await consume($.turn.step(step))
  expect(f.state.requests).toBe(1)
  expect(f.store.size).toBe(0)
})

test("reload re-arms the live checkpoint and cancels the previous timer", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await $.session.start(start)
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(1)
})

test("an interrupted newer turn cancels old ownership", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await $.turn.complete({ turnId: "newer", answer: "", reason: "aborted", isAborted: true, durationMs: 1 })
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
})

test("background notifications do not cancel a waiting task", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await $.prompt.submit({ text: "background result", origin: { kind: "task-notification" }, isMeta: true, wait: false })
  await f.clock.advance(15_000)
  expect(f.sent.length).toBe(1)
})

test("a failed durable pause remains manual and never resumes automatically", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.storeFails = true
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  f.state.storeFails = false
  await $.session.start(start)
  await f.clock.advance(30_000)
  expect(f.state.requests).toBe(0)
  expect(f.sent.length).toBe(0)
  expect((await $.command.run({ ...command, args: "" })).text).toContain("手动")
})

test("a refused abort never schedules a duplicate continuation", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.abortFails = true
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(30_000)
  expect(f.state.requests).toBe(0)
  expect(f.sent.length).toBe(0)
})

test("starting the continuation releases the old claim so fresh low quota can pause again", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  f.state.onResume = async () => {
    await $.turn.start({ text: "continue", turnId: "resumed" })
    f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(40_000).toISOString() }]
    await consume($.turn.step({ ...step, turnId: "resumed" }))
    await $.turn.complete({ turnId: "resumed", answer: "", reason: "aborted", isAborted: true, durationMs: 1 })
  }
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(15_000)
  expect(f.sent.length).toBe(1)
  expect(f.aborted).toEqual(["main", "resumed"])
  expect((f.store.get("pause:session-a") as { turnId: string }).turnId).toBe("resumed")
})

test("a disk checkpoint from a previous process is manual until the user continues", { options }, async ($, on) => {
  const f = fixture(on)
  f.store.set("pause:session-a", { version: 1, sessionId: "session-a", token: "old", turnId: "old", pausedAt: 0, resumeAt: 10_000, windows: [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }], phase: "waiting" })
  f.state.limits = [{ kind: "five_hour", percentUsed: 0 }]
  await $.session.start(start)
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
  expect((await $.command.run({ ...command, args: "" })).text).toContain("重新启动")
})

test("a reload during an uncertain submitting claim never submits it twice", { options }, async ($, on) => {
  const f = fixture(on)
  f.store.set("pause:session-a", { version: 1, sessionId: "session-a", token: "old", turnId: "old", pausedAt: 0, resumeAt: 10_000, windows: [], phase: "submitting" })
  f.state.limits = [{ kind: "five_hour", percentUsed: 0 }]
  await $.session.start(start)
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
  expect((await $.command.run({ ...command, args: "" })).text).toContain("不确定")
})

test("empty or corrupt current readings never free a known paused window", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99 }]
  await $.session.start(start)
  await consume($.turn.step(step))
  f.state.limits = []
  await f.clock.advance(10_000)
  f.state.limits = [{ kind: "five_hour", percentUsed: NaN }]
  await f.clock.advance(10_000)
  expect(f.sent.length).toBe(0)
})

test("a newer healthy reading can free the waiting task before the old reset", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(100_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  f.state.limits = [{ kind: "five_hour", percentUsed: 0, resetsAt: new Date(100_000).toISOString() }]
  await f.clock.advance(5000)
  expect(f.sent.length).toBe(1)
})
