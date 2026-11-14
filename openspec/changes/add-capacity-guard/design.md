# Design

Pure policy functions validate readings and options and calculate blocking reset deadlines. Runtime hooks own lifecycle and persistence. Native `session.usage` reads the latest response's account limits, not context-window fill. Expired readings can permit one continuation after the server timestamp; this is not a fresh account-wide availability guarantee.

Use `turn.step` as the request boundary and `turn.abort` to end the owning main turn without a user interruption marker. A periodic job reads a session-scoped checkpoint, marks it submitting durably, then submits a plugin-attributed continuation. User-origin prompts invalidate the old checkpoint. Store writes are serialized and lifecycle epochs invalidate late asynchronous results.

An adversarial review must cover racing subagents, overlapping timer callbacks, checkpoint write failures, stale native readings, missing resets, reload during submission, rejected prompts, manual interruptions, and cross-session leakage.
