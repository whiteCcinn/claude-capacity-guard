import type { PluginOptions, SessionRateLimit } from "claude-code"

export type GuardSettings = { enabled: boolean; threshold: number; bufferMs: number; intervalMs: number; resumeText: string }
export type CapacityDecision = { known: boolean; blocked: boolean; windows: SessionRateLimit[]; resumeAt: number | null }
export const DEFAULT_RESUME_TEXT = "continue"
export const MAX_RESUME_TEXT_LENGTH = 4096

export function validWindows(limits: readonly SessionRateLimit[]): SessionRateLimit[] {
  return limits.filter(limit => limit && typeof limit.kind === "string" && limit.kind.length > 0 && Number.isFinite(limit.percentUsed) && limit.percentUsed >= 0)
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

export function guardSettings(options: PluginOptions): GuardSettings {
  const resumeText = typeof options.resume_text === "string" ? options.resume_text.trim() : ""
  return {
    enabled: options.enabled !== false,
    threshold: bounded(options.remaining_threshold, 10, 0, 99),
    bufferMs: bounded(options.reset_buffer_seconds, 60, 1, 3600) * 1000,
    intervalMs: bounded(options.check_interval_seconds, 30, 5, 300) * 1000,
    resumeText: resumeText && resumeText.length <= MAX_RESUME_TEXT_LENGTH ? resumeText : DEFAULT_RESUME_TEXT,
  }
}

export function capacityDecision(limits: readonly SessionRateLimit[], now: number, settings: GuardSettings): CapacityDecision {
  const valid = validWindows(limits)
  const windows = valid.filter(limit => {
    const reset = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN
    // The host reports its last response's figures. A passed server reset
    // permits a new request; it does not claim to be a fresh account reading.
    if (Number.isFinite(reset) && now >= reset + settings.bufferMs) return false
    return limit.percentUsed >= 100 || 100 - limit.percentUsed < settings.threshold
  })
  const deadlines = windows.map(limit => limit.resetsAt ? Date.parse(limit.resetsAt) : NaN)
  return {
    known: valid.length > 0,
    blocked: windows.length > 0,
    windows,
    resumeAt: windows.length > 0 && deadlines.every(Number.isFinite) ? Math.max(...deadlines) + settings.bufferMs : null,
  }
}

export function describeWindows(windows: readonly SessionRateLimit[]): string {
  return windows.map(limit => `${limit.kind} 剩余 ${Math.max(0, 100 - limit.percentUsed).toFixed(1)}%`).join("；")
}
