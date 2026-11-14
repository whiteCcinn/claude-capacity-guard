import type { SessionRateLimit } from "claude-code"
import type { Checkpoint } from "../types"
import { validTeam } from "./team"
export type { Checkpoint } from "../types"

export function savedCheckpoint(value: unknown, sessionId: string): Checkpoint | undefined {
  if (!value || typeof value !== "object") return
  const v = value as Partial<Checkpoint>
  if (v.version !== 1 || v.sessionId !== sessionId || typeof v.token !== "string" || typeof v.turnId !== "string" || !Number.isFinite(v.pausedAt)) return
  if (v.resumeAt !== null && (typeof v.resumeAt !== "number" || !Number.isFinite(v.resumeAt))) return
  if (!["waiting", "submitting", "manual"].includes(v.phase ?? "") || !Array.isArray(v.windows) || v.windows.length > 32) return
  if (v.windows.some(w => !w || typeof w.kind !== "string" || !Number.isFinite(w.percentUsed) || w.percentUsed < 0 || (w.resetsAt !== undefined && typeof w.resetsAt !== "string"))) return
  if (v.team !== undefined && !validTeam(v.team)) return
  return { version: 1, sessionId, token: v.token, turnId: v.turnId, pausedAt: v.pausedAt!, resumeAt: v.resumeAt!, windows: v.windows, phase: v.phase!, note: typeof v.note === "string" ? v.note.slice(0, 512) : undefined, ...(v.team ? { team: v.team } : {}) }
}

export function mergeWindows(previous: readonly SessionRateLimit[], current: readonly SessionRateLimit[]): SessionRateLimit[] {
  const byKind = new Map(previous.map(w => [w.kind, w]))
  for (const w of current) byKind.set(w.kind, w)
  return [...byKind.values()].slice(0, 32)
}
