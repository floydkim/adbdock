# adbdock

A multi-device ADB CLI with optional Metro connection recovery.

Requires macOS, Node.js 22+, and `adb` on PATH.

## Install

After the first npm release:

```sh
npm install --global adbdock
adbdock --help
adbdock devices
```

Or run without a global installation:

```sh
npx --yes adbdock@0.1.0 devices
```

Install Android SDK Platform-Tools separately and authorize each device with ADB.
adbdock does not bundle adb, start emulators, or perform initial wireless pairing.

To use a development checkout before the first release:

```sh
npm ci
npm run build
npm link
adbdock devices
```

`npm unlink --global adbdock` removes the development link. Publishing requires
maintainer action; preparing this repository does not publish or reserve its name.

## Devices and aliases

```sh
adbdock devices
adbdock alias <serial> pixel
adbdock adb --device pixel -- shell getprop ro.product.model
adbdock adb --device pixel --device galaxy -- install ./app.apk
adbdock adb --all --json -- shell getprop ro.product.model
```

Aliases persist in `~/Library/Application Support/adbdock/config.json`.
USB is preferred when USB and Wi-Fi transports report the same hardware identity.
Use an exact transport serial to select a connection explicitly.

`adb` requires explicit targets and `--` before ADB arguments. Commands run on at
most four devices at once. Results include each device's stdout, stderr, exit code
and timeout status. Failed commands are never automatically repeated. The default
timeout is 10 seconds; set `--timeout 120000` before `--` for longer installs.
Host commands and interactive/streaming sessions are not supported by this runner.
`pull` and `bugreport` require one device so concurrent commands cannot overwrite
the same host output file.

Use `ADBDOCK_ADB` for a specific adb executable and `ADBDOCK_HOME` for a separate
configuration directory. Installation does not change device settings. The default test suite uses fixtures;
the opt-in real-device suite creates and removes temporary reverse tunnels.

## Optional Metro connections

```sh
adbdock metro bind pixel --port 8081
adbdock metro bind galaxy --port 8082
adbdock metro bind emulator-5554 --port 8083 --device-port 8081
adbdock status --json
adbdock metro repair --all
adbdock metro unbind galaxy
```

`--port` is the **Mac Metro port**. `--device-port` defaults to 8081. For example,
Galaxy's `localhost:8081` can reach the Mac's Metro on 8082 without changing the app.
The app must use `localhost:<device-port>`; adbdock does not rewrite the app's
developer server settings or start Metro. Devices without a mapping require no Metro.

Mappings are saved even if a remembered device is disconnected. `repair` applies
them later. Existing external reverse rules are preserved unless `bind --replace`
is explicit. `unbind` only removes a tunnel created by adbdock that still matches
the last applied port. A matching pre-existing external rule is not adopted.
When multiple mappings exist on one device, specify `--device-port` for unbind.

`status` reports ADB state, reverse rules and the Mac's Metro `/status` separately.
It cannot verify that the app uses the tunnel or that Fast Refresh works.

JSON output uses `{schemaVersion, ok, data, errors}`. Exit codes: 0 success,
1 operation/partial failure, 2 invalid arguments, 3 missing/ambiguous/unavailable
device, 4 watcher control failure. A successful `status` query can include
unhealthy devices. Errors do not cause arbitrary ADB commands to be retried.

## Keep connections alive

```sh
adbdock watch                 # foreground; Ctrl-C to stop
adbdock watch --background    # detached from this terminal
adbdock status --json         # includes watcher identity/state
adbdock stop                  # stop either kind of watcher
```

One watcher runs per configuration directory. It checks saved mappings every two
seconds and restores missing tunnels. Failures back off up to 30 seconds; a
changed transport or mapping resets that delay. New devices get no automatic
Metro mapping. `stop` preserves saved mappings and existing tunnels.

CLI changes and recovery use the same configuration lock. Watcher lifetime uses
a separate heartbeat lease; after a crash, allow about 10 seconds before restart.
Control uses a local Unix socket under an owner-only directory in `/tmp`, without
sending signals to saved PIDs. `watch.log` in the config directory records state
changes, rotating at approximately 1 MiB with one previous log retained.

### Wireless recovery

