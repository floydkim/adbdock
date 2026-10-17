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
- [x] Short Mac sleep/wake: process survival, Metro HTTP and post-wake repair (see below)
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


## Actual Mac sleep/wake — 2026-10-17

The user disabled Vorssaint sleep prevention and put the Mac to sleep manually.
macOS `pmset -g log` recorded software sleep at 15:02:43 +0900, a maintenance
DarkWake at 15:03:14, maintenance sleep at 15:03:59, and user wake at 15:05:02.
The two sleep intervals were 31 and 63 seconds, separated by 45 seconds of
DarkWake. This was one short physical sleep/wake run, not a long-term test.

Before and after: Galaxy Z Flip4 used Wi-Fi `192.168.219.106:37895`, device
8081 → host 8082 (Metro B); emulator-5554 used device 8081 → host 8081
(Metro A). Watcher PID 2731 and Metro PIDs 82788/9049 retained their original
start times. Both devices remained online with the same reverse rules; actual
Android HTTP requests returned 200 and the expected distinct Metro project-root
headers. No manual reconnect, repair, watcher restart or Metro restart was used.

To confirm that the surviving watcher was doing work after wake, removed only
the emulator's managed tcp:8081 rule. It reappeared within 0.868 seconds of the
post-removal polling start, and Android-to-Metro HTTP succeeded again. This is
one observed repair time, not a timing guarantee. The deliberate rule removal
was a separate post-wake check; the sleep itself did not require reconnection
or tunnel repair, so sleep-triggered reconnect behavior was not exercised.

Evidence: scratch `rn084-validation/sleep-before.json`, `sleep-after.json`,
`sleep-power.log` and `sleep-post-wake-repair.json`. RN rendering/Fast Refresh
was not rechecked in this run. Existing watcher, Metros and both mappings were
left running. Long-running reliability remains open.


## Guided wireless pairing — 2026-10-17

Added `pair` discovery/interactive selection, hidden code input, explicit pairing
and connection endpoints, optional alias, and JSON/stdin mode for agents. Codes
are sent to adb stdin and omitted from argv, output and saved config. The phone
pairing screen remains a required human step. Metro and watcher setup are separate.

First Flip4 attempt paired successfully but reported connection pending when
both the GUID property and ADB discovery were empty. Native Bonjour resolved the
known service, exposing a gap in post-pair verification. Added exact-GUID Bonjour
lookup and previously verified hardware/service association as fallbacks, while
rejecting a live conflicting GUID and never treating USB alone as wireless success.

After the fix, the actual Flip4 flow discovered its pairing screen, accepted a
six-digit code with a leading zero without echoing it, and returned paired=true /
connected=true. A fresh scratch config saved android:R3CW107212P, alias flip4 and
adb-R3CW107212P-MvgZG5, without Metro mappings or a watcher. This re-paired an
already trusted phone; existing trust was not deleted, so first-ever trust on a
previously unpaired phone was not separately exercised. No QR flow was added.

Review found two further boundaries: discovery errors after trust creation must
preserve paired=true and allow explicit --connect; a slow connect must always be
followed by device verification even after the polling window expires. Both were
reproduced with regression tests before fixing. Final typecheck and all 71 tests
passed, including macOS PTY selection/code hiding/Ctrl+C, partial success, GUID
mismatch, Bonjour fallback, alias conflicts and delayed connection verification.
Package check installed the 17-file tarball, ran installed pairing discovery,
watcher lifecycle, npm exec and publish dry-run; nothing was published.

Evidence: scratch pair-real-result.json, pair-checks.log and pair-package-checks.log.
The original watcher PID 2731 and mappings remained active. Actual Android HTTP
requests still reached Metro A for the emulator and Metro B for Flip4. The extra
scratch config has no watcher or reverse rules to clean up; ADB trust is retained.
App rendering/Fast Refresh was not rechecked for this pairing change.


## QR pairing — 2026-10-17

