# Diagnose and clean up

```sh
adbdock status --json
adbdock devices --json
adbdock metro repair --device <target> --json
```

Read JSON errors and the relevant config home's `watch.log`; default home is
`~/Library/Application Support/adbdock`. Distinguish device availability, reverse
state, host Metro status and actual app behavior (`app: unknown` is not UI evidence).

- `WIRELESS_NOT_DISCOVERED`: check wireless debugging, pairing and discovery. macOS Bonjour supplements missing ADB discovery for saved service names. Repeating a stale saved IP or killing the global ADB server is not the recovery plan.
- `WIRELESS_AMBIGUOUS` / `REVERSE_CONFLICT`: inspect ownership and current endpoints; do not overwrite to make the error disappear.
- `WATCH_RUNNING`: reuse the existing watcher. `stop` affects every mapping in that config home, so stop only a watcher owned by this task or explicitly authorized to stop.
- A timeout may leave an operation applied. Inspect current state before retrying a mutation. Preserve the first failure and logs.

Unbind only this task's mappings with `adbdock metro unbind <target> --device-port <port>`.
Stop a task-owned watcher before removing its config. Preserve externally changed rules.
USB unplug, wireless-debugging toggles and Mac sleep need human coordination; do not
interrupt the only available device connection just to test recovery.
