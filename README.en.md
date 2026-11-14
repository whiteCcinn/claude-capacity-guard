# Claude Capacity Guard

English · [简体中文](README.md)

Pause long-running work in an open, interactive Claude Code session when reported remaining quota falls below a threshold, then submit one continuation to the same conversation when the blocking windows become available.

Defaults: **10% remaining**, a **60-second reset buffer**, a **30-second check interval**, and **`continue`** as the continuation text. The plugin uses the native Mods API. It needs no separate API key, credential reader, or usage polling service.

## Install

Run in your system terminal:

```bash
claude plugin marketplace add whiteCcinn/claude-capacity-guard
claude plugin install capacity-guard@claude-capacity-guard
```

Run `/reload-plugins` in an existing session, or start a new one. The tested baseline is **Claude Code 2.1.325**. See [compatibility](docs/compatibility.md) for validation scope.

The marketplace is `claude-capacity-guard`; the plugin is `capacity-guard`. The installed configuration ID is `capacity-guard@claude-capacity-guard`. A source plugin loaded with `--plugin-dir` uses `capacity-guard@inline`.

## Use and configure

Inside Claude Code:

```text
/capacity
/capacity resume
/capacity cancel
/plugin configure capacity-guard@claude-capacity-guard
```

`/capacity` reports quota, the live team and saved member states. `/capacity resume` retries confirmed team-control failures while still checking quota. `/capacity cancel` cancels the pending continuation. Accepted user input also supersedes the previous waiting task. Cancellation does not wake stopped teammates. If quota remains low, the new task pauses again. To keep the guard off, change `enabled` or disable the plugin.

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enable request admission checks |
| `remaining_threshold` | `10` | Pause strictly below this remaining percentage; 0–99, with 0 stopping exhausted quota |
| `reset_buffer_seconds` | `60` | Wait another 1–3600 seconds after a reported reset |
| `check_interval_seconds` | `30` | Read the native cache every 5–300 seconds; this does not refresh server usage |
| `resume_text` | `continue` | The complete automatic continuation text; choose `继续` or a custom instruction |

A threshold of 20 pauses below 20%; exactly 20% is allowed. Save the setting and reload as prompted. See [configuration](docs/configuration.md) for command-line examples, updates and removal.

The continuation contains the configured text, with surrounding whitespace removed, and no hidden appended instructions. This configures outgoing automatic messages, not an additional keyword matcher for incoming messages.

## How it works

1. Before each observed model request, read `$.session.usage().rateLimits`.
2. Check each reported window's `percentUsed`, `kind` and `resetsAt`.
3. When blocked, save a session-scoped checkpoint and stop the owning main turn with `$.turn.abort`.
4. A background timer waits until no window remains blocked. Multiple low windows use the latest reset plus the buffer; a newer healthy reading can release the task earlier.
5. Save a submitting claim, then use `$.prompt.submit` to send one plugin-attributed continuation to the same conversation.

Claude continues from the existing transcript, tool results and files. This is a new turn in the original conversation, not a frozen process or a replay of past tool calls. Uncertain delivery becomes manual recovery instead of an automatic retry. See [architecture](docs/architecture.md) for the state machine and failure handling.

When a native Agent Team is detected, the lead stops each active member through `TaskStop` and records confirmation. Member requests and new spawns are fenced while held. After quota recovers, the lead sends the configured continuation to each original active member, then continues itself. Previously idle members are not awakened. A member's quota check can trigger the team pause; the lead owns recovery ordering. See [team coordination](docs/team-coordination.md).

## Limits and integrations

- **Keep the interactive session running.** A closed process cannot wake itself. Reopened sessions require manual continuation. Headless `claude -p` and SDK runs do not gain an external supervisor.
- **Quota readings are cached from the last response.** Missing initial readings permit native requests. An existing pause remains waiting if readings disappear or fail. A passed reset timestamp permits a continuation attempt, not a fresh account-wide availability guarantee.
- **In-process Agent Teams have been validated** for coordinated stopping and per-member restoration. Stop confirmations take time; this is not an atomic process freeze. Delivery means a queued message. tmux / iTerm2 split panes have not completed end-to-end validation. See [integrations](docs/integrations.md).
- **External side effects are not exactly-once.** In-flight requests may finish and tools may be interrupted. You can configure an instruction to inspect prior results before proceeding; it is not a transaction mechanism.

With `interaction-translator` 0.7.0, the automatic continuation has a `plugin` origin and bypasses its input translation path. Subsequent answers follow the translator's output settings. See [integrations](docs/integrations.md).

## Documentation and development

The detailed guides are in Simplified Chinese: [architecture](docs/architecture.md), [configuration](docs/configuration.md), [usage](docs/usage.md), [team coordination](docs/team-coordination.md), [integrations](docs/integrations.md), [compatibility](docs/compatibility.md), [troubleshooting](docs/troubleshooting.md), and [development](docs/development.md). Community policies are available in English: [contributing](CONTRIBUTING.md), [security](SECURITY.md), [code of conduct](CODE_OF_CONDUCT.md), and [changelog](CHANGELOG.md).

```bash
git clone https://github.com/whiteCcinn/claude-capacity-guard.git
cd claude-capacity-guard
claude plugin validate . --strict
claude plugin validate plugins/capacity-guard --strict
claude plugin test plugins/capacity-guard
```

There are no npm runtime dependencies. Native mock tests do not require real model calls. Claude Code generates version-specific development declarations when the source plugin is loaded interactively.

## Acknowledgments and license

The plugin layout and native configuration approach were informed by [claude-interaction-translator](https://github.com/whiteCcinn/claude-interaction-translator). This guard runs independently and does not depend on that plugin. [MIT License](LICENSE).
