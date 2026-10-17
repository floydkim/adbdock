# adbdock

A multi-device ADB CLI with optional Metro connection recovery.

Requires macOS, Node.js 22+, and `adb` on PATH.

```sh
npm ci
npm test
node dist/cli.js --help
```

To put the development checkout on PATH after building:

```sh
npm link
adbdock devices
```

`npm unlink --global adbdock` removes that link. This repository is private in
package.json to prevent accidental publication; no npm name reservation is implied.

## Devices and aliases

```sh
node dist/cli.js devices
node dist/cli.js alias <serial> pixel
node dist/cli.js adb --device pixel -- shell getprop ro.product.model
node dist/cli.js adb --device pixel --device galaxy -- install ./app.apk
node dist/cli.js adb --all --json -- shell getprop ro.product.model
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
configuration directory. Installation and automated tests do not modify real devices.

## Optional Metro connections

```sh
node dist/cli.js metro bind pixel --port 8081
node dist/cli.js metro bind galaxy --port 8082
node dist/cli.js metro bind emulator-5554 --port 8083 --device-port 8081
node dist/cli.js status --json
node dist/cli.js metro repair --all
node dist/cli.js metro unbind galaxy
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
node dist/cli.js watch                 # foreground; Ctrl-C to stop
node dist/cli.js watch --background    # detached from this terminal
node dist/cli.js status --json         # includes watcher identity/state
node dist/cli.js stop                  # stop either kind of watcher
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

Run `npm test` and `npm run typecheck`. See [validation record](docs/manual-validation.md)
for scenario coverage and pending checks. RN 0.84.1 was tested on an Android 16
emulator and a Galaxy Z Flip4 over Wi-Fi: shared/separate Metros, state-preserving
Fast Refresh, missing-tunnel recovery and wireless ADB reconnect. These are short
functional checks, not a long-running stability or sleep/wake assessment.

Multiple instances of the same AVD have no unique persistent AVD identity. Exact
serial selection remains available, but a mapping created in that ambiguous state
is not migrated to another instance when one disappears. Use distinct AVDs for
persistent mappings across restarts.
