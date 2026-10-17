# Saved ADB command aliases

Approved interface: adb-alias add/list/edit/remove; bare adb-alias opens a small
interactive editor. @name executes for explicit -d/--device or --all targets.
Add -d to ordinary adb too. Registration stores a host POSIX shell script;
its adb function pins every invocation to the chosen serial and accepts only
finite device commands, plus exec-out for binary file redirection. Host shell
operators and tools (open, redirects) operate on the Mac once per selected device.

Defaults: shake (keyevent 82), reverse (saved mappings or 8081:8081; explicit host $1/device $2 override),
screencap (unique PNG and printed path). Environment: ADBDOCK_DEVICE/MODEL are
filename-safe; ADBDOCK_SERIAL is raw target; ADBDOCK_RUN_ID is timestamp+UUID per
device. Script parameters after -- become $1 etc. Registration uses single quotes.

Config gains optional commandAliases map. Missing map supplies defaults; the first
mutation copies the full map, so deleting a default stays deleted, including an
empty map. Existing configs remain valid. Overwrite shows old/new with yes/no;
noninteractive overwrite needs --force. Lock only during saving, checking for
concurrent command changes after prompts. Editor selections also protect against
concurrent deletion/replacement. No watcher re-executes saved commands.

Run with bounded concurrency and per-device JSON/output/exit status. Use a separate
shell process group per device, fixed quoted adb wrapper, and stdin disabled.
Timeout/Ctrl+C kills owned process groups, including descendants; never retry a
mutation. Binary screenshots go straight from adb to the redirected file, avoiding
UTF-8 capture. Without reverse arguments use each selected device's saved mappings (fallback 8081:8081); explicit $1 host/$2 device arguments override only for this run. Do not alter saved Metro settings for a manual reverse.

Steps: add failing CLI/PTY tests and binary fixture; implement persistence/CRUD,
execution and flags; test wrong targets, quoting, secret-free argv variables,
unique files, collisions, deletion persistence, concurrent overwrite, failures,
timeouts and cancellation. Run full checks/package install. Verify real screenshot
on requested devices; avoid toggling dev menus or overwriting Metro ports just
for a test. Update compact help, both READMEs and an on-demand agent reference.
Commit only after message approval; README remains uncommitted.
