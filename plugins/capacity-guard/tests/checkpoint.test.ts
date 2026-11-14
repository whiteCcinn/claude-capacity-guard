import { expect, test } from "claude-code/testing"
import { savedCheckpoint, mergeWindows } from "../hooks/checkpoint"

const held = { version: 1, sessionId: "a", token: "token", turnId: "turn", pausedAt: 1, resumeAt: 10, windows: [{ kind: "five_hour", percentUsed: 99 }], phase: "waiting" }

test("checkpoint validation rejects another session and corrupt records", () => {
  expect(savedCheckpoint(held, "a")?.turnId).toBe("turn")
  for (const value of [null, {}, { ...held, sessionId: "b" }, { ...held, resumeAt: NaN }, { ...held, windows: [null] }, { ...held, windows: [{ kind: "five_hour", percentUsed: "99" }] }, { ...held, phase: "other" }]) {
    expect(savedCheckpoint(value, "a")).toBe(undefined)
  }
})

test("a partial newer reading cannot remove a blocking weekly window", () => {
  expect(mergeWindows([{ kind: "seven_day", percentUsed: 99 }, { kind: "five_hour", percentUsed: 99 }], [{ kind: "five_hour", percentUsed: 1 }])).toEqual([{ kind: "seven_day", percentUsed: 99 }, { kind: "five_hour", percentUsed: 1 }])
})
