# Device commands

```sh
adbdock devices --json
adbdock alias <serial> <alias>
adbdock pair --list --json
adbdock pair <ip:pairing-port> --alias <alias> --code-stdin --json
adbdock adb --device <alias-or-serial> --json -- shell getprop ro.product.model
adbdock adb --device <a> --device <b> --json -- shell <command>
adbdock adb --device <a> --timeout 120000 --json -- install -r <apk>
```

- Metro configuration is unnecessary for ADB commands. Use `--all` only when every online device is intended.
- A phone's verified USB/Wi-Fi transports share one identity; aliases prefer USB. An exact live serial selects a transport.
- Interactive/streaming commands are unsupported. Pull/bugreport require one device. Partial failures appear in JSON errors; failed mutations are not automatically retried.
- For authorized parallel device work, coordinate each task's device identity, device port and host Metro port before writing. adbdock does not reserve devices or ports. One foreground UI per device means UI checks on a shared device need sequencing.
- Separate worktrees do not isolate physical devices or reverse rules. A dedicated `ADBDOCK_HOME` separates saved config/watcher only; use it consistently for every related command and still allocate distinct physical ports.

- Wireless pairing requires the human to open the phone's pairing-code screen and provide its code. Send one six-digit line on stdin; never put it in arguments/files/logs. Pairing and connection ports differ (`--connect` overrides the latter). Check `paired`, `connected` and errors independently; a registration error does not undo trust. Pair does not start a watcher or configure Metro.

- Human terminal flows: `adbdock alias` selects/renames a device; `adbdock pair --qr --alias <name>` displays a QR for the phone's wireless-debugging scanner (60-second wait, Ctrl+C cancels). Coordinate scanning with the user. Agents should use explicit alias arguments; QR is on stderr and final JSON on stdout.

## Saved command aliases

Inspect `adbdock adb-alias list --json` before running saved scripts: presets can be edited/deleted.

```sh
adbdock @reverse -d <a> -d <b> --json
adbdock @screencap -d <a> -d <b> --json
adbdock adb-alias add model 'adb shell getprop ro.product.model' --json
adbdock @model -d <a> --json
```

- Scripts run on the Mac in `/bin/sh` once per device; plain `adb` calls target that device. Use trusted scripts and preserve existing names; overwrite needs confirmation or explicit `--force`. Edit/remove via `adb-alias edit/remove <name>`.
- Reverse without arguments uses each device's saved Metro mappings, or 8081→8081. `-- <host-port> [device-port]` overrides for this run only; saved mappings stay unchanged and watchers preserve conflicting rules.
- Screenshot writes a unique PNG per device in the current directory and prints its path; on multiple displays it chooses the first discovered display. Set a suitable working directory before running it.
- Arguments after `--` become `$1`, `$2`, etc. Register with single quotes. For custom file paths, quote `$ADBDOCK_DEVICE-$ADBDOCK_RUN_ID` (safe alias/serial + unique timestamp/UUID); `$ADBDOCK_MODEL` is filename-safe, `$ADBDOCK_SERIAL` is raw.
- Default timeout is 10 seconds (`--timeout` overrides). Ctrl+C stops owned command groups; failures are not retried. Watchers never execute these scripts.
