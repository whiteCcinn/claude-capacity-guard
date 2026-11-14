# Requirements

- Gate the next model request when remaining quota is below the configured threshold, or usage is at least 100%.
- Observe all reported plan windows. Wait for the latest reset among blocking windows, plus a configurable buffer. Never treat missing readings as zero usage.
- Save a small checkpoint under a session-specific store key before aborting a main turn. Preserve existing transcript and tool results. Do not replay a tool call.
- Use background timers, never a multi-hour hook sleep. Submit at most one continuation for a checkpoint. Do not retry refused, dropped, or uncertain submissions automatically.
- User input supersedes the old checkpoint only after acceptance. Cancellation, clear, session switching, and user interruption must prevent an old continuation from starting later.
- Reload may re-arm waiting checkpoints. An uncertain submission becomes manual on reload. A closed process cannot wake itself.
- Subagents share the account quota and must not bypass the gate. Requests already in flight may finish. Abort the owning main turn when known.
- Missing reset timestamps or unavailable quota reads on an existing pause retain the pause with a visible explanation.
- Include a status command, cancellation command, native configuration, mock tests, and explicit compatibility limitations.
