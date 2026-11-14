import { expect, test } from "claude-code/testing"
import { capacityDecision, guardSettings } from "../hooks/policy"

const now = Date.parse("2026-11-14T08:00:00Z")
const five = "2026-11-14T10:00:00Z"
const week = "2026-11-16T08:00:00Z"
const settings = { threshold: 10, bufferMs: 60_000, intervalMs: 30_000, enabled: true, resumeText: "continue" }

test("threshold is remaining percent and equality is allowed", () => {
  expect(capacityDecision([{ kind: "five_hour", percentUsed: 90, resetsAt: five }], now, settings).blocked).toBe(false)
  expect(capacityDecision([{ kind: "five_hour", percentUsed: 90.1, resetsAt: five }], now, settings).blocked).toBe(true)
})

test("waits for every blocking window, including weekly quota", () => {
  const decision = capacityDecision([{ kind: "five_hour", percentUsed: 95, resetsAt: five }, { kind: "seven_day", percentUsed: 99, resetsAt: week }], now, settings)
  expect(decision.resumeAt).toBe(Date.parse(week) + 60_000)
  expect(decision.windows.length).toBe(2)
})

test("expired cached readings expire only after the reset buffer", () => {
  const limits = [{ kind: "five_hour", percentUsed: 100, resetsAt: five }]
  expect(capacityDecision(limits, Date.parse(five), settings).blocked).toBe(true)
  expect(capacityDecision(limits, Date.parse(five) + 60_000, settings).blocked).toBe(false)
})

test("a missing or invalid reset never fabricates a wake time", () => {
  for (const resetsAt of [undefined, "not-a-date"]) {
    const decision = capacityDecision([{ kind: "five_hour", percentUsed: 99, resetsAt }], now, settings)
    expect(decision.blocked).toBe(true)
    expect(decision.resumeAt).toBe(null)
  }
})

test("unknown quota is explicitly unknown and malformed readings are rejected", () => {
  expect(capacityDecision([], now, settings).known).toBe(false)
  expect(capacityDecision([{ kind: "five_hour", percentUsed: NaN }], now, settings).known).toBe(false)
  expect(capacityDecision([{ kind: "five_hour", percentUsed: -1 }], now, settings).known).toBe(false)
})

test("zero threshold still stops an exhausted window, including spend limits over 100", () => {
  for (const percentUsed of [100, 125]) {
    expect(capacityDecision([{ kind: "spend_limit", percentUsed, resetsAt: five }], now, { ...settings, threshold: 0 }).blocked).toBe(true)
  }
})

test("settings reject nonfinite and out of range values with safe defaults", () => {
  expect(guardSettings({ remaining_threshold: NaN, reset_buffer_seconds: -1, check_interval_seconds: 0 })).toEqual(settings)
  expect(guardSettings({ enabled: false, remaining_threshold: 20, reset_buffer_seconds: 5, check_interval_seconds: 10 })).toEqual({ enabled: false, threshold: 20, bufferMs: 5000, intervalMs: 10_000, resumeText: "continue" })
})

test("resume text defaults to continue for new and upgraded configurations", () => {
  expect(guardSettings({}).resumeText).toBe("continue")
  expect(guardSettings({ remaining_threshold: 20 }).resumeText).toBe("continue")
})

test("resume text supports Unicode and trims only surrounding whitespace", () => {
  expect(guardSettings({ resume_text: "继续" }).resumeText).toBe("继续")
  expect(guardSettings({ resume_text: "  continue  " }).resumeText).toBe("continue")
  expect(guardSettings({ resume_text: "检查已有进度后继续。\nDo not repeat completed steps." }).resumeText).toBe("检查已有进度后继续。\nDo not repeat completed steps.")
  expect(guardSettings({ resume_text: "x".repeat(4096) }).resumeText.length).toBe(4096)
})

test("empty, wrong-type and oversized resume text falls back without truncation", () => {
  for (const resume_text of ["", " \n\t ", false, 10, ["continue"], "x".repeat(4097)]) {
    expect(guardSettings({ resume_text }).resumeText).toBe("continue")
  }
})
