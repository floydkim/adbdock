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
- [x] Multiple devices receiving updates from one Metro
- [x] Different projects/Metro ports assigned to different devices
- [ ] USB unplug/replug with recovery and no impact on other devices
- [ ] Wireless reconnect after IP/port change and after wireless debugging toggle
- [ ] Mac sleep/wake with automatic recovery
- [x] Metro stop/restart, preserving the reverse rules (explicit RN Reload required)
- [x] USB/Wi-Fi dual transport on the same real phone
- [x] Correct project visible and actual Fast Refresh on every tested device

## Packaging

`npm pack` and installation of the tarball into a temporary prefix with
`--omit=dev` succeeded. The installed executable's help and device query were
verified. No global install or npm publication was performed.

## Cleanup

`adbdock stop` leaves saved mappings and current tunnels intact. Remove a mapping
with `adbdock metro unbind <alias> --device-port <port>` while the device is online.
External changed rules are preserved. Initial pairing and wireless debugging
settings remain under the user's control.

## Follow-up: RN 0.84.1 on two devices

Used a temporary Community CLI app with New Architecture and Hermes enabled.
Built one arm64-v8a debug APK and installed it on both devices via one adbdock
multi-device command. Native build completed with Android Studio's JBR 21.

Targets: Android 16 emulator (Pixel 9 Pro API 36) and Samsung Galaxy Z Flip4
(SM-F721N, Android 15) over TLS wireless ADB. Both app debug-server addresses were
explicitly localhost:8081 so that the emulator also exercised reverse tunnels.
Two source roots served distinguishable App screens through Metro 8081 and 8082.
Test aliases and bindings used an isolated ADBDOCK_HOME.

| Scenario | Observed result |
|---|---|
| Both devices on Metro A:8081 | Both rendered A1, then A2 via Fast Refresh; counters stayed at 1 |
| Galaxy switched to Metro B:8082 | Same native APK rendered B1 after app relaunch; emulator stayed on A2 |
| Update A only | Emulator reached A3 with counter 1; Galaxy remained B1 with counter 1 |
| Update B only | Galaxy reached B2 with counter 1; emulator remained A3 with counter 1 |
| Remove Galaxy reverse rule | Watcher restored device 8081 → host 8082; one observed recovery took 574 ms |
| Disconnect Galaxy wireless ADB | Watcher issued adb connect to the discovered endpoint and restored the mapping; one observed recovery took 2490 ms |
| Fast Refresh after wireless disconnect | Did not automatically recover: Galaxy stayed B2 although runtime/ADB reconnected |
| Explicit Reload after recovery | Loaded B3 (counter reset), then Fast Refresh to B4 preserved counter 1 |
| Other device during Galaxy disconnect | Emulator continued to A4 with counter 1 |

The reload requirement was confirmed in the installed RN source:
`react-native/Libraries/Utilities/HMRClient.js` handles socket close by reporting
Fast Refresh as unavailable and asking for a Reload. The installed
`metro-runtime/src/modules/HMRClient.js` does not reopen the closed socket.

The Galaxy returned an empty persist.adb.wifi.guid. The original implementation
therefore missed reconnect metadata for IP:port connections. Added a regression
test, observed it fail, then recorded the unique advertised TLS service for a
verified live endpoint. All 38 CLI boundary tests and typecheck passed afterward.

Initial emulator app launch stalled, with ADB shell timing out while Galaxy
remained responsive. A device-scoped adb reconnect restored shell access; after
the watcher restored the tunnel, app relaunch succeeded. Its low-RAM launch
configuration was observed, but the stall's root cause was not established.

At this phase, additional physical-device and recovery scenarios were pending.
The follow-up below records which were subsequently covered. The recovery timings
above are single observations.

## Follow-up: remaining autonomous scenarios

Created a temporary second AVD (`AdbDock_Test_API36`) from the existing API 36
system image. No extra system image download was needed. Tested Galaxy over Wi-Fi
plus the original emulator and this second emulator simultaneously.

| Scenario | Observed result |
|---|---|
| Three-device generic ADB command | Returned separate correct results for the Galaxy and both emulators |
| Two emulators sharing Metro A, Galaxy on Metro B | All three rendered the correct source and preserved counter 1 through Fast Refresh |
| Stop Metro B | Galaxy reverse stayed ready; server became unreachable; Metro A updates still reached the original emulator with counter 1 |
| Restart Metro B | Server became running; explicit Reload loaded B5, then B6 Fast Refresh preserved counter 1 |
| External change of temporary tcp:8484 mapping | Watcher reported REVERSE_CONFLICT and preserved the external target |
| Unbind that externally changed mapping | Removed desired config, preserved external tunnel, reported REVERSE_CONFLICT; test-owned external tunnel was then cleaned up |
| Suspend watcher process for 12 seconds | Same watcher survived; missing emulator tunnel restored about 607 ms after SIGCONT |
| Restart second AVD on a different console port | Serial changed emulator-5556 → emulator-5560; saved alias emulator2 and mapping followed the AVD identity |
| App after AVD serial change | Loaded A6; A7 Fast Refresh preserved counter 1 |
| Empty mDNS discovery plus wireless disconnect | Logged WIRELESS_NOT_DISCOVERED; retained saved device/config; both emulators remained ready; manual adb connect restored Galaxy |

