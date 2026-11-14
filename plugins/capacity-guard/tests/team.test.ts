import { expect, test } from "claude-code/testing"
import { fixture } from "./runtime-fixture"
import type { AgentInfo } from "claude-code"

const options = { reset_buffer_seconds: 1, check_interval_seconds: 5 }
const start = { cwd: "/tmp/team-fixture", surface: "terminal" as const, isInteractive: true }
const step = { turnId: "main", index: 0, model: "fixture", messageCount: 1 }
const command = { command: "capacity", origin: { kind: "composer" as const }, presentation: { isFullscreen: false, columns: 80 } }
function teammate(id: string, status: AgentInfo["status"] = "running"): AgentInfo { return { id, teammateId: `${id}@team`, name: id, description: "fixture", type: "general-purpose", status } }
async function consume(stream: AsyncIterable<unknown>) { for await (const _ of stream) {} }

test("the lead stops active teammates, retains idle members and resumes each owned member before itself", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("worker-a"), teammate("worker-b", "waiting"), teammate("idle", "idle"), { id: "ordinary", description: "subagent", type: "Explore", status: "running" }]
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.settle()
  expect(f.memberStops).toEqual(["worker-a", "worker-b"])
  expect(f.state.requests).toBe(0)
  await f.clock.advance(15_000)
  expect(f.memberMessages).toEqual([{ to: "worker-a", text: "continue" }, { to: "worker-b", text: "continue" }])
  expect(f.sent).toEqual(["continue"])
  await f.clock.advance(30_000)
  expect(f.memberMessages.length).toBe(2)
})

test("a team request first observed while the lead is idle coordinates a pause", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("worker")]
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step({ ...step, turnId: "child-turn", agentId: "worker" }))
  await f.clock.settle()
  expect(f.memberStops).toEqual(["worker"])
  expect(f.aborted).toEqual([])
  await f.clock.advance(15_000)
  expect(f.memberMessages.length).toBe(1)
  expect(f.sent).toEqual(["continue"])
})

test("no team continuation is sent when a member stop is refused", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("worker")]
  f.state.failStop = "worker"
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(30_000)
  expect(f.memberMessages.length).toBe(0)
  expect(f.sent.length).toBe(0)
  expect((await $.command.run({ ...command, args: "" })).text).toContain("手动")
})

test("a partial resume failure keeps delivered members from receiving duplicate continuations", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("a"), teammate("b")]
  f.state.failMemberSend = "b"
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(30_000)
  expect(f.memberMessages.map(m => m.to)).toEqual(["a", "b"])
  expect(f.sent.length).toBe(0)
  f.state.failMemberSend = ""
  await $.command.run({ ...command, args: "resume" })
  await f.clock.settle()
  expect(f.memberMessages.map(m => m.to)).toEqual(["a", "b", "b"])
  expect(f.sent).toEqual(["continue"])
})

test("uncertain member delivery is never automatically resent", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("worker")]
  f.state.uncertainMemberSend = "worker"
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(60_000)
  expect(f.memberMessages.length).toBe(1)
  await $.command.run({ ...command, args: "resume" })
  await f.clock.advance(30_000)
  expect(f.memberMessages.length).toBe(1)
})

test("team retry cannot resubmit an uncertain lead continuation after every member was delivered", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("worker")]
  f.state.onResume = async () => { throw new Error("lead delivery unknown") }
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(1)
  await $.command.run({ ...command, args: "resume" })
  await f.clock.advance(30_000)
  expect(f.memberMessages.length).toBe(1)
  expect(f.sent.length).toBe(1)
})

test("cancel stops further team actions and never wakes the stopped members", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("worker")]
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.settle()
  await $.command.run({ ...command, args: "cancel" })
  await f.clock.advance(30_000)
  expect(f.memberMessages.length).toBe(0)
  expect(f.sent.length).toBe(0)
})

