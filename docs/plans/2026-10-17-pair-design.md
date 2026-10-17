# Wireless pairing

Approved scope: Android 11+ pairing-code flow, discovery/selection or explicit
IPv4 pairing endpoint, followed by verified connection and optional alias.
Metro configuration and QR pairing remain separate.

`adbdock pair [ip:pairing-port] [--alias name] [--connect ip:connection-port]`
prompts in a terminal. `pair --list --json` lists pairing services without
mutating state. Noninteractive callers specify a pairing endpoint and
`--code-stdin`, passing one six-digit code line. Codes are sent to adb stdin,
never command arguments, results, config or logs. Interactive code input is hidden.

Reuse ADB mDNS parsing for both TLS service types. After pairing, use the returned
ADB GUID to find the connected transport or matching connect service. Never use
a pairing port as a connection port or select an unrelated live/USB device.
Explicit --connect bypasses missing discovery but still verifies the paired GUID.
Persist under the existing config lock only after a verified live hardware
identity; no user input or pairing waits under that lock. Recheck alias conflicts
when saving. Partial success reports paired=true and connected=false rather than
pretending pairing was rolled back. Pair failure messages omit raw adb output.

Tests exercise discovery, stdin secrecy, different ports, existing USB transports,
wrong-code errors, unrelated/ambiguous services, missing connection, aliases,
input cancellation and package inclusion. Real pairing needs a phone pairing
screen/code; never remove existing trust to manufacture a first-pair test.
