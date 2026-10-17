# Saved command aliases

Inspect `adbdock adb-alias list --json` before running saved scripts: presets can be edited/deleted.

```sh
adbdock @menu -d <a> --json
adbdock @reverse -d <a> -d <b> --json
adbdock @screenshot -d <a> -d <b> --json
adbdock adb-alias add model 'adb shell getprop ro.product.model' --json
adbdock @model -d <a> --json
```

- Scripts run on the Mac in `/bin/sh` once per device; plain `adb` calls target that device. Use trusted scripts and preserve existing names; overwrite needs confirmation or explicit `--force`. Edit/remove via `adb-alias edit/remove <name>`.
- The supplied `menu` preset sends keyevent 82 (the React Native developer menu).
- Reverse without arguments uses each device's saved Metro mappings, or 8081→8081. `-- <host-port> [device-port]` overrides for this run only; saved mappings stay unchanged and watchers preserve conflicting rules.
- Screenshot writes a unique PNG per device in the current directory and prints its path; on multiple displays it chooses the first discovered display. Set a suitable working directory before running it.
- Put adbdock options such as `--json` before `--`; values after it are literal command arguments. Arguments after `--` become `$1`, `$2`, etc. Register with single quotes. For custom file paths, quote `$ADBDOCK_DEVICE-$ADBDOCK_RUN_ID` (safe alias/serial + unique timestamp/UUID); `$ADBDOCK_MODEL` is filename-safe, `$ADBDOCK_SERIAL` is raw.
- Default timeout is 10 seconds (`--timeout` overrides). Ctrl+C stops owned command groups; failures are not retried. Watchers never execute these scripts.