At the end all three showed A7/A7/B7 with counter 1. Captured screenshots and UI
snapshots before cleanup. Removed the temporary mapping, stopped/deleted the
temporary AVD and removed only its alias from the isolated test config. Original
emulator, Galaxy, both Metros and the existing watcher were preserved.

The 12-second process suspension is not an actual Mac sleep/wake test. Current
ADB mDNS discovery was empty despite an existing wireless connection; automated
wireless reconnect depends on advertised discovery and cannot be guaranteed in
that condition. This is separate from the prior successful discovered-service
reconnect test. No implementation changes were made for these scenarios.

Still requires human/device preparation: physical USB connection and unplug/replug,
USB/Wi-Fi dual transport, wireless debugging toggle with a recovery path, actual
wireless IP/port change, Mac sleep/wake and long-running stability assessment.


## Follow-up: USB / wireless dual transport and physical unplug

Connected the same Galaxy over USB and TLS Wi-Fi. adbdock grouped both
transports into one `flip4` device, preferred USB for alias commands, and returned
one phone result with `adb --all` (plus one emulator result).

Disconnected the Wi-Fi transport while leaving USB attached. Fast Refresh B7 → B8
preserved counter 1, establishing that this path actually used USB. With USB as a
recovery path, toggled `adb_wifi_enabled` off/on; the advertised TLS port changed
39899 → 40635. Wireless debugging was left enabled. USB Fast Refresh B8 → B9
also preserved counter 1. The watcher did not connect Wi-Fi while USB was online.

After the human physically unplugged USB, immediate failover failed: ADB's mDNS
list was empty and the watcher reported WIRELESS_NOT_DISCOVERED. A TCP probe found
the new port reachable and macOS `dns-sd -L` resolved the exact remembered service
to port 40635 even while ADB discovery was empty. Later ADB discovery recovered;
the recording wrapper captured watcher `adb connect 192.168.219.106:40635` at
03:56:31.987 UTC and reverse creation at 03:56:32.516 UTC. Ready was logged at
03:56:32.655 UTC, about 121 seconds after the first recorded discovery failure.
The exact physical-detach timestamp was not captured, so this is not a measured
unplug-to-recovery duration. No manual adb connect or production changes were
made during this recovery; native Bonjour diagnostics may have affected discovery,
and the cause of ADB's eventual recovery was not established.

The alias and device 8081 → host 8082 mapping survived. Emulator Fast Refresh
A8 → A9 preserved counter 1. Galaxy stayed B9 after a B10 edit; explicit Reload
loaded B10 with counter 0, then B11 Fast Refresh preserved counter 1. This confirms
tunnel recovery separately from the RN HMR reconnection limitation.

Outcome: delayed automatic recovery observed; prompt, reliable USB-to-Wi-Fi
failover is not established. A macOS Bonjour fallback for remembered service names
is a candidate improvement, not implemented or validated. Restored the normal
watcher after recording. At that phase, physical USB replug, IP changes, actual Mac sleep/wake
(deferred by user), and long-running stability remain unverified.


## Follow-up: physical USB replug

After the human reconnected the cable, the phone appeared as USB R3CW107212P;
the previous wireless endpoint was offline and discovery advertised port 43091.
`status` selected USB with the same flip4 alias and ready 8081 → 8082 mapping.
The alias command used the USB transport and `adb --all` returned exactly two
results: one phone and one emulator. The existing watcher remained active.

The emulator refreshed A9 → A10 with counter 1. Galaxy stayed B11 throughout 12
snapshot checks after editing B12. Explicit Reload over USB loaded B12 with
counter 0; pressing the counter and editing B13 then preserved counter 1 through
Fast Refresh. Captured updated screenshots. USB replug/selection and tunnel
availability passed; automatic HMR recovery across the transition did not.

These USB tests changed only scratch app revisions and validation documentation;
production code was unchanged. Reliable low-latency wireless discovery, a real
IP-address change, actual Mac sleep/wake and long-running stability remain open.


## Follow-up: macOS Bonjour fallback

Added a bounded native Bonjour lookup when ADB discovery has no matching saved
service for a disconnected device. Only remembered TLS connection service names
are queried; service lookup and IPv4 address lookup each run for at most 1.5
seconds. Multiple endpoints still produce WIRELESS_AMBIGUOUS. The existing live
hardware-ID verification remains the condition for applying a saved mapping.

The new CLI boundary test first failed without the fallback, then passed. All 47
tests and typecheck passed. Added coverage for missing/unrelated services, invalid
ports, ambiguous endpoints, bypassing Bonjour when ADB already has a match,
terminating an active query on watcher stop, and refusing a saved mapping when the
connected hardware ID differs. Bonjour-specific cases run only on macOS; other
platforms retain the existing ADB discovery path. Test fixtures isolate native
Bonjour calls as well as ADB, so unit tests do not query the real network.

