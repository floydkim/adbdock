import { CliError } from './output.js';

const overview = `adbdock — Manage Android devices and Metro connections

Commands:
  adbdock devices
    List devices and their connection states.

  adbdock alias
    Choose a device and set or change its alias.

  adbdock pair
    Pair a phone for wireless debugging, using a QR or code.

  adbdock adb
    Run an ADB command on selected devices.

  adbdock adb-alias
    Save and manage commands to reuse across devices.

  adbdock @name
    Run a saved command on selected devices.

  adbdock metro
    Configure and repair device-to-Metro connections.

  adbdock watch
    Start, inspect or stop the connection watcher.

  adbdock status
    Check devices, Metro connections and watcher status.

Examples:
  adbdock devices
  adbdock alias
  adbdock pair --qr
  adbdock watch start --background

Options:
  -v, --version
    Show the installed CLI version.

For options and more examples:
  adbdock pair --help
  adbdock metro --help
`;

const details: Record<string, string> = {
  devices: `adbdock devices — List ADB devices and connection states

Usage:
  adbdock devices [--json]

Shows aliases, models, connections, states and ADB serials.
A phone connected by USB and Wi-Fi is grouped as one device.
Metro configuration is not required.

Examples:
  adbdock devices
  adbdock devices --json
`,
  alias: `adbdock alias — Give a device a memorable name

Usage:
  adbdock alias
  adbdock alias <device>
  adbdock alias <device> <name>

Without arguments, choose a device from the list and enter a name.
With only a device, enter its new name. Enter keeps an existing name.
Remembered offline devices can be renamed too.
Scripts and agents must supply both device and name.
Names start with a letter; use letters, numbers, _ or - (up to 64).

Examples:
  adbdock alias
  adbdock alias phone
  adbdock alias emulator-5554 emulator
`,
  pair: `adbdock pair — Set up Android wireless debugging

Usage:
  adbdock pair [--alias <name>]
  adbdock pair <ip:pairing-port> [--alias <name>]
  adbdock pair --qr [--alias <name>]
  adbdock pair --list [--json]
  adbdock pair <ip:pairing-port> --code-stdin [--json]

Use Android 11+ and the same Wi-Fi network as your Mac.
Open Wireless debugging on the phone, then its QR scanner or code screen.
After pairing, adbdock verifies the wireless connection and saves the device.
It does not start a watcher or configure Metro.

Options:
  --qr
    Display a QR to scan instead of entering a pairing code.
  --alias <name>
    Save an alias after verifying the connection.
  --connect <ip:connection-port>
    Use the connection address from the main Wireless debugging screen.
    This port differs from the pairing-screen port.
  --list
    List discovered code-pairing targets without pairing.
  --code-stdin
    Read one six-digit code line from stdin; requires a pairing address.
    There is no code argument. Interactive code input is hidden.
  --timeout <milliseconds>
    QR scan wait: 60000 by default; range 1..300000. QR mode only.

Examples:
  adbdock pair --qr --alias phone
  adbdock pair --alias phone
  adbdock pair 192.168.0.7:37000 --connect 192.168.0.7:45000
  adbdock pair --list --json

Pairing may succeed even if connection or alias registration fails.
Check paired, connected and errors in JSON before retrying.
`,
  adb: `adbdock adb — Run a command on selected Android devices

Usage:
  adbdock adb [-d <device>] -- <adb command>
  adbdock adb --all -- <adb command>

A device can be an alias, live ADB serial or device ID.
With one online device, target options can be omitted. Multiple devices need --device or --all.
Verified USB/Wi-Fi transports of the same phone count as one device.
Only finite device commands are supported, such as shell, install or push.
Interactive shells, streams and host commands are unsupported.
Pull and bugreport require a single device.

Options:
  -d, --device <device>
    Select one device. Repeat this option to select several.
  --all
    Select every online device, including devices without saved aliases.
    Cannot be combined with --device.
  --timeout <milliseconds>
    Per-device command limit: 10000 by default; range 1..3600000.
  --
    End adbdock options. Everything after this goes to ADB unchanged.

Examples:
  adbdock adb -- shell getprop ro.product.model
  adbdock adb --device phone -- shell getprop ro.product.model
  adbdock adb --device phone --device emulator -- shell getprop ro.build.version.release
  adbdock adb --device phone --timeout 120000 -- install -r app.apk
`,
  'adb-alias': `adbdock adb-alias — Manage saved device commands

Commands:
  adbdock adb-alias add
    Save a host shell script containing device commands.
  adbdock adb-alias list
    Show names and commands without changing them.
  adbdock adb-alias edit
    Edit one command interactively.
  adbdock adb-alias remove
    Delete one command, including a built-in preset.

Without a subcommand, choose an alias to edit/delete in a terminal.
Scripts and --json get a read-only list instead.
Built-ins: menu, reverse and screenshot. Deleted presets stay deleted.
The table shows shortened previews. Select an entry to read its full script.

Examples:
  adbdock adb-alias
  adbdock adb-alias list --json
  adbdock adb-alias add model 'adb shell getprop ro.product.model'
  adbdock @model -d phone

Run adbdock adb-alias add --help for scripts and overwrite rules.
`,
  'adb-alias add': `adbdock adb-alias add — Save a reusable shell command

Usage:
  adbdock adb-alias add <name> <command> [--force]

Use single quotes around the command so variables expand when it runs.
Each plain adb call is pinned to the selected device. Do not supply adb -s.
Redirects, pipelines and tools such as open run on the Mac once per device.
The shell is /bin/sh; aliases are trusted scripts, not a sandbox.

Options:
  --force
    Replace an existing alias without prompting. Required in scripts.
    Otherwise, show old/new commands and ask before overwriting.

Variables available at execution:
  $ADBDOCK_DEVICE   Filename-safe device alias or serial.
  $ADBDOCK_MODEL    Filename-safe model name.
  $ADBDOCK_RUN_ID   Unique timestamp/UUID per device execution.
  $ADBDOCK_REVERSE_PORTS  Saved device:host port pairs, or 8081:8081.
  $ADBDOCK_SERIAL   Original ADB target serial.
  $1, $2           Arguments supplied after -- when running an alias.

Examples:
  adbdock adb-alias add menu 'adb shell input keyevent 82'
  adbdock adb-alias add files 'adb shell ls "$1"'
  adbdock @files -d phone -- /sdcard
`,
  'adb-alias list': `adbdock adb-alias list — Show saved commands

Usage:
  adbdock adb-alias list [--json]

Plain output fits command previews to the terminal width. --json keeps full scripts.

Examples:
  adbdock adb-alias list
  adbdock adb-alias list --json

Run adbdock adb-alias without a subcommand to select, edit or delete.
`,
  'adb-alias edit': `adbdock adb-alias edit — Edit one saved command

Usage:
  adbdock adb-alias edit <name>

Requires a terminal. Shows the current script; Enter keeps it unchanged.
Confirm before saving a replacement. For automation use add --force.

Examples:
  adbdock adb-alias edit screenshot
  adbdock adb-alias add menu 'adb shell input keyevent 82' --force
`,
  'adb-alias remove': `adbdock adb-alias remove — Delete one saved command

Usage:
  adbdock adb-alias remove <name>

Built-in presets can be removed too and will not reappear automatically.

Examples:
  adbdock adb-alias remove screenshot
  adbdock adb-alias list
`,
  '@command': `adbdock @<name> — Run a saved command for selected devices

Usage:
  adbdock @<name> [-d <device> ...] [-- <arguments>]
  adbdock @<name> --all [-- <arguments>]

Options:
  -d, --device <device>
    Device alias, serial or ID. Repeat for several devices.
  --all
    Select every online device. Cannot be combined with --device.
  --timeout <milliseconds>
    Per-device limit: 10000 by default; range 1..3600000.
  --
    Pass remaining arguments to the script as $1, $2 and so on.

With one online device, target options can be omitted. Multiple devices need --device or --all.
Verified USB/Wi-Fi transports of the same phone count as one device.

Defaults:
  menu
    Send keyevent 82 to open the RN developer menu.
  reverse
    Without arguments, apply each device's saved Metro mappings, or 8081 to 8081.
    With arguments, $1 is host port; $2 is device port (default 8081).
    Manual reverse does not update saved Metro mappings.
  screenshot
    Save a PNG in this directory using device name and a unique run ID.

Commands run up to four devices at a time; failures are reported per device.
Timeout or Ctrl+C terminates owned shell/child jobs. Mutations are not retried.
Use unique file paths in custom scripts; timestamps alone may collide.

Examples:
  adbdock @menu
  adbdock @menu -d phone -d emulator
  adbdock @reverse -d phone -- 8082
  adbdock @screenshot --all
`,
  metro: `adbdock metro — Configure device-to-Metro connections

Commands:
  adbdock metro bind
    Save a device's port mapping and apply its reverse tunnel.

  adbdock metro unbind
    Remove a saved mapping and its unchanged, adbdock-owned tunnel.

  adbdock metro repair
    Retry saved mappings once.

Start Metro separately. Use watch for ongoing automatic recovery.
Devices can share one Metro or connect to different host ports.

Examples:
  adbdock metro bind phone --port 8082
  adbdock metro bind emulator --port 8081
  adbdock metro repair --all

For options and more examples:
  adbdock metro bind --help
  adbdock metro unbind --help
  adbdock metro repair --help
`,
  'metro bind': `adbdock metro bind — Save and apply a Metro mapping

Usage:
  adbdock metro bind <device> --port <port> [--device-port <port>] [--app <package>]

The device may be an alias, ADB serial or ID.
Remembered offline devices keep the mapping for later repair.
The Android app must use localhost and the device-side port.

Options:
  --port <port>
    Required: the port where Metro is listening on your Mac.
  --device-port <port>
    Port used inside Android; default 8081.
  --app <package>
    Debuggable app to inspect in adbdock status. Saved addresses or
    defaults provide an estimate; the running app route stays unknown.
    adbdock never changes the app settings.
  --replace
    Explicitly replace an external reverse rule on this device port.
    Otherwise, conflicting rules are preserved and reported.

Examples:
  adbdock metro bind phone --port 8082
  adbdock metro bind phone --port 8082 --device-port 18081
  adbdock metro bind emulator --port 8082 --app com.example.app
`,
  'metro unbind': `adbdock metro unbind — Remove a saved Metro mapping

Usage:
  adbdock metro unbind <device> [--device-port <port>]

Removes the saved mapping. Only an unchanged, adbdock-owned tunnel is removed.
Externally modified rules are preserved.

Options:
  --device-port <port>
    Choose a mapping when the device has more than one.

Examples:
  adbdock metro unbind phone
  adbdock metro unbind phone --device-port 18081
`,
  'metro repair': `adbdock metro repair — Retry saved Metro mappings once

Usage:
  adbdock metro repair --device <device>
  adbdock metro repair --all

Options:
  --device <device>
    Repair mappings for one device.
  --all
    Repair all saved mappings. Choose either --device or --all.

Examples:
  adbdock metro repair --device phone
  adbdock metro repair --all

For continuous recovery, run adbdock watch start --background.
`,
  watch: `adbdock watch — Start and manage connection recovery

Commands:
  adbdock watch start
    Reconnect remembered phones and restore saved Metro tunnels.

  adbdock watch stop
    Stop watching; keep saved settings and current tunnels.

  adbdock watch status
    Show only this configuration's watcher state.

Running adbdock watch without a subcommand starts it in this terminal.
Ctrl+C stops a foreground watcher. Start with --background to close the terminal.
Use adbdock status for device and Metro health as well as watcher state.

Examples:
  adbdock watch start --background
  adbdock watch status
  adbdock watch stop
  adbdock watch

Run adbdock watch start --help for startup options.
`,
  'watch status': `adbdock watch status — Inspect this configuration's watcher

Usage:
  adbdock watch status [--json]

Shows whether the watcher is running, including its PID.
This command does not query ADB, start a watcher or check Metro connections.
Use adbdock status for the full device and Metro report.

Examples:
  adbdock watch status
  adbdock watch status --json
`,
  'watch start': `adbdock watch start — Keep saved connections working

Usage:
  adbdock watch start [--background] [--interval <milliseconds>]

Reconnects remembered wireless devices and restores saved Metro tunnels.
It also reconnects remembered phones without Metro mappings.
One watcher runs per configuration directory.

Options:
  --background
    Run independently; closing this terminal will not stop the watcher.
    Without this option, watch runs here until Ctrl+C.
  --interval <milliseconds>
    Check interval: 2000 by default; range 100..60000.
    Failed operations back off up to 30 seconds.

Examples:
  adbdock watch start --background
  adbdock watch

Use adbdock watch status to inspect the watcher and watch stop to stop it.
Rebooting the Mac requires starting the watcher again.
`,
  'watch stop': `adbdock watch stop — Stop this configuration's watcher

Usage:
  adbdock watch stop

Saved aliases, Metro mappings and existing reverse tunnels remain intact.
Only ongoing monitoring and automatic recovery stop.

Examples:
  adbdock watch stop
  adbdock status
`,
  status: `adbdock status — Check connections and the watcher

Usage:
  adbdock status [--json]

Reports device availability, reverse rules, host Metro and watcher state.
A conflicting reverse rule shows its current destination.
Mappings saved with --app include an address estimate from saved settings
or defaults. app.route stays unknown: runtime overrides cannot be read.
app.estimate.route describes the candidate: tunnel, other_port or direct.
Verify app rendering and Fast Refresh separately.

Examples:
  adbdock status
  adbdock status --json
`,
};

export function helpFor(args: string[]): string | undefined {
  const requested = !args.length || args.includes('--help') || args.includes('-h')
    || (args.length === 1 && args[0] === 'metro');
  if (!requested) return;
  const command = args[0]?.startsWith('-') ? '' : args[0] ?? '';
  if (!command) return overview;
  const topic = (command === 'metro' || command === 'watch' || command === 'adb-alias') && args[1] && !args[1].startsWith('-') ? `${command} ${args[1]}` : command;
  const text = details[command.startsWith('@') ? '@command' : topic];
  if (typeof text !== 'string') throw new CliError('INVALID_ARGUMENT', `No help for '${topic}'. Run adbdock --help.`, 2);
  return `${text}
Common options:
  --json
    Return structured JSON on stdout.
  -h, --help
    Show help without changing devices or configuration.

Notation:
  <value> is a required value to replace, such as phone or 8081.
  [part] is optional. Do not type the brackets themselves.
`;
}
