# Contributing

Bug reports, documentation corrections and focused pull requests are welcome in English or Simplified Chinese. Read the [development guide](docs/development.md) before changing code and the [architecture](docs/architecture.md) before changing lifecycle behavior.

## Discuss and implement a change

For a significant behavior change, open an issue describing the trigger, expected result, failure handling and affected session types. Small fixes can go directly to a pull request.

Keep OpenSpec-style proposals, designs, requirements, tasks and review records locally under `openspec/changes/` when changing behavior. That directory is ignored and must not be committed or pushed. Describe the reviewable design and requirements in the issue or pull request instead. Start with a failing test for the observable behavior, implement the smallest cohesive change, and add regression coverage for races or failure paths discovered during review.

Preserve these contracts:

- Read native quota windows without inspecting OAuth credentials or private endpoints.
- Keep missing readings distinct from zero usage, and retain all blocking windows.
- Respect accepted user input, cancellation and session boundaries.
- Do not replay a model request or tool operation after a stream failure.
- Do not automatically retry a continuation whose delivery is uncertain.
- Keep state session-scoped and live writes ordered with durable writes.
- Require native lifecycle evidence for each supported Agent Teams mode; do not extend in-process results to untested split-pane modes.
- Persist member control claims before calls, retain partial outcomes and never declare the whole team stopped after a refused control.

## Validate

Use the baseline Claude Code version listed in [compatibility](docs/compatibility.md):

```bash
claude plugin validate . --strict
claude plugin validate plugins/capacity-guard --strict
claude plugin test plugins/capacity-guard
```

For TypeScript checking, first load the source plugin interactively so Claude Code generates the declarations for your version:

```bash
claude --plugin-dir "$PWD/plugins/capacity-guard"
```

Exit the test session, then run:

```bash
npx --yes --package typescript@5.9.3 tsc --noEmit -p plugins/capacity-guard
```

Do not commit generated declarations, generated `tsconfig.json`, credentials, personal paths, account snapshots, session transcripts or logs. Test single-session lifecycle changes with the [development fixture](dev/smoke-fixture/README.md), which replaces the main model only. Use the [Team fixture](dev/team-smoke/README.md) for real in-process teammates with stubbed main/member models. Other installed hooks and native background features retain their own behavior.

## Review and submit

Describe the concrete before/after behavior, checks you ran and remaining limitations. Documentation changes should keep both READMEs consistent. Link relevant issues and avoid unrelated refactors.

Before submission, challenge your change with parallel agent requests, overlapping timer callbacks, late asynchronous results, failed storage, empty quota, user cancellation, hot reload and restart. Explain why each relevant case is safe; do not infer native guarantees solely from mocks.

## Version and release conventions

Use semantic versions. Keep the version in `plugins/capacity-guard/.claude-plugin/plugin.json`, the marketplace entry and `CHANGELOG.md` synchronized. A tested Claude Code baseline is not a promise that every older or newer release works.

Maintainers validate and review the release commit before creating a version tag or GitHub release. A push to `main` alone does not imply a separately published release. Changes to the test baseline or integration support matrix require updated documentation and evidence.

## License

By submitting a contribution, you agree to license it under this repository's [MIT license](LICENSE). Preserve third-party notices when adding external material.
