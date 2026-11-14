# Changelog

Changes are recorded here using semantic versions. Version 0.x APIs and native host integrations may change as compatibility is established.

## 0.2.0 — 2026-11-14

### Added

- Automatic native Team discovery, a bounded member checkpoint and lead-owned `TaskStop` controls with per-member acknowledgments.
- A request fence while paused and ordered continuation delivery to original active members before continuing the lead. Previously idle members are not awakened.
- `/capacity` member states and `/capacity resume` for confirmed team-control failures, with partial delivery retained and uncertain controls protected against resubmission.
- Team policy and lifecycle regression tests, including idle-lead detection, late members, refused stops, partial recovery, cancellation, renewed low quota and user input during discovery.
- A native two-teammate development fixture with stubbed main/member models, plus team coordination and mode-specific compatibility documentation.

### Changed

- Optional Team data extends the existing version-1 checkpoint; single-session checkpoints remain compatible.
- Translator filter checks now cover plugin, coordinator and peer origins with both continuation texts and both backend settings (12 cases).
- OpenSpec development records are local-only and ignored; published architecture and developer guides describe the feature.

### Validation and limits

- 56 native tests, strict TypeScript checks and 12 translator compatibility tests pass locally on Claude Code 2.1.325.
- Two real in-process teammates confirmed stopping and received continuations at their original identities before lead continuation, using simulated quota and stubbed models.
- Split panes are unverified. Stop controls are not an atomic process freeze, delivery confirms queuing, and external side effects remain outside an exactly-once guarantee.

## 0.1.1 — 2026-11-14

### Added

- Native `resume_text` configuration for the complete automatic continuation message, including Unicode and custom instructions.
- Normalization and request-boundary tests for the default, custom text, empty and oversized values.

### Changed

- Automatic continuation now defaults to exactly `continue` instead of the previous fixed Chinese instruction. No hidden instructions are appended. Existing configurations without `resume_text` also use this new default.
- The translator integration helper reads the manifest default and checks both `continue` and `继续` with API and CLI backend settings.

## 0.1.0 — 2026-11-14

### Added

- Native quota checks before observed model requests, with a configurable remaining-percentage threshold.
- Multiple blocking windows, reset buffers and periodic checks of the host's cached readings.
- Session-scoped pause checkpoints, main-turn cancellation and one automatic continuation in an open interactive session.
- Hot-reload recovery, manual recovery after process restart or uncertain submission, and cancellation on accepted user input.
- `/capacity` status and cancellation commands, plus native configuration options.
- Mock policy, persistence and lifecycle tests; a native flow fixture with a stubbed main model; and GitHub Actions validation.
- English and Simplified Chinese READMEs, architecture, integration, usage, configuration and contributor documentation.

### Known limits

- No external supervisor for a closed process or headless run.
- Native quota snapshots can be stale; reset timestamps permit a continuation attempt rather than guarantee available quota.
- Agent Teams coverage is partial; there is no coordinated team-wide pause and per-member resume.
- No exactly-once guarantee for external side effects of interrupted tools.

The local validation baseline is Claude Code 2.1.325. See [compatibility](docs/compatibility.md) for evidence and limits; a version entry does not by itself create a GitHub release.
