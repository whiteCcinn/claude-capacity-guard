export type TeamMember = {
  id: string
  address: string
  name: string
  resume: boolean
  state: "held" | "pending" | "stopping" | "stopped" | "stop_failed" | "sending" | "sent" | "resume_failed" | "uncertain"
}

export type TeamPause = {
  phase: "pausing" | "paused" | "resuming"
  members: TeamMember[]
}

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
  team?: TeamPause
}

declare module "claude-code" {
  interface PluginState {
    "capacity-guard": { checkpoint: Checkpoint | null }
  }
}
