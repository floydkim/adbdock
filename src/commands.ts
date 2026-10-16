import { adb, mapLimit } from './adb.js';
import type { Device } from './devices.js';
import { CliError, result } from './output.js';

export function validateCommand(args: string[]): void {
  const allowed = ['shell', 'install', 'install-multiple', 'uninstall', 'push', 'pull', 'bugreport', 'get-state', 'get-serialno', 'get-devpath', 'jdwp', 'reverse', 'forward', 'reboot'];
  if (!args[0] || !allowed.includes(args[0])) throw new CliError('INVALID_ARGUMENT', 'Expected a finite device command (shell, install, push, pull, reverse, ...). Host commands and streams are unsupported.', 2);
  if (args[0] === 'shell' && (args.length === 1 || args[1]?.startsWith('-'))) {
    throw new CliError('INVALID_ARGUMENT', 'Interactive shell and shell transport flags are unsupported. Supply a shell command.', 2);
  }
}

export async function runCommands(selected: Device[], args: string[], timeout: number) {
  if (selected.length > 1 && (args[0] === 'pull' || args[0] === 'bugreport')) {
    throw new CliError('INVALID_ARGUMENT', 'pull and bugreport require a single --device to avoid overwriting host files.', 2);
  }
  const data = await mapLimit(selected, async d => ({ deviceId: d.id, alias: d.alias, transportSerial: d.serial,
    ...await adb(['-s', d.serial, ...args], timeout) }));
  const errors = data.filter(d => d.exitCode !== 0).map(d => ({ deviceId: d.deviceId,
    code: d.timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_FAILED', retryable: false,
    message: `${d.alias ?? d.transportSerial}: ${d.timedOut ? 'Timed out; the command may already have taken effect. It was not retried.' : d.stderr.trim() || 'Command failed; it was not retried.'}` }));
  return result(data, errors);
}
