# adbdock

A multi-device ADB CLI with optional Metro connection recovery.

Work in progress. Requires macOS, Node.js 22+, and `adb` on PATH.

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
