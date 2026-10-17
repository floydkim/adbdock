---
name: adbdock
description: Manage Android USB/Wi-Fi devices and emulators with adbdock. Use when choosing ADB targets, checking an app on several Android devices, assigning separate React Native Metro ports, or recovering ADB/reverse connections during development. Not for general parallel coding.
---

Use the installed `adbdock` CLI on macOS. Metro is optional.

1. Check `adbdock --help`, then `adbdock devices --json` and `adbdock status --json`.
   If unavailable, explain the prerequisite (`npm install -g adbdock`) rather than silently installing it.
2. Use explicit target aliases/serials. Preserve existing device/port assignments.
3. Read only the reference relevant to the operation:
   - [devices.md](references/devices.md): aliases, targeted commands, parallel task allocation.
   - [metro.md](references/metro.md): shared/separate Metro ports and watcher lifecycle.
   - [recovery.md](references/recovery.md): failures, diagnostics and cleanup.

ADB/reverse/server readiness does not prove app rendering or Fast Refresh.
Verify the app separately with an available device UI tool when the task requires it.
