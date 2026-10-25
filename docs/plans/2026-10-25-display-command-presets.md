# Display command presets implementation plan

**Goal:** Add `@size`, `@density` and `@font` using the existing saved-command runner.

**Design:** Size and density forward arguments to `adb shell wm`. Font queries `settings get system font_scale` without arguments and forwards supplied values to `settings put system font_scale`. Existing saved command maps remain authoritative; deleted or customized entries are not restored. No new CLI parser or configuration migration is needed.

**Validation:** Test query, value and reset argument forwarding, selected/all-device execution and preservation of saved maps. Update preset inventory assertions, help and English/Korean usage guides. Run the full check and temporary package-install check. Commit only after approval.
