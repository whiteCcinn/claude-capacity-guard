# Review and verification

Version 0.1.1, verified locally on 2026-11-14 with Claude Code 2.1.325.

## Behavior

- The default is exactly `continue`; existing configurations without `resume_text` use it too.
- Configured Unicode and multiline instructions are submitted as the complete message after trimming surrounding whitespace. No old instruction is appended.
- Empty, whitespace-only, wrong-type and over-4096-length normalized text use the default; oversized values are not truncated into a different instruction.
- The continuation retains `plugin` attribution. Quota checks, checkpoints, cancellation and one-submission semantics remain unchanged.
- Reloaded waiting state uses runtime settings; the checkpoint schema and stored task data do not change.
- This option configures the outgoing prompt. It does not add a command handler or incoming-message keyword matcher.

## Checks

- Observed the new default and custom-text tests fail before implementation.
- 39 native tests passed, including exact default/custom messages, plugin origin, a re-armed custom-text wait and blank-text fallback.
- Marketplace and plugin strict validation passed. The separate public-directory icon advice remains non-blocking; no public-directory listing is claimed.
- Strict TypeScript checking against locally generated host declarations passed.
- Four isolated checks against interaction-translator 0.7.0 passed for `continue` / `继续` with API / CLI backends; input-translation calls stayed at zero.
- Documentation links, documented options, manifest versions and Python helper syntax passed.
- The installed local plugin reads version 0.1.1. Native configuration saved `resume_text=continue` without changing the other option values.

No full real-account quota reset or new Agent Teams support was established by this change. Remote CI still requires a functioning GitHub Actions account; local passes must not be described as remote passes.
