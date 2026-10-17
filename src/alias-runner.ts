import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mapLimit } from './adb.js';
import { deviceCommands } from './commands.js';
import type { Binding } from './store.js';
import type { Device } from './devices.js';
import { result } from './output.js';

const wrapper = `adb() {
  case "$1" in
    ${[...deviceCommands, 'exec-out'].join('|')}) ;;
    *) printf '%s\\n' 'Use a finite device command; adb target flags and host commands are unsupported.' >&2; return 2 ;;
  esac
  if [ "$1" = shell ] || [ "$1" = exec-out ]; then
    case "\${2-}" in ''|-*) printf '%s\\n' 'Supply a noninteractive device command.' >&2; return 2 ;; esac
  fi
  command "$ADBDOCK_ADB_BIN" -s "$ADBDOCK_SERIAL" "$@"
}
`;

export async function runAliasCommands(name: string, command: string, selected: Device[], args: string[], timeout: number, bindings: Binding[]) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+$/, '_') || 'device';
  try {
    const data = await mapLimit(selected, async device => {
      const ports = bindings.filter(b => b.deviceId === device.id).map(b => `${b.devicePort}:${b.metroPort}`).join(' ') || '8081:8081';
      const runId = `${Date.now()}-${randomUUID()}`;
      const identity = { deviceId: device.id, alias: device.alias, transportSerial: device.serial, runId };
      if (controller.signal.aborted) return { ...identity, stdout: '', stderr: 'Cancelled before execution.', exitCode: null, timedOut: false, cancelled: true };
      const output = { ...identity, stdout: '', stderr: '', exitCode: null as number | null, timedOut: false, cancelled: false };
      return new Promise<typeof output>(resolve => {
        let bytes = 0;
        let limited = false;
        const child = spawn('/bin/sh', ['-c', `${wrapper}\n${command}`, name, ...args], {
          detached: true, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ADBDOCK_ADB_BIN: process.env.ADBDOCK_ADB ?? 'adb', ADBDOCK_SERIAL: device.serial,
            ADBDOCK_DEVICE: safeName(device.alias ?? device.serial), ADBDOCK_MODEL: safeName(device.model), ADBDOCK_RUN_ID: runId, ADBDOCK_REVERSE_PORTS: ports },
        });
        const kill = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The process group already exited. */ } } };
        controller.signal.addEventListener('abort', kill, { once: true });
        const timer = setTimeout(() => { output.timedOut = true; kill(); }, timeout);
        for (const stream of ['stdout', 'stderr'] as const) {
          child[stream]!.setEncoding('utf8').on('data', (chunk: string) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > 4 * 1024 * 1024) { limited = true; kill(); }
            else output[stream] += chunk;
          });
        }
        child.once('error', error => { output.stderr ||= error.message; });
        child.once('close', code => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', kill);
          kill();
          if (limited) output.stderr = 'Command output exceeded 4 MiB.';
          output.exitCode = output.timedOut || limited || controller.signal.aborted ? null : code;
          output.cancelled = controller.signal.aborted;
          resolve(output);
        });
      });
    });
    const errors = data.filter(d => d.exitCode !== 0).map(d => ({ deviceId: d.deviceId, retryable: false,
      code: d.cancelled ? 'CANCELLED' : d.timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED',
      message: `${d.alias ?? d.transportSerial}: ${d.cancelled ? 'Cancelled.' : d.timedOut ? 'Timed out; the command may already have taken effect. It was not retried.' : d.stderr.trim() || 'Command failed; it was not retried.'}` }));
    return result(data, errors);
  } finally {
    controller.abort();
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
