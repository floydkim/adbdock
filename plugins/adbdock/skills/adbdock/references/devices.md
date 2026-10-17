# Device commands

```sh
adbdock devices --json
adbdock alias <serial> <alias>
adbdock adb --device <alias-or-serial> --json -- shell getprop ro.product.model
adbdock adb --device <a> --device <b> --json -- shell <command>
adbdock adb --device <a> --timeout 120000 --json -- install -r <apk>
```

- Metro configuration is unnecessary for ADB commands. Use `--all` only when every online device is intended.
- A phone's verified USB/Wi-Fi transports share one identity; aliases prefer USB. An exact live serial selects a transport.
- Interactive/streaming commands are unsupported. Pull/bugreport require one device. Partial failures appear in JSON errors; failed mutations are not automatically retried.
- For authorized parallel device work, coordinate each task's device identity, device port and host Metro port before writing. adbdock does not reserve devices or ports. One foreground UI per device means UI checks on a shared device need sequencing.
- Separate worktrees do not isolate physical devices or reverse rules. A dedicated `ADBDOCK_HOME` separates saved config/watcher only; use it consistently for every related command and still allocate distinct physical ports.
