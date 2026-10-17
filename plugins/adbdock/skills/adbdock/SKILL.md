---
name: adbdock
description: Manage Android USB/Wi-Fi devices and emulators with adbdock. Use for ADB target selection, saved commands, Android app checks, React Native Metro ports and connection recovery. Not for general parallel coding.
---

Use the installed `adbdock` CLI on macOS. Metro is optional.

1. Inspect `adbdock devices --json`; consult `adbdock --help` as needed.
   If unavailable, explain the prerequisite (`npm i -g adbdock`) rather than silently installing it.
2. Prefer explicit targets for coordinated work; one online device can be auto-selected. Preserve device/port assignments.
3. Read only the reference relevant to the operation:
   - [devices.md](references/devices.md): device aliases, pairing, selection and task allocation.
   - [commands.md](references/commands.md): saved scripts, menu, screenshots and reverse.
   - [metro.md](references/metro.md): shared/separate Metro ports and watcher lifecycle.
   - [recovery.md](references/recovery.md): failures, diagnostics and cleanup.

ADB/reverse/server readiness does not prove app rendering or Fast Refresh.
Verify the app separately with an available device UI tool when the task requires it.
