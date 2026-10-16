# adbdock

A multi-device ADB CLI with optional Metro connection recovery.

Requires macOS, Node.js 22+, and `adb` on PATH.

```sh
npm ci
npm test
node dist/cli.js --help
```

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
