# Design

Resolve `resume_text` in the pure policy settings function alongside the quota options. Keep the default consistent with the manifest, which the development integration helper reads. Store the normalized text only in runtime configuration, not in the persistent checkpoint or status command output.

The timer submits that exact runtime value through `$.prompt.submit`. A hot reload rebuilds settings from the saved native options and can re-arm a waiting live record, so it naturally uses the latest text. Keep the prior message's progress-checking suggestions as optional documentation examples rather than hidden appended instructions.

Adversarial review covers missing options on upgrades, wrong types, blank and oversized values, Unicode, command-like text treated by the host's normal prompt API, plugin attribution, and duplicate submissions. The translator check must exercise both `continue` and `继续` without parsing an old source-code constant.
