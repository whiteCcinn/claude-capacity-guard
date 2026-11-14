import type { AgentInfo } from "claude-code"
import type { TeamMember, TeamPause } from "../types"

export const MAX_TEAM_MEMBERS = 64
const states = ["held", "pending", "stopping", "stopped", "stop_failed", "sending", "sent", "resume_failed", "uncertain"]

export function captureTeam(agents: readonly AgentInfo[]): TeamPause | undefined {
  const members: TeamMember[] = []
  for (const agent of agents) {
    if (!agent.teammateId || ["completed", "failed", "killed"].includes(agent.status)) continue
    if (!agent.id || agent.id.length > 1024 || agent.teammateId.length > 1024) throw new Error("Invalid team identity")
    if (members.some(m => m.id === agent.id)) throw new Error("Ambiguous team identity")
    const resume = agent.status !== "idle"
    members.push({ id: agent.id, address: agent.teammateId, name: (agent.name ?? agent.id).slice(0, 200), resume, state: resume ? "pending" : "held" })
    if (members.length > MAX_TEAM_MEMBERS) throw new Error("Team roster exceeds the coordination limit")
  }
  return members.length ? { phase: "pausing", members } : undefined
}

export function validTeam(value: unknown): value is TeamPause {
  if (!value || typeof value !== "object") return false
  const team = value as Partial<TeamPause>
  if (!["pausing", "paused", "resuming"].includes(team.phase ?? "") || !Array.isArray(team.members) || !team.members.length || team.members.length > MAX_TEAM_MEMBERS) return false
  const ids = new Set<string>()
  return team.members.every(m => {
    if (!m || typeof m.id !== "string" || !m.id || m.id.length > 1024 || ids.has(m.id) || typeof m.address !== "string" || !m.address || m.address.length > 1024 || typeof m.name !== "string" || m.name.length > 200 || typeof m.resume !== "boolean" || !states.includes(m.state)) return false
    ids.add(m.id)
    return (m.state === "held") === !m.resume
  })
}

export function teamAllows(team: TeamPause, agentId: string): boolean {
  return team.members.some(m => m.id === agentId && (m.state === "sending" || m.state === "sent"))
}

export function teamSummary(team: TeamPause): string {
  const active = team.members.filter(m => m.resume)
  const stopped = active.filter(m => m.state === "stopped").length
  const sent = active.filter(m => m.state === "sent").length
  return `Team ${team.members.length} 名成员；停止已确认 ${stopped}/${active.length}；恢复指令已送达 ${sent}/${active.length}。${team.phase === "pausing" ? "正在确认队伍暂停。" : team.phase === "resuming" ? "正在逐成员恢复。" : "队伍等待额度恢复。"}`
}
