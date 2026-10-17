import type { Device } from './devices.js';
import type { SavedDevice } from './store.js';

export class CliError extends Error {
  constructor(public code: string, message: string, public exitCode = 1) {
    super(message);
  }
}

export interface Problem {
  code: string;
  message: string;
  deviceId?: string;
  retryable?: boolean;
}

export interface Result {
  schemaVersion: 1;
  ok: boolean;
  data: unknown;
  errors: Problem[];
  watcher?: { pid: number; state: string } | null;
}

export function result(data: unknown, errors: Problem[] = []): Result {
  return { schemaVersion: 1, ok: errors.length === 0, data, errors };
}

export function formatDeviceTable(entries: (Device | SavedDevice)[], numbered = false): string {
  const rows = [['ALIAS', 'MODEL', 'CONNECTION', 'STATE', 'DEVICE'], ...entries.map(d => [
    d.alias ?? '-', 'transports' in d ? d.model : '-', d.kind,
    'transports' in d ? d.state : 'offline',
    'transports' in d ? d.serial : d.serials.at(-1) ?? d.id,
  ])];
  if (numbered) rows.forEach((row, i) => row.unshift(i === 0 ? '#' : String(i)));
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map(row => row[i]!.length)));
  rows.splice(1, 0, widths.map(width => '-'.repeat(width)));
  return rows.map(row => row.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd()).join('\n');
}

export function print(value: Result, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value));
    return;
  }
  if (value.watcher !== undefined) console.log(`Watcher: ${value.watcher ? `${value.watcher.state} (pid ${value.watcher.pid})` : 'stopped'}`);
  if (typeof value.data === 'string') console.log(value.data);
  else if (Array.isArray(value.data)) {
    if (!value.data.length) console.log('No devices or entries.');
    else if ('transportSerial' in value.data[0] && 'stdout' in value.data[0]) {
      for (const entry of value.data) {
        console.log(`[${entry.alias ?? entry.transportSerial}] exit=${entry.exitCode ?? 'unknown'}`);
        if (entry.stdout) process.stdout.write(entry.stdout.endsWith('\n') ? entry.stdout : `${entry.stdout}\n`);
        if (entry.stderr) process.stderr.write(entry.stderr.endsWith('\n') ? entry.stderr : `${entry.stderr}\n`);
      }
    } else if ('transports' in value.data[0]) {
      console.log(formatDeviceTable(value.data));
    } else console.log(JSON.stringify(value.data, null, 2));
  }
  else if (value.data !== null) console.log(JSON.stringify(value.data, null, 2));
  for (const error of value.errors) console.error(`${error.code}: ${error.message}`);
}
