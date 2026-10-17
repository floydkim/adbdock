# Test automation implementation plan

**Goal:** Repeat the existing CLI/device checks without retaining this chat's paths or device serials, and give an LLM reproducible RN/manual scenarios.

**Design:** Keep the existing isolated fake-ADB CLI suite as the fast regression layer. Add one opt-in Node script that exercises explicitly selected real devices using isolated adbdock configuration, unused temporary reverse ports and local HTTP probe servers. A real HTTP request initiated on Android must reach the expected server; host `/status` alone is insufficient. RN rendering/Fast Refresh and human actions remain a separate runbook. No production API changes, test framework or runtime dependency.

**Scope:** Persistent aliases, commands to selected devices before Metro configuration, shared/separate host ports, watcher restoration, server stop/restart, external reverse conflict preservation, cleanup and a JSON report. Do not disconnect physical devices, sleep the Mac, install apps or touch existing Metro ports. Optional manual recovery cases are documented, including explicit Reload after transport loss.

## Steps

1. Write runner boundary tests against the existing fake ADB subprocess fixture: success, required targets, failure cleanup and interrupted-run cleanup. Extend only the fixture to emulate device HTTP probes against the real local test servers.
2. Observe failure before introducing `scripts/test-devices.mjs`.
3. Implement the smallest sequential runner, bounded subprocesses/polling, own config/watcher/port cleanup in finally, and JSON evidence. Preserve diagnostics when cleanup fails. Add npm scripts for `check` and opt-in `test:devices`.
4. Run the runner tests, full checks, then opt-in smoke against available emulator and Galaxy. Confirm existing 8081 mappings/watcher remain intact.
5. Write `docs/testing.md` for humans/LLMs: prerequisites, exact commands, observable pass/fail criteria, RN A/B source and counter checks, human USB/sleep steps, evidence and cleanup. Keep previous validation history separate.
6. Review the diff, propose a meaningful commit message, and commit only after user approval.

Mac sleep is deferred; long-running stability will be assessed during real work. Real IP change is optional because current discovery already resolves current addresses.
