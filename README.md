# adbdock

**English** | [한국어](README.ko.md)

Connect multiple Android devices at once and manage them from one CLI. Give
devices aliases to run ADB commands easily. For React Native development, save
each device's Metro connection settings and automatically restore connections
when they drop.

## Why adbdock?

Working with USB phones, wireless devices and emulators means looking up serials,
repeating `adb -s` commands and restoring `adb reverse` after disconnections.
With several projects, you also need to remember which Metro belongs to each device.

adbdock remembers those choices:

- **Name your devices.** Use `phone` instead of an ADB serial. When the same phone
  is connected over USB and Wi-Fi, adbdock groups the connections and prefers USB.
- **Run commands across devices.** Target one device, several devices or all online
  devices. Save ADB commands as reusable shortcuts.
- **Keep Metro connected.** Share one Metro or use a different port for each device.
  Run a watcher to automatically restore dropped connections.
- **Use it with coding agents.** JSON output and optional Claude Code/Codex skills
  help agents work with explicit device targets.

Metro is optional. You can use adbdock just for device aliases and ADB commands.

## Install

Requires **macOS**, **Node.js 22+** and Android SDK Platform-Tools (`adb` on PATH).

```sh
npm i -g adbdock
adbdock --help
```

Or try it without a global installation:

```sh
npx adbdock@latest --help
```

To update a global installation to the latest version:

```sh
npm i -g adbdock@latest
```

## Quick start

Connect a USB device with USB debugging authorized, start an emulator, or
[set up wireless debugging](#wireless-pairing).

**1. List your devices and give them names.**

```sh
adbdock devices  # List connected devices
adbdock alias    # View and edit device aliases
```

`alias` lets you select a device and enter a name. Repeat it to name another device.
The examples below assume you have named two devices `phone` and `emulator`.
Aliases are saved in the configuration file. Remembered devices can be renamed
even while offline.

**2. Run an ADB command.**

```sh
adbdock adb -d phone -- shell getprop ro.product.model
```

Everything after `--` is passed to ADB. Repeat `-d` to select multiple devices,
or use `--all` for every online device:

```sh
# Run on phone and emulator
adbdock adb -d phone -d emulator -- shell getprop ro.product.model
# Run on every online device
adbdock adb --all -- install -r ./app.apk
```

When only one device is online, you can omit the target:

```sh
adbdock adb -- shell getprop ro.product.model
```

**3. Try the built-in shortcuts.**

```sh
adbdock @menu -d phone
adbdock @screenshot -d phone -d emulator
```

`@menu` opens the React Native developer menu. `@screenshot` saves a separate PNG
for each device in your current directory and prints its path.

You can also add or edit command shortcuts.

## React Native: Metro and automatic recovery

Start each project's Metro server yourself. The example below assumes the app's
development server address is `localhost:8081`. If it uses another address, change
the app settings to use adbdock's tunnel. Use `--device-port` to change the device-side port.

adbdock does not change app settings. ADB reverse forwards the app's requests to
the device's own `localhost:8081` through to the specified Metro port on your Mac.

Connect each device to a different Metro port and start a watcher to keep the
connections working:

```sh
adbdock metro bind phone --port 8082
adbdock metro bind emulator --port 8081
adbdock watch start --background
```

| Device alias | Address used by the Android app | Metro port on your Mac |
|---|---|---|
| phone | `localhost:8081` | `8082` |
| emulator | `localhost:8081` | `8081` |

`--port` is the **Mac's Metro port**. To share one Metro, bind both devices to the
same port. Mappings are saved, but automatic recovery requires the watcher.
The background watcher keeps running after you close the terminal.

Inspect or stop it with:

```sh
adbdock watch status
adbdock watch stop
```

Stopping the watcher leaves saved mappings and current tunnels intact.
**Tunnel recovery does not guarantee Fast Refresh recovery:** after a disconnection,
the app may still need a Reload.

## Wireless pairing

On Android 11+, connect your phone and Mac to the same Wi-Fi network, then run:

```sh
adbdock pair --qr --alias phone
```

On the phone, open **Developer options → Wireless debugging → Pair device with
QR code** and scan the terminal QR. adbdock connects the phone and saves its alias.

Prefer a code? Open **Pair device with pairing code**, run
`adbdock pair --alias phone` and enter the displayed six-digit code.

Pairing does not start the watcher. To reconnect remembered wireless devices
automatically, run `adbdock watch start --background`. This also works without Metro.
Wireless debugging must remain enabled and the device must be discoverable.

## More commands

| Command | Purpose |
|---|---|
| `adbdock alias` | Select a device and set or change its name |
| `adbdock @reverse -d phone` | Apply saved Metro mappings, or 8081 → 8081 if none exist |
| `adbdock adb-alias` | Save, edit or remove reusable ADB commands |
| `adbdock status` | Check devices, Metro connections and the watcher |
| `adbdock metro unbind phone` | Remove the default Metro mapping for the device aliased `phone` |

Use `adbdock --help` for the overview and command-specific help for options and examples:

```sh
adbdock adb --help
adbdock metro bind --help
adbdock adb-alias --help
```

Non-interactive commands such as `shell`, `install` and `push` are supported.
Interactive shells and streaming commands are unsupported. The default
command timeout is 10 seconds. Use `--timeout 120000` before `--` for longer operations.

For custom command variables, pairing troubleshooting, recovery behavior and
configuration, see the [usage guide](https://github.com/floydkim/adbdock/blob/main/docs/usage.md).

## Claude Code and Codex

You can install a skill plugin for your coding agent. Install the CLI and plugin
in either order. When the agent uses the skill, it will provide the installation
command if the CLI is not installed.

**Claude Code**

```sh
claude plugin marketplace add floydkim/adbdock
claude plugin install adbdock@adbdock
```

**Codex CLI**

```sh
codex plugin marketplace add floydkim/adbdock
codex plugin add adbdock@adbdock
```

## Development

See the [development guide](https://github.com/floydkim/adbdock/blob/main/docs/usage.md#development)
and [testing procedures](https://github.com/floydkim/adbdock/blob/main/docs/testing.md).

## License

[MIT](LICENSE)