First pair and connect the device using Android Studio or `adb pair` / `adb connect`.
Register its alias while online. adbdock remembers its TLS service name and, when
available, `persist.adb.wifi.guid`. While watching, a disconnected remembered
device can reconnect to the matching `_adb-tls-connect._tcp` service's current IP
and port. This also works without a Metro mapping. Devices are identified again
after connecting before a saved mapping is applied.

On macOS, if ADB discovery has no match for a remembered device, the watcher also
queries that saved service name through the built-in Bonjour `dns-sd` tool and
resolves its current IPv4 address. Each query is limited to 1.5 seconds and is
cancelled when the watcher stops. A normal service and address lookup takes up
to three seconds, in addition to the polling interval and ADB commands.

Unknown services and pairing endpoints are ignored. Multiple matching endpoints,
unavailable mDNS, missing identity information, or disabled wireless debugging
require manual intervention. Legacy `adb tcpip` devices can be used while
connected, but stale IP addresses are not automatically retried. The tool does
not turn wireless debugging on or perform initial pairing.

If the GUID is unavailable (observed on Galaxy Z Flip4), a live IP:port transport
with a verified hardware identity can remember the unique mDNS service advertised
at that same endpoint. No hardware-ID prefix guesses or stale-IP matching are used.

### Fast Refresh after a disconnect

Restoring ADB and the reverse tunnel does not recreate a closed RN HMR socket.
In the RN 0.84.1 device test, Fast Refresh needed an explicit app Reload after a
wireless ADB disconnect. `watch` does not reload apps or reset their state.
Changing a Metro mapping can also require a Reload for existing connections to
use the new target. `status` intentionally reports app connectivity as unknown.

The service/GUID behavior follows the [Android ADB Wi-Fi architecture](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md).

## Verification and limits

From a source checkout, run `npm run check` for type checking and isolated CLI regression tests. For an
opt-in real-device check, pass explicit ADB serials:

```sh
npm run test:devices -- --device <serial-a> --device <serial-b>
```

This uses temporary configuration and reverse ports, local HTTP probe servers,
and its own watcher. It verifies Android-to-host traffic, shared/separate ports,
repair and conflict handling, and writes a JSON report under `.test-results/`.
It does not install an app or verify RN Fast Refresh. See the
source-checkout runbook `docs/testing.md` for automation, RN/LLM scenarios and cleanup.

See source-checkout validation record `docs/manual-validation.md`
for scenario coverage and pending checks. RN 0.84.1 was tested on an Android 16
emulator and a Galaxy Z Flip4 over Wi-Fi: shared/separate Metros, state-preserving
Fast Refresh, missing-tunnel recovery and wireless ADB reconnect. These are short
functional checks, not a long-running stability or sleep/wake assessment.

Multiple instances of the same AVD have no unique persistent AVD identity. Exact
serial selection remains available, but a mapping created in that ambiguous state
is not migrated to another instance when one disappears. Use distinct AVDs for
persistent mappings across restarts.


## Claude Code and Codex plugins

The Git repository also provides a small instruction-only plugin for Android
device selection, multi-device checks and Metro recovery. Its shared skill reads
short reference files only when needed. It needs the CLI installed separately;
there are no hooks, MCP servers or automatic CLI installation.

After this repository is published on GitHub, replace `OWNER/REPO` below with its
actual address (none is configured yet):

```sh
# Claude Code
claude plugin marketplace add OWNER/REPO
claude plugin install adbdock@adbdock

# Codex CLI with plugin commands
codex plugin marketplace add OWNER/REPO
codex plugin add adbdock@adbdock
```

For local testing, use the absolute checkout path instead of `OWNER/REPO`.
Open a new session after installation. The skill can be selected for relevant
Android tasks; it does not force invocation or allocate devices/ports for agents.
Both hosts use `plugins/adbdock/skills/adbdock/SKILL.md`. Marketplace/manifest
files differ by host. Plugins ship through Git; they are not included in the npm
CLI tarball. This preparation has not installed or published either plugin.

## Maintainers

Run `npm run check` and `npm run check:package` before release. The latter packs
and installs the actual tarball under a temporary global prefix, verifies its CLI
with production dependencies only, and removes its test resources. Full release
steps are in `docs/releasing.md` in the source checkout.

The npm package includes compiled CLI JavaScript, this README and the MIT license.
It does not include development tests, device logs, local configuration or TypeScript
build tools. The install commands above require the first release to exist.

## License

MIT. See LICENSE.
