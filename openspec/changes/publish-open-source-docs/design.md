# Documentation design

Keep the two READMEs focused on setup, capabilities, limits and navigation. Place implementation detail, state diagrams and native API references in `docs/architecture.md`. Separate user configuration from contributor workflow. Link the translator's source at an immutable verified commit.

Treat request interception and full Agent Teams restoration as different capabilities. The current implementation has one main-session checkpoint and no per-member resume queue; documentation must not imply otherwise. Verify the plugin-attributed continuation against both input-translation backend settings in an isolated copy of the reference plugin.

Use repository-relative links and portable shell examples. Preserve the original marketplace and plugin names. Strict manifest checks, native tests, type checking, documentation link checks and an inspection of staged files precede the first push.
