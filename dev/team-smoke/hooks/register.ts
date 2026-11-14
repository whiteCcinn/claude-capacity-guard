import type { On } from "claude-code"

// This fixture starts real native teammates but stubs every model request.
export function register(on: On) {
  let reset = 0
  const runs = new Map<string, number>()
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "team-smoke", description: "Native team fixture", argumentHint: "start|arm|status", immediate: true })
    return next(e)
  })
  on("session.usage", () => ({ value: { startedAt: 0, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: [{ kind: "five_hour", percentUsed: reset ? 99 : 0, ...(reset ? { resetsAt: new Date(reset).toISOString() } : {}) }] } }))
  on("command.run", { command: "team-smoke" }, async ($, e) => {
    if (e.args === "start") {
      const results = []
      for (const name of ["guard-fixture-a", "guard-fixture-b"]) results.push(await $.agent.spawn({ name, subagentType: "general-purpose", description: "Native guard fixture", prompt: "Return the stubbed fixture result only; do not run tools." }))
      return { text: JSON.stringify(results) }
    }
    if (e.args === "arm") {
      reset = await $.clock.now() + 12_000
      return { text: "Simulated low quota armed. Send a short test prompt now." }
    }
    return { text: JSON.stringify({ runs: [...runs], agents: await $.agent.list() }) }
  })
  on("turn.step", async function* ($, e, next) {
    const id = e.agentId ?? "main"
    const count = (runs.get(id) ?? 0) + 1
    runs.set(id, count)
    if (e.agentId && count === 1) {
      try { for await (const _ of $.process.spawn({ argv: ["sleep", "120"] })) {} }
      catch { return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: null, usage: null } }
    }
    if (next.signal.aborted) return { turnId: e.turnId, index: e.index, answer: "", toolUses: [], stopReason: null, usage: null }
    const text = e.agentId ? "TEAM_SMOKE_MEMBER_OK" : "TEAM_SMOKE_MAIN_OK"
    yield { kind: "text", index: 0, text }
    yield { kind: "stop", stopReason: "end_turn", usage: null }
    return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: "end_turn", usage: null }
  })
}
