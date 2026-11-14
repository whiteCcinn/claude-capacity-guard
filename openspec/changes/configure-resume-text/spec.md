# Requirements

- Add a native string configuration option named `resume_text`, defaulting to `continue`.
- Use the normalized configured text as the entire automatic continuation message; do not append the old fixed instructions or change the message into user-origin input.
- Trim surrounding whitespace. Empty, whitespace-only, wrong-type or over-4096-character values use the default instead of sending a partial or empty message.
- Preserve the existing plugin-origin, one-submission, cancellation and uncertain-delivery behavior.
- Saving and reloading configuration applies the new text, including to live waiting checkpoints. Checkpoint formats do not change.
- Document that the keyword is sent to Claude in the current conversation; the plugin does not implement an additional incoming-message keyword matcher.
