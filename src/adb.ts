import { execFile } from 'node:child_process';
import { CliError } from './output.js';

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export function adb(args: string[], timeout = 10_000, input?: string): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.env.ADBDOCK_ADB ?? 'adb', args, {
      encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code === 'string' && ['ENOENT', 'EACCES'].includes(error.code)) {
        reject(new CliError('ADB_UNAVAILABLE', 'Cannot run adb. Install Android platform-tools or set ADBDOCK_ADB.'));
        return;
      }
      resolve({ stdout, stderr, exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0,
        timedOut: Boolean(error?.killed && error.signal === 'SIGKILL') });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

export async function checkedAdb(args: string[]): Promise<string> {
  const output = await adb(args);
  if (output.exitCode !== 0) throw new CliError(output.timedOut ? 'ADB_TIMEOUT' : 'ADB_ERROR', output.stderr.trim() || 'ADB command failed.');
  return output.stdout;
}

export async function mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += 4) {
    results.push(...await Promise.all(items.slice(i, i + 4).map(fn)));
  }
  return results;
}
