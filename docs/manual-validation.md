# Validation record — 2026-10-17

Environment: macOS arm64, Node.js 22.22.0, npm 10.9.4,
Android platform-tools 36.0.0 (ADB 1.0.41).

## Automated boundary tests

The suite executes the compiled CLI in separate processes against an executable
fake ADB fixture, with an isolated configuration directory per scenario.

- Persistent aliases, duplicate aliases and concurrent config updates
- USB/Wi-Fi grouping, live identity lookup failures, exact transport selection
- Multiple instances of one AVD, including preventing mappings from moving to the remaining instance
- Targeted/all-device commands, preserved arguments, partial failure and timeouts
- Multi-device host output overwrite prevention
- Device/Mac port differences, stored offline mappings, repair and safe unbind
- Existing reverse conflicts and explicit replacement
- HTTP Metro response versus app connectivity (the app is not observed)
- Foreground/background watch, reconnect recovery, duplicate and concurrent startup
- Missing adb at startup, safe stop, crash lease expiry and restart
- Known mDNS service/GUID endpoint changes, ignoring unknown/pairing services

## Actual Android devices

Initial inspection found no devices. During final verification one emulator
became available: `emulator-5554`, AVD `Pixel_9_Pro_API_36`, Android 16.

Verified on that emulator using an isolated temporary config and a local HTTP
server implementing the Metro `/status` response:

- [x] Persistent alias used by a subsequent CLI process
- [x] ADB shell command and captured stdout
- [x] Device port 47651 mapped to a different dynamically assigned Mac port
- [x] `status` distinguishes ready reverse, running HTTP server and unknown app state
- [x] HTTP request from the emulator through the tunnel reaches the Mac and returns 200
- [x] Background watcher restores the tunnel after it is removed externally
- [x] Stop and unbind remove test resources without leaving a running watcher

This was a test HTTP server, not an RN app or actual Metro process. It validates
the ADB tunnel and recovery path but does not establish Fast Refresh behavior.
No USB/Wi-Fi physical devices or discovered mDNS services were available.

The following remain to be checked with hardware and running RN projects:

- [ ] USB phone + Wi-Fi phone + two emulators connected simultaneously
- [ ] Multiple devices receiving updates from one Metro
- [ ] Different projects/Metro ports assigned to different devices
- [ ] USB unplug/replug with recovery and no impact on other devices
- [ ] Wireless reconnect after IP/port change and after wireless debugging toggle
- [ ] Mac sleep/wake with automatic recovery
- [ ] Metro stop/restart, preserving the reverse rules
- [ ] USB/Wi-Fi dual transport on the same real phone
- [ ] Correct project visible and actual Fast Refresh on every device

## Packaging

`npm pack` and installation of the tarball into a temporary prefix with
`--omit=dev` succeeded. The installed executable's help and device query were
verified. No global install or npm publication was performed.

## Cleanup

`adbdock stop` leaves saved mappings and current tunnels intact. Remove a mapping
with `adbdock metro unbind <alias> --device-port <port>` while the device is online.
External changed rules are preserved. Initial pairing and wireless debugging
settings remain under the user's control.
