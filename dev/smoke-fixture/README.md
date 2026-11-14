# Native smoke fixture

This development plugin simulates 99 percent used quota and replaces main model turns with a fixed response. It is not part of the production marketplace. Load it together with capacity guard only in a disposable test session. Run `/quota-smoke` and immediately send a short prompt. The guard should pause before the fixture's response, then submit its continuation after reset and render `OFFLINE_RESUME_OK` once. The fixture does not call a real main model. Other installed plugins and native background features retain their own behavior.

From the repository root, use a one-second buffer and a five-second check interval:

```bash
claude --plugin-dir "$PWD/plugins/capacity-guard" \
  --plugin-dir "$PWD/dev/smoke-fixture" \
  --settings '{"enabledPlugins":{"capacity-guard@claude-capacity-guard":false,"interaction-translator@claude-interaction-translator":false},"pluginConfigs":{"capacity-guard@inline":{"options":{"reset_buffer_seconds":1,"check_interval_seconds":5}}}}' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}'
```

Check `/capacity` afterwards. It should say there is no waiting task. Exit the session to unload both inline plugins. The overrides apply to this invocation; they do not edit the user's saved plugin settings.