A separate test used the real Galaxy and macOS dns-sd, with a wrapper returning
an empty ADB mDNS list and hiding USB from adbdock's device list. The watcher
queried Bonjour, issued adb connect to the currently advertised port 43091,
verified the Galaxy identity, and reported ready after about 4.5 seconds including
watcher startup and polling. This was an injected transport-list test, not a
physical USB detach, and does not establish physical handoff latency. No new
runtime dependency or production test export was added.

Physical USB detach under an injected empty ADB discovery list subsequently
passed. The native Bonjour path and actual transport list were unmodified by the
wrapper. Last USB-present poll began at 04:18:47.567 UTC; first USB-absent poll at
04:18:49.822. The watcher issued connect to 192.168.219.106:43091 at 04:18:52.922,
created the missing 8081 → 8082 reverse at 04:18:53.382, and began reverse
verification at 04:18:53.424. This is approximately 3.6 seconds from first observed
absence to reverse verification, not from the exact physical detach time. These
are command-start timestamps from one trial; the following emulator reverse
command started 42 ms after phone verification began.

Alias, verified hardware identity and Metro mapping were preserved. Emulator
Fast Refresh A10 → A11 preserved counter 1. Galaxy stayed B13 after a B14 edit;
explicit Reload loaded B14 with counter 0, then B15 Fast Refresh preserved counter
1. Restored the normal watcher with no ADB wrapper after testing. Both Metros and
existing desired mappings remain active. This establishes one successful physical
handoff using native Bonjour under a deliberately empty ADB discovery result;
it does not establish behavior on every network, actual IP-address changes,
Mac sleep/wake or long-running reliability. No commit has been made yet.


## Follow-up: repeatable device regression automation

Added `npm run check` (typecheck plus all CLI tests) and opt-in
`npm run test:devices -- --device <serial> ...`. The runner has no external runtime
dependency. It uses its own config, watcher, local HTTP servers and a temporary
reverse port, and selects only explicit live serials (one per physical device).
Android-initiated HTTP responses must contain the intended server's unique
marker, independently of the host Metro-status response.

All 53 boundary tests and typecheck passed. Added runner coverage for success,
required explicit targets, failed device HTTP probes, SIGINT during a probe, and
interruption after watcher startup or reverse creation but before their CLI
responses. The latter two initially exposed cleanup races during review; the
bind regression was observed failing with a remaining tunnel, then passed after
waiting for finite CLI commands and checking/removing own remaining rules.
Read-only review confirmed the two fixes and independently reran both regressions.

Executed the final runner against the existing Pixel emulator and Wi-Fi Galaxy:
all six checks passed (aliases/commands without Metro, shared and separate host
ports, watcher restoration, server stop/restart, external conflict preservation).
The JSON report recorded cleanup.ok=true and its temporary config was removed.
The original 8081 → 8081 emulator and 8081 → 8082 Galaxy rules, both Metros and
original watcher were verified unchanged afterward. An initial real-device probe
failed because toybox nc exited on stdin EOF before sending; keeping stdin open
briefly fixed the probe, and cleanup preserved the original environment even on
that failed run.

`docs/testing.md` contains a reusable human/LLM runbook. It distinguishes these
HTTP tunnel tests from real RN rendering and state-preserving Fast Refresh,
provides RN source/port/debug-host setup and evidence requirements, and separates
human USB/sleep actions from automated checks. Sleep remains deferred and
long-running stability will be evaluated during real work. This automation run
did not reinstall the RN app or repeat every RN UI scenario.


## Follow-up: npm release preparation and lightweight agent plugins

Prepared adbdock@0.1.0 for npm with user-selected MIT licensing, executable bin,
public registry configuration, prepack build and prepublishOnly checks. The
consumer prepare hook was removed. The registry query returned E404 for adbdock
at preparation time; this does not reserve the name or guarantee publication.
No Git remote exists yet, so repository URLs were not invented.

All 53 tests and typecheck passed. `check:package` packed the actual 15-file
artifact, installed production dependencies under a temporary global prefix,
verified installed help/devices/background watcher start-stop, npm exec (npx
path) and publish dry-run. A separate SIGINT injection immediately after watcher
startup verified that the checker stopped its own watcher and removed temporary
config. The tarball is CLI JS, README, LICENSE and package.json only; source,
device evidence and Git plugins are excluded. Nothing was published.

Added a Git-based plugin shared by Claude Code and Codex: a 17-line/143-word
SKILL.md with three on-demand references (15, 15, 21 lines). Both marketplaces
point at the same plugin directory. There are no hooks, MCP servers or automatic
CLI installation. Skill guidance distinguishes device/port allocation, config
isolation versus physical rules, task-owned watcher cleanup and UI/HMR evidence.

Claude strict plugin and marketplace validation passed without warnings. The
portable plugin passed its official JSON schema, the skill passed quick_validate,
and all local reference links resolved. Codex CLI 0.162.1 listed adbdock@adbdock
as available using command-local marketplace overrides without installation or
user settings changes. Read-only review found no important issue. Actual plugin
installation, new-session skill selection, Git hosting and public publication
remain unverified/not performed. CLI and plugin instructions are not public yet.
