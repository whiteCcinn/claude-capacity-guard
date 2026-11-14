import { expect, test } from "claude-code/testing"
import { captureTeam, validTeam } from "../hooks/team"
import { savedCheckpoint } from "../hooks/checkpoint"
import type { AgentInfo } from "claude-code"

function agent(id: string, status: AgentInfo["status"] = "running"): AgentInfo { return { id, teammateId: `${id}@team`, description: "fixture", type: "general-purpose", status } }

test("team identity uses the native marker and retains only live team members", () => {
  expect(captureTeam([{ id: "ordinary", description: "subagent", type: "Explore", status: "running" }])).toBe(undefined)
  const team = captureTeam([agent("running"), agent("idle", "idle"), agent("done", "completed"), agent("dead", "killed")])!
  expect(team.members.map(m => [m.id, m.resume, m.state])).toEqual([["running", true, "pending"], ["idle", false, "held"]])
  expect(validTeam(team)).toBe(true)
})

test("the coordinator refuses oversized and ambiguous rosters rather than truncating them", () => {
  expect(() => captureTeam(Array.from({ length: 65 }, (_, i) => agent(`member-${i}`)))).toThrow()
  expect(() => captureTeam([agent("same"), agent("same")])).toThrow()
})

test("checkpoint parsing preserves per-member delivery ownership and rejects corrupt team state", () => {
  const team = captureTeam([agent("a")])!
  const held = { version: 1, sessionId: "a", token: "t", turnId: "root", pausedAt: 1, resumeAt: 10, windows: [], phase: "waiting", team }
  expect(savedCheckpoint(held, "a")?.team).toEqual(team)
  for (const value of [{ ...team, phase: "other" }, { ...team, members: [...team.members, ...team.members] }, { ...team, members: [{ ...team.members[0], state: "unknown" }] }, { ...team, members: [{ ...team.members[0], resume: false }] }]) {
    expect(validTeam(value)).toBe(false)
    expect(savedCheckpoint({ ...held, team: value }, "a")).toBe(undefined)
  }
})
