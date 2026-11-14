# Native Team flow fixture

This development-only plugin starts two real native in-process teammates while replacing all main and member model steps. A member's first step waits in a cancellable `sleep` process so native stop controls can be tested. A restored member returns `TEAM_SMOKE_MEMBER_OK`; the lead returns `TEAM_SMOKE_MAIN_OK`. There are no real main/member model requests from this fixture. Native background features and managed policies retain their own behavior.

From the repository root:

```bash
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --teammate-mode in-process \
  --setting-sources "" \
  --plugin-dir "$PWD/plugins/capacity-guard" --plugin-dir "$PWD/dev/team-smoke" \
  --settings '{"pluginConfigs":{"capacity-guard@inline":{"options":{"reset_buffer_seconds":1,"check_interval_seconds":5,"resume_text":"continue"}}}}' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}'
```

This invocation omits user/project settings for a disposable fixture; it does not edit them or override managed policies. Use a trusted checkout.

1. Run `/team-smoke start`; wait for two running teammates.
2. Run `/team-smoke arm`, then immediately send a short ordinary test prompt.
3. Observe `/capacity`: both active members should confirm stopping, followed by waiting for the simulated reset.
4. After reset plus buffer, expect one continuation delivered to each captured active member, then a lead continuation.
5. `/team-smoke status` should show two steps for each original member ID. `/capacity` should have no waiting record.
6. Exit the disposable session, which also cleans up its native teammates.

The fixture uses `sleep`, so its current native validation applies to macOS/Linux in-process mode. Split panes and other platforms require their own native checks. A delivered message proves queuing, not successful completion of a real task. Do not list this fixture in the production marketplace.