Added `pair --qr [--alias name]`: random per-run studio service/password,
terminal QR, exact-session ADB/Bonjour discovery, scan timeout and cancellation.
QR credentials go to adb stdin. Encoding uses qrcode-terminal 0.12.0; the CLI
creates no QR files and saves no plaintext passwords. Seven CLI regressions cover
matching-service selection, Bonjour, fresh credentials, timeout, cancellation,
ambiguous endpoints and redacted failure messages. Existing code pairing remains.

Actual Flip4 scan returned paired=true / connected=true and saved its verified
hardware identity, wireless service and alias flip4 in a fresh scratch config.
The phone scanned a PNG preview of the terminal encoder's exact matrix; terminal
font/theme readability was not separately exercised. Existing trust was retained,
and the test PNG was removed. Original watcher PID 2731, Metro mappings and actual
Android-to-Metro HTTP for phone/emulator remained healthy. App rendering/Fast
Refresh was not rechecked. Evidence: qr-real-result.json and qr-alias-checks.log /
qr-alias-package-checks.log in scratch rn084-validation. Nothing was published.


## Interactive device aliases — 2026-10-17

Added `alias` / `alias <device>` prompts with current aliases, models, connection
states and saved offline devices. Enter preserves the current name. Explicit
`alias <device> <name>` remains available for scripts and agents. Prompts do not
hold the config lock; saving rechecks conflicts using the selected stable ID.
Review reproduced another task moving the original alias to another phone while
the prompt was open. A failing PTY regression preceded the fix pinning hardware
identity before input. Eight new alias tests cover selection, rename/binding
preservation, offline selection, cancellation, conflicts, invalid selection,
noninteractive use and concurrent alias reassignment.

Actual phone/emulator list validation selected Flip4, renamed flip4 to flip4probe
in a scratch config and restored flip4 afterward. The original watcher and Metro
mappings stayed ready. Combined typecheck and all 86 tests passed, as did the
production-only package install, QR rendering/timeout, watcher lifecycle, npm exec
and publish dry-run. The workspace tarball included the pending bilingual READMEs;
README changes remain outside these feature commits. No package was published.
Evidence: qr-alias-checks.log and qr-alias-package-checks.log in scratch
rn084-validation. Actual QR scan evidence is recorded above.


## Watcher lifecycle commands — 2026-10-17

Added `watch start`, `watch stop` and `watch status`. Bare `watch` retains
foreground startup, including existing startup flags. Top-level `stop` is removed.
Global `status` continues to inspect devices/Metro/watcher; `watch status` uses
only watcher IPC and supports plain output and the existing JSON watcher field.
Watcher daemon IPC itself is unchanged, so the existing PID 2731 remained visible
without restarting or stopping it.

Migrated test teardown, device-runner cleanup, installed package checks and active
human/agent guides to `watch stop`. Typecheck and all 93 tests passed; focused
checks also verified plain running/stopped output and status without an ADB binary.
Package install verified start/status/stop, cleanup, QR/help, npm exec and publish
dry-run. Read-only review found no remaining important issue. No package was
published. Evidence: watch-subcommands-checks.log and
watch-subcommands-package-checks.log in scratch rn084-validation.

## Saved command aliases — 2026-10-17

Added `adb-alias add/list/edit/remove`, a bare interactive selector/editor, and
`@name -d <device>` / repeated `-d` / `--all` execution. Presets: shake, reverse,
screenshot. Scripts run in a separate host POSIX shell per device; plain adb calls
are pinned to that device. Positional parameters and environment variables support
reusable commands and unique filenames. Defaults can be edited/deleted persistently;
confirmation and config locks protect overwrites, including concurrent changes.
Timeout and Ctrl+C terminate owned process groups; no command is retried.

Reverse without arguments applies every saved mapping for each selected device,
falling back to 8081→8081; explicit arguments override for this run without changing
saved bindings. A real Flip4 capture revealed that screencap prints multi-display
warnings to stdout before the PNG. The preset now discovers the first physical
display ID and passes `-d` explicitly, with default capture when none is discovered.
A regression fixture reproduces the warning, and the resulting file is checked
byte-for-byte. Capture contents/UI correctness are separate from PNG validity.

