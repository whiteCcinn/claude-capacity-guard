import type { On } from "claude-code"

// Development only. Never list this fixture in the production marketplace.
export function register(on: On) {
  let reset = 0
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "quota-smoke", description: "Arm the simulated quota reset", immediate: true })
    return next(e)
  })
  on("session.usage", async ($) => ({
    value: {
      startedAt: 0,
      context: { tokens: 0, window: 200000, percent: 0 },
      rateLimits: [{ kind: "five_hour", percentUsed: 99, resetsAt: new Date(reset || (await $.clock.now()) + 60_000).toISOString() }],
    },
  }))
  on("command.run", { command: "quota-smoke" }, async ($) => {
    reset = await $.clock.now() + 10_000
    return { text: "Fixture armed: send a short test prompt now. After reset, expect OFFLINE_RESUME_OK from the stubbed main model." }
  })
  on("turn.step", async function* (_, e) {
    const text = "OFFLINE_RESUME_OK"
    yield { kind: "text", index: 0, text }
    yield { kind: "stop", stopReason: "end_turn", usage: null }
    return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: "end_turn", usage: null }
  })
}
