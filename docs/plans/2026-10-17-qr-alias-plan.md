# QR pairing and interactive alias

Approved scope: `pair --qr [--alias name]` renders a temporary Android ADB Wi-Fi
QR, waits for only that scan's pairing service, and reuses verified connection
and registration. `alias` lists current devices with model/state/connection/alias,
asks for a device and new alias; `alias <device>` asks for the name only. Existing
explicit commands/JSON remain available. No menu library or QR image files.

Use qrcode-terminal for encoding; Node crypto creates per-run service/password.
QR goes to stderr, final structured result to stdout. `--timeout` bounds waiting
(default 60 seconds); SIGINT/SIGTERM cancel discovery and restore handlers. Resolve
only the generated studio service, including macOS Bonjour fallback, never another
phone's open pairing screen. Pairing password goes to adb stdin. Extract existing
readLine into a shared prompt module and keep post-pair verification unchanged.

Alias prompts occur outside the config lock. Reacquire current config/live devices
before saving; preserve alias conflict checks and existing mappings. Noninteractive
missing arguments fail instead of guessing. Show saved offline identities as well
so users can rename remembered phones without connecting them.

Steps: write CLI/PTY tests and fixture QR-scan simulation first; verify failures.
Implement shared prompts/alias path, then QR scan/discovery with existing post-pair
flow. Verify wrong-service exclusion, timeout, cancellation, fresh secrets and code
secrecy. Run full checks/package install, review, then real phone QR scan when the
user is ready. Update both READMEs and short agent references; do not commit README
or any other files without requested commit-message approval.
