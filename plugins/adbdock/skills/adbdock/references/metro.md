# Optional Metro mappings

```sh
adbdock metro bind <a> --port <host-port> --device-port <device-port>
adbdock metro bind <b> --port <other-host-port> --device-port <device-port>
adbdock metro repair --device <a> --json
adbdock status --json
adbdock watch start --background --json
adbdock watch status --json
```

- Inspect existing mappings first. For a shared Metro use the same host port; for separate projects use different host ports. Different devices may use the same device port; concurrent tasks on one device must not reuse it.
- The app must use `localhost:<device-port>`; the default device port is 8081. The CLI does not change app settings or start Metro. Emulator `10.0.2.2` bypasses reverse.
- Existing external rules cause a conflict. Use `--replace` only when taking over that rule is intended and authorized.
- One watcher runs per config home; reuse an existing one. It repairs saved tunnels and reconnects remembered wireless services. Initial pairing is separate.
- ADB/reverse recovery can leave RN HMR disconnected. Do not silently Reload: it resets state. For a Fast Refresh check, change a revision label and verify the new label with the previous counter value; an explicit Reload is a separate recovery step.