test("request fencing blocks held members and new spawns even after a cached reset passes", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("worker")]
  f.state.limits = [{ kind: "five_hour", percentUsed: 99 }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.settle()
  f.state.limits = [{ kind: "five_hour", percentUsed: 0 }]
  await consume($.turn.step({ ...step, agentId: "worker" }))
  expect(f.state.requests).toBe(0)
  expect((await $.agent.spawn({ prompt: "new", subagentType: "Explore", tool_use_id: "fixture-spawn", description: "fixture", background: true, isTeammate: true, provider: { plugin: "engine", tier: "core" }, parentModel: "fixture", fork: false })).deny).toBeDefined()
})

test("roster discovery failures do not silently become a confirmed empty team", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agentListFails = true
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(30_000)
  expect(f.sent.length).toBe(0)
  expect(f.state.requests).toBe(0)
})

test("a refused member stop does not prevent stopping the remaining teammates", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("a"), teammate("b"), teammate("c")]
  f.state.failStop = "b"
  f.state.limits = [{ kind: "five_hour", percentUsed: 99 }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.settle()
  expect(f.memberStops).toEqual(["a", "b", "c"])
  expect((await $.command.run({ ...command, args: "" })).text).toContain("b [b]：stop_failed")
})

test("members added during a stop pass are included before the team is declared paused", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("a")]
  f.state.onStop = id => { if (id === "a") f.state.agents.push(teammate("b")) }
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(15_000)
  expect(f.memberStops).toEqual(["a", "b"])
  expect(f.memberMessages.map(m => m.to)).toEqual(["a", "b"])
})

test("fresh low quota during member restoration invalidates the old batch and pauses again", { options }, async ($, on) => {
  const f = fixture(on)
  f.state.agents = [teammate("a"), teammate("b")]
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  let first = true
  f.state.onMemberSend = async id => {
    if (id === "a" && first) {
      first = false
      f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(40_000).toISOString() }]
      await consume($.turn.step({ ...step, turnId: "member-new-turn", agentId: "a" }))
    }
  }
  await $.session.start(start)
  await consume($.turn.step(step))
  await f.clock.advance(15_000)
  expect(f.memberMessages.map(m => m.to)).toEqual(["a"])
  expect(f.sent.length).toBe(0)
  await f.clock.advance(30_000)
  expect(f.memberMessages.map(m => m.to)).toEqual(["a", "a", "b"])
  expect(f.sent).toEqual(["continue"])
})

test("accepted user input during roster discovery invalidates the old pause before control actions", { options }, async ($, on) => {
  const f = fixture(on)
  let finish: (() => void) | undefined
  f.state.onAgentList = () => new Promise<void>(resolve => { finish = resolve })
  f.state.agents = [teammate("worker")]
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  const pending = consume($.turn.step(step))
  await f.clock.settle()
  expect(finish).toBeDefined()
  await $.prompt.submit({ text: "replace the task", origin: { kind: "composer" }, wait: false })
  f.state.onAgentList = undefined
  finish?.()
  await pending
  await f.clock.advance(30_000)
  expect(f.memberStops).toEqual([])
  expect(f.memberMessages).toEqual([])
  expect(f.aborted).toEqual([])
})

test("accepted user input during quota lookup prevents stale team ownership", { options }, async ($, on) => {
  const f = fixture(on)
  let finish: (() => void) | undefined
  f.deferUsage(() => new Promise<void>(resolve => { finish = resolve }))
  f.state.agents = [teammate("worker")]
  f.state.limits = [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(10_000).toISOString() }]
  await $.session.start(start)
  const pending = consume($.turn.step(step))
  await f.clock.settle()
  expect(finish).toBeDefined()
  await $.prompt.submit({ text: "replace the task", origin: { kind: "composer" }, wait: false })
  finish?.()
  await pending
  await f.clock.advance(30_000)
  expect(f.memberStops).toEqual([])
  expect(f.memberMessages).toEqual([])
  expect(f.aborted).toEqual([])
})
