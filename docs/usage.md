# Usage guide

**English** | [한국어](usage.ko.md)

See the [README](../README.md) for installation and a quick start.
Here, `phone` and `emulator` are device aliases saved with `adbdock alias`.
A device alias identifies the target; a command shortcut such as `@menu` identifies what to run.

## Device selection and aliases

Run `adbdock alias` to select a device and set or change its name.
Remembered offline devices can be renamed too. For scripts, provide both values
with `adbdock alias <device> <name>` instead of using interactive input.

ADB commands and command shortcuts use the same target options:

- `-d phone`: select one device. Repeat it for several: `-d phone -d emulator`.
- `--all`: select every online device. Cannot be combined with `-d`.
- No target: automatically select the device when exactly one is online and available.

USB and Wi-Fi connections of the same verified phone are grouped, with USB preferred.
Pass an exact live ADB serial to select a specific connection.
Offline and unauthorized devices are excluded from automatic selection; explicitly targeting one returns an error.

Separate adbdock options from ADB arguments with `--`. The default per-device
timeout is 10 seconds; put `--timeout 120000` before `--` for longer operations.
Interactive shells and streaming commands are unsupported. `pull` and `bugreport` require one device.

## Wireless pairing

On Android 11+, connect the phone and Mac to the same Wi-Fi network. Run:

```sh
adbdock pair --qr --alias phone
```

On the phone, open **Developer options → Wireless debugging → Pair device with
QR code** and scan the terminal QR. adbdock waits up to 60 seconds; use
`--timeout 120000` for a longer scan window, or Ctrl+C to cancel.

Alternatively, open **Pair device with pairing code**, then run:

```sh
adbdock pair --alias phone
```

Choose a discovered device if several appear and enter the six-digit code.
Input is hidden. adbdock pairs, verifies the wireless connection and saves the
alias and service information for future recovery. It does not configure Metro
or start a watcher; use `adbdock watch start --background` for ongoing recovery.

If discovery is unavailable, specify the pairing screen's address. `--connect`
accepts the **separate connection address** from the main Wireless debugging
screen, not the pairing port:

```sh
adbdock pair 192.168.0.7:37000 --connect 192.168.0.7:45000 --alias phone
```

For coding agents, list pairing targets as JSON, then supply one six-digit code
line through the second command's stdin:

```sh
adbdock pair --list --json
adbdock pair <ip:pairing-port> --alias phone --code-stdin --json
```

There is no code argument. adbdock does not write codes to its output, config or
logs. Pairing and connection are separate: a nonzero result may still report
`paired: true`. Check `connected` and the error before retrying; pairing is not
undone if connection or alias registration fails. You can finish connecting with
`adb connect <ip:connection-port>` and save the alias with `adbdock alias`.
Initial pairing requires the phone's pairing-code screen or QR scanner.

## Saved ADB commands

Built-ins are ready to use; Metro setup is unnecessary:

```sh
adbdock @menu -d phone
adbdock @screenshot -d phone -d emulator
adbdock @reverse -d phone
adbdock @reverse -d phone -- 8082 18081
```

`menu` opens the React Native developer menu (keyevent 82). `screenshot` saves
one PNG per device in the current directory, with a unique filename, and prints
its path. Without arguments, `reverse` applies each device's saved Metro mappings,
or device 8081 → host 8081 when none are saved. The example with arguments maps
device 18081 → host 8082 for this run. It does not change saved mappings; a watcher
reports conflicting rules instead of replacing them.

Save a script using **single quotes** so your terminal does not expand variables
before registration:

```sh
adbdock adb-alias add model 'adb shell getprop ro.product.model > "$ADBDOCK_DEVICE-$ADBDOCK_RUN_ID.txt" && open .'
adbdock @model --all
adbdock adb-alias list
adbdock adb-alias edit model
adbdock adb-alias remove model
```

Run `adbdock adb-alias` to select, edit or delete an entry interactively. Adding an
existing name asks before overwriting; scripts can use `--force`. Built-ins can be
edited or deleted too. Entries persist in the configuration directory.

Scripts run once per selected device in `/bin/sh`. Each plain `adb` call is routed
to that device. `$1`, `$2`, etc. receive arguments after `--`. Available variables:

| Variable | Value |
|---|---|
| `$ADBDOCK_DEVICE` | Filename-safe device alias, or serial |
| `$ADBDOCK_MODEL` | Filename-safe model |
| `$ADBDOCK_SERIAL` | Original transport serial |
| `$ADBDOCK_RUN_ID` | Unique timestamp/UUID per device execution |
| `$ADBDOCK_REVERSE_PORTS` | Saved `device:host` pairs, or `8081:8081` |

Scripts can run local commands and redirect files, so save trusted commands and
use unique paths for multiple devices. They share your current directory. The
10-second timeout can be changed with `--timeout`; Ctrl+C stops active command
groups. Failed commands are not retried, and the watcher never runs command aliases.

## React Native and Metro

Start each project's Metro server yourself. To use adbdock's tunnel, the app's
development server address must be `localhost:<device-port>`. Here, `localhost`
means the Android device itself, not your Mac. ADB reverse forwards this connection
to Metro on your Mac. This applies to emulators too.

- `--port`: **the port where Metro is running on your Mac**
- `--device-port`: **the port the app connects to inside Android**, default **8081**

The CLI does not change the app's server address. If the app uses another address,
change its settings yourself.

Direct connections to the Mac's
LAN IP or emulator host address `10.0.2.2` bypass ADB reverse, so adbdock's tunnel
repair does not apply to those connections.

### Share one Metro

```sh
adbdock metro bind phone --port 8081
adbdock metro bind emulator --port 8081
```

### Use different projects

Keep the emulator on Metro 8081 and move the phone to another project's Metro 8082:

```sh
adbdock metro bind phone --port 8082
```

| Device alias | Address used by the Android app | Metro port on your Mac |
|---|---|---|
| emulator | `localhost:8081` | Metro A on `8081` |
| phone | `localhost:8081` | Metro B on `8082` |

### Change the device-side port

If the app connects to `localhost:18081` and Metro runs on your Mac's port 8082:

```sh
adbdock metro bind phone --port 8082 --device-port 18081
```

This routes `device localhost:18081 → Mac Metro 8082`. Set the app's server address
separately. `bind` saves the mapping and tries to apply it immediately; start a
watcher for automatic recovery. Mappings persist even while a remembered device is offline.

An external reverse rule with a different destination is preserved and reported as
a conflict. Use `--replace` only when you intend to overwrite it. A matching external
rule is reused and is not removed by a later `unbind`. For a conflict, `status`
also shows the rule's current destination as `current`.

### Check whether the app uses the tunnel

A healthy reverse rule does not help if the app connects elsewhere. For example,
an emulator app with no address saved from the dev menu connects to `10.0.2.2:8081`,
which reaches your Mac's port 8081 directly. Save the app package with `--app` and
`status` reads the development server address saved in the app to report the real route.

```sh
adbdock metro bind emulator --port 8082 --app com.example.app
adbdock status --json
```

| `route` | Meaning |
|---|---|
| `tunnel` | The app connects to `localhost:<device-port>` and uses this tunnel |
| `other_port` | The app connects to another port on `localhost` |
| `direct` | The app connects to `10.0.2.2` or a LAN IP and bypasses the tunnel |
| `unknown` | The app settings could not be read (not a debug build or not installed) |

`host` is the address the app uses. When `source` is `default`, no address is saved
and adbdock assumes the React Native default with port 8081. adbdock only reads the
app settings and never changes them.

### Watch and repair

```sh
adbdock watch start --background
```

The background watcher survives closing the terminal. Start it again after rebooting your Mac.
To inspect its state:

```sh
adbdock watch status
adbdock status --json
```

To repair saved mappings once without a watcher:

```sh
adbdock metro repair --device phone
```

The watcher checks saved mappings approximately every two seconds and restores
missing tunnels. Retries back off up to 30 seconds. Run `adbdock watch` for
foreground operation instead, and stop it with Ctrl+C. `watch start` is the explicit equivalent.
Use `watch status` for watcher state alone; `status` also checks devices and Metro.
One watcher runs per configuration directory.

To stop watching or remove a mapping:

```sh
adbdock watch stop
adbdock metro unbind phone --device-port 8081
```

`watch stop` leaves saved mappings and current tunnels intact. The `unbind` example
removes the port 8081 mapping for the device aliased `phone`. It removes the tunnel
only if adbdock created it and it still matches the last applied destination.
Externally changed rules are preserved.

### Wireless recovery

Use `adbdock pair --alias phone`, or pair and connect with Android Studio / ADB
and save an alias while online. The watcher can reconnect a remembered TLS
service using its currently discovered IP and port, including a native Bonjour
lookup when ADB discovery has no match. This also works without Metro mappings.

Wireless debugging, pairing and network discovery must be available. Initial
pairing requires the phone’s pairing-code screen or QR scanner. Enabling wireless debugging is manual; stale
addresses are never guessed.
Legacy `adb tcpip` connections can be used while connected but are not automatically
reconnected by this discovery flow.

## Working with coding agents

See the [README](../README.md#claude-code-and-codex) for plugin installation.
Install the CLI and plugin in either order. If the installed skill does not appear
in the current session, start a new one. Automatic skill selection for relevant tasks is not guaranteed.

Update the plugin separately from the CLI. To fetch plugin changes from GitHub:

```sh
# Claude Code
claude plugin marketplace update adbdock
claude plugin update adbdock@adbdock
# Codex
codex plugin marketplace upgrade adbdock
```

Check the installed plugin version in your client and use it in a new session.
Update the CLI separately with `npm i -g adbdock@latest`.

For parallel tasks, assign device aliases and Metro ports to each task. adbdock
does not reserve resources. Separate `ADBDOCK_HOME` directories still share the
physical devices and their reverse rules.

## Configuration and diagnostics

| Setting | Purpose |
|---|---|
| `ADBDOCK_HOME` | Separate aliases, mappings, watcher and logs |
| `ADBDOCK_ADB` | Use a specific ADB executable |

The default home is `~/Library/Application Support/adbdock`. Aliases and mappings
live in `config.json`; watcher events go to `watch.log`, which rotates around 1 MiB.

Use `devices --json` and `status --json` to inspect failures. JSON has
`schemaVersion`, `ok`, `data` and `errors`; status also includes watcher information.
Exit codes are 0 for success, 1 for an operation/partial failure, 2 for invalid
arguments, 3 for target selection/availability errors and 4 for watcher control errors.
A successful status query can still report unhealthy devices.

## Limits

- **Tunnel recovery is not Fast Refresh recovery.** In RN 0.84.1 testing, a disconnected HMR socket needed an explicit app Reload. adbdock does not silently reload apps or reset state.
- `status` checks ADB, reverse rules and the host Metro separately. Apps saved with `--app` also report their connection address; still verify rendering and Fast Refresh in the app.
- Multiple running instances of the same AVD have no unique persistent AVD identity. Use distinct AVDs for mappings that should survive emulator restarts.
- Short functional tests covered real devices and emulators, shared/separate Metros, USB/Wi-Fi transitions and recovery. One short Mac sleep/wake test confirmed process survival, device-to-Metro HTTP communication and watcher repair after waking. Long-running reliability remains unverified.

## Development

To work on adbdock itself, clone the repository:

```sh
git clone https://github.com/floydkim/adbdock.git
cd adbdock
npm ci
npm run build
npm link
adbdock --help
```

To update the checkout, run `git pull`, then `npm ci && npm run build`.
Remove the development link with `npm unlink --global adbdock`.

Run checks from the source checkout:

```sh
npm run check
npm run test:devices -- --device <serial-a> --device <serial-b>
npm run check:package
```

`check` runs type checking and isolated regression tests. `test:devices` uses
explicit real devices, temporary ports/configuration and local HTTP probe servers;
it does not install apps or verify RN UI. `check:package` verifies the actual tarball,
production-only installation, CLI/watcher execution and a publish dry-run.

The source checkout includes [testing.md](testing.md) for human/LLM test procedures,
[manual-validation.md](manual-validation.md) for recorded results and [releasing.md](releasing.md) for release
steps. The npm package contains compiled CLI JavaScript, both READMEs and LICENSE;
source, tests, plugins, development docs and local device data are excluded.
