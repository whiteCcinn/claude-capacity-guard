# Security policy

## Reporting a vulnerability

Do not include credentials, private transcripts or exploitable details in a public issue. Use [GitHub private vulnerability reporting](https://github.com/whiteCcinn/claude-capacity-guard/security/advisories/new) when available. If GitHub does not offer a private report, open an issue titled “Private security contact requested” without the vulnerability details so a maintainer can arrange a private channel. This project has no guaranteed response-time service agreement.

The initial 0.1.x line is the current maintenance line. Security reports about older versions remain useful, but a fix may require upgrading.

## What the plugin accesses

Claude Code Mods run with the host's permissions and are not a sandbox boundary. Review the code before installing it. The current production plugin uses native session identity and quota readings, session state, a plugin-scoped persistent store, timers, status messages, turn cancellation and prompt submission.

The plugin does not read OAuth tokens, API keys, transcript bodies or workspace files. It does not add an HTTP client, external process, telemetry endpoint or separate model service. Its continuation prompt is sent to the current Claude session using the host's existing authentication and provider. Claude's normal request processing and other installed plugins still apply.

Stored checkpoints contain session and turn identifiers, quota windows, timestamps, a delivery token, a phase and an optional diagnostic note. They do not contain copies of task prompts or tool output. Checkpoints use separate keys for each session. See [architecture](docs/architecture.md) for lifetime and cancellation behavior.

## Operational boundaries

This is a task-admission guard, not a spending cap or authorization system. A stale quota snapshot may miss another session's consumption. A tool can have partial external effects when its turn is stopped. Native permissions and review requirements still apply after continuation. There is no coordinated pause across a whole Agent Team or independent processes.

If a plugin misbehaves, cancel waiting with `/capacity cancel`, disable it, and inspect the original task before continuing. Use [troubleshooting](docs/troubleshooting.md) for ordinary defects and private reporting for security-sensitive ones.
