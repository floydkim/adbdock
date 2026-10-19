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
- To use the reverse tunnel, the app must use `localhost:<device-port>`; the default device port is 8081 and can be changed with `--device-port`. The CLI does not change app settings or start Metro. Direct connections to the Mac's LAN IP or emulator `10.0.2.2` bypass reverse and are outside tunnel repair.
- A healthy reverse rule does not prove the app uses it. Bind with `--app <package>` so `status` reports `metro[].app.route`: `tunnel` uses this mapping, `other_port` and `direct` (for example an emulator's default `10.0.2.2`) bypass it, `unknown` means a non-debuggable or missing app. Fix the app's server address rather than the tunnel when the route is not `tunnel`.
- A different external rule causes a conflict; use `--replace` only for an intended takeover. An already matching external rule is reused without claiming ownership, so unbind preserves it. `status` shows a conflicting rule's destination as `current`; other tools such as `react-native run-android` can reset `tcp:8081` to `tcp:8081`.
- One watcher runs per config home; reuse an existing one. It repairs saved tunnels and reconnects remembered wireless services. Initial pairing is separate.
- ADB/reverse recovery can leave RN HMR disconnected. Do not silently Reload: it resets state. For a Fast Refresh check, change a revision label and verify the new label with the previous counter value; an explicit Reload is a separate recovery step.
