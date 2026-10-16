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
      const rows = [['ALIAS', 'DEVICE', 'CONNECTION', 'STATE', 'MODEL'], ...value.data.map(d => [d.alias ?? '-', d.serial, d.kind, d.state, d.model])];
      const widths = rows[0]!.map((_: string, i: number) => Math.max(...rows.map(row => String(row[i]).length)));
      for (const row of rows) console.log(row.map((cell: string, i: number) => String(cell).padEnd(widths[i]!)).join('  ').trimEnd());
    } else console.log(JSON.stringify(value.data, null, 2));
  }
  else if (value.data !== null) console.log(JSON.stringify(value.data, null, 2));
  for (const error of value.errors) console.error(`${error.code}: ${error.message}`);
}
