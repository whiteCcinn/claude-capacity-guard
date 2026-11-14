# Capacity guard

Capacity guard pauses a Claude Code task before reported subscription quota drops below a configured remaining percentage. It reads native rate-limit windows, saves a session-scoped checkpoint, stops the owning main turn, and submits one continuation after every blocking window resets, with a safety buffer. No credentials or additional usage API calls are required.

Install through the project's GitHub marketplace from your system terminal:

```bash
claude plugin marketplace add whiteCcinn/claude-capacity-guard
claude plugin install capacity-guard@claude-capacity-guard
```

Run `/reload-plugins` in an existing Claude session or open a new one. Use `/capacity` for status and `/capacity cancel` to cancel waiting. Configure the remaining threshold, reset buffer, check interval and automatic continuation text through `/plugin configure capacity-guard@claude-capacity-guard`. The defaults are 10 percent remaining, a 60-second reset buffer, a 30-second check interval and `continue` as `resume_text`. Set that text to `继续` or a custom instruction; surrounding whitespace is trimmed and no hidden text is appended. Empty or over-4096-character values fall back to `continue`. Tested with Claude Code 2.1.325.

Automatic continuation requires an open interactive session. A closed process or a headless `claude -p` run cannot wake itself. Reopening a saved session requires manual continuation. Native quota readings are cached from the last response, and initially missing readings permit native requests. Passing a cached reset timestamp permits a continuation attempt, not a fresh server-side quota guarantee. In-flight work may finish or be interrupted; configure an instruction to inspect prior results if your task requires it. The plugin cannot guarantee exactly-once external side effects.

The plugin uses native session state for hot reload and a session-specific persistent store record for recovery. It does not save prompt or transcript copies. User input supersedes the old waiting task after acceptance. Failed or uncertain continuation delivery switches to manual recovery instead of retrying automatically. See the repository README for setup details, failure behavior, and tests.

With interaction-translator 0.7.0, plugin-attributed continuations skip input translation; output translation retains its own settings. Agent Teams coverage is partial: observing member requests does not provide team-wide stop coordination or per-member automatic resumption. See the [project documentation](https://github.com/whiteCcinn/claude-capacity-guard#readme) for the support matrix and detailed guides.
