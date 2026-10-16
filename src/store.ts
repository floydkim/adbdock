import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { CliError } from './output.js';

export interface SavedDevice {
  id: string;
  alias?: string;
  serials: string[];
  kind: string;
}

export interface Binding {
  deviceId: string;
  devicePort: number;
  metroPort: number;
  managedPort?: number;
}

export interface Config {
  schemaVersion: 1;
  devices: SavedDevice[];
  bindings: Binding[];
}

export const home = path.resolve(process.env.ADBDOCK_HOME ?? path.join(homedir(), 'Library', 'Application Support', 'adbdock'));
const configPath = path.join(home, 'config.json');

export function isPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535;
}

export async function readConfig(): Promise<Config> {
  try {
    const value = JSON.parse(await readFile(configPath, 'utf8'));
    if (value.schemaVersion !== 1 || !Array.isArray(value.devices) || !Array.isArray(value.bindings)
      || !value.devices.every((d: SavedDevice) => d && typeof d.id === 'string' && typeof d.kind === 'string'
        && (d.alias === undefined || typeof d.alias === 'string') && Array.isArray(d.serials) && d.serials.every(s => typeof s === 'string'))
      || !value.bindings.every((b: Binding) => b && typeof b.deviceId === 'string' && isPort(b.devicePort) && isPort(b.metroPort)
        && (b.managedPort === undefined || isPort(b.managedPort)))) {
      throw new Error('Unsupported config structure');
    }
    if (new Set(value.devices.map((d: SavedDevice) => d.id)).size !== value.devices.length
      || new Set(value.bindings.map((b: Binding) => `${b.deviceId}:${b.devicePort}`)).size !== value.bindings.length) {
      throw new Error('Duplicate configuration entries');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, devices: [], bindings: [] };
    throw new CliError('CONFIG_ERROR', `Cannot read ${configPath}: ${(error as Error).message}. The file was not changed.`);
  }
}

export async function saveConfig(config: Config): Promise<void> {
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
}

export async function withConfig<T>(fn: (config: Config) => Promise<T>): Promise<T> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  let release: (() => Promise<void>);
  try {
    release = await lockfile.lock(home, { realpath: false, stale: 10_000, update: 2000,
      retries: { retries: 50, minTimeout: 100, maxTimeout: 200 } });
  } catch {
    throw new CliError('BUSY', 'Another adbdock operation owns the configuration. Try again shortly.');
  }
  try { return await fn(await readConfig()); }
  finally { await release(); }
}
