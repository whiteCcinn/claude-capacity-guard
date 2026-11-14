# Changelog

Changes are recorded here using semantic versions. Version 0.x APIs and native host integrations may change as compatibility is established.

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
