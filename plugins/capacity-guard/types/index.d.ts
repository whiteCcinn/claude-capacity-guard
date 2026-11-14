export type Checkpoint = {
  version: 1
  sessionId: string
  token: string
  turnId: string
  pausedAt: number
  resumeAt: number | null
  windows: { kind: string; percentUsed: number; resetsAt?: string }[]
  phase: "waiting" | "submitting" | "manual"
  note?: string
}

declare module "claude-code" {
  interface PluginState {
    "capacity-guard": { checkpoint: Checkpoint | null }
  }
}