Typecheck and all 112 tests passed (no skips). Production-only installed package
checks covered preset listing, custom registration/execution/removal, watcher
lifecycle, QR/help, npm exec and publish dry-run; nothing was published.
Read-only independent review found no important issue. The lightweight agent
reference was checked against a two-device command registration/execution scenario.

Galaxy Z Flip4 over Wi-Fi: preset screenshot produced a valid 1080×2640 PNG;
custom model command returned SM-F721N; custom alias removal succeeded. Isolated
config + unused device ports verified saved-mapping and explicit-argument reverse
behavior, unchanged saved bindings, and exact restoration of the original reverse
list. Original test/user config hashes were unchanged. No emulator was connected;
concurrent multi-device execution was verified with fake ADB, not real devices in
this run. Shake was not physically invoked; its ADB command is covered by fixtures.
No screenshot was included in the public evidence. Existing watcher was left running.

Evidence in scratch rn084-validation: command-alias-full-checks.log,
command-alias-package-checks.log, command-alias-device-validation.json.
README and existing bilingual packaging edits remain outside this feature commit.


The default screenshot command alias was subsequently renamed to `screencap`
to match ADB terminology.
The presets were then renamed to `menu` (formerly `shake`) and `screenshot`
(formerly `screencap`); current usage is `adbdock @screenshot -d <device>`.

## Automatic single-device targeting — 2026-10-17

ADB and saved command aliases now accept omitted target options when exactly one
logical device is online. Verified USB/Wi-Fi transports count once and retain USB
preference. Offline/unauthorized peers are excluded. Multiple online devices report
AMBIGUOUS_DEVICE; none report DEVICE_NOT_FOUND with connection/authorization guidance.
Explicit target validation and the --all/--device conflict remain enforced.

Typecheck and all 118 tests passed, including shared ADB/alias single-target,
USB/Wi-Fi grouping, unavailable-peer, zero-target and ambiguity boundaries.
Installed package checks exercised an alias without a target on one fake device.
Independent review found no important issue and passed the four new boundary tests.
The real setup had two online logical devices, so only rejection of implicit
multi-device ADB execution was physically checked; no devices were disconnected
for this test. Single-device success was validated with fake ADB, not a physical
single-device setup in this run. No UI command was sent to real devices.
Evidence: auto-target-checks.log and auto-target-package-checks.log in scratch
rn084-validation. No package was published.

## Expanded regression boundaries — 2026-10-17

Reviewed CLI target/argument routing, command registry/execution, Metro ownership,
watcher recovery and pairing partial success against their automated tests.
Added named ADB/alias selection scenarios, literal option/empty argument forwarding,
timeout policy, deleted/unknown alias handling, concurrent config writes and
interactive delete races. Capture failure and display-ID fallback now run through
the actual default script, alongside reverse early failure and the 4 MiB output
limit. Ctrl+C covers four active jobs plus two queued targets and checks child PIDs.

The fake ADB now supports command-specific failures, connection refusal, and real
--no-rebind rejection when another rule appears before creation. Those failure/race
scenarios were first observed failing with the old fixture, then passed after the
fixture gained the missing behavior. No production behavior was changed.
Metro tests cover external rule ownership, create-time races and partial repair;
watch tests verify healthy-device repair during another failure and no recreation
for three observed discovery cycles after unbind. Pair tests reject GUID-only
registration when hardware identity is unverified and preserve pairing-success
state after connection refusal.

Typecheck and all 148 tests passed without skips, including subprocess and PTY
flows. Production-only package install, npm exec and publish dry-run passed;
nothing was published. Independent review led to tightening the watcher failure
assertion to inspect calls only after watcher startup; that scenario was rerun
successfully. The testing guide now maps behaviors to files and explains focused
execution. No physical devices, real pairing, sleep or RN UI/HMR checks were run
for this test-only expansion. Existing real-device/watcher configurations stayed
outside the test fixtures. Evidence: expanded-regression-checks.log,
expanded-regression-package-checks.log, regression-boundaries-checks.log and
regression-recovery-checks.log in scratch rn084-validation.
