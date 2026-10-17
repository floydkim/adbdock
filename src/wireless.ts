import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { adb, checkedAdb, mapLimit } from './adb.js';
import type { Device } from './devices.js';
import type { Config } from './store.js';
import type { Problem } from './output.js';

interface Service { name: string; endpoint: string }
export type WirelessRetries = Map<string, { failures: number; next: number; endpoint: string }>;

export async function discoveredServices(type: '_adb-tls-connect._tcp' | '_adb-tls-pairing._tcp' = '_adb-tls-connect._tcp'): Promise<Service[]> {
  const output = await checkedAdb(['mdns', 'services']);
  const services: Service[] = [];
  for (const line of output.split(/\r?\n/)) {
    const [name, serviceType, endpoint] = line.trim().split(/\s+/);
    if (!name || !endpoint || serviceType?.replace(/\.$/, '') !== type) continue;
    const match = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/.exec(endpoint);
    if (!match || isIP(match[1]!) !== 4 || Number(match[2]) < 1 || Number(match[2]) > 65535) continue;
    services.push({ name, endpoint });
  }
  return services;
}

function bonjourOutput(args: string[], signal: AbortSignal): Promise<string> {
  return new Promise(resolve => {
    // dns-sd watches indefinitely; keep its partial output after a bounded query.
    execFile('dns-sd', args, { encoding: 'utf8', timeout: 1500, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, signal },
      (error, stdout) => resolve(signal.aborted || (error && !(error.killed && error.signal === 'SIGKILL')) ? '' : stdout));
  });
}

export async function bonjourService(name: string, signal: AbortSignal): Promise<Service[]> {
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || signal.aborted) return [];
  const output = await bonjourOutput(['-L', name, '_adb-tls-connect._tcp', 'local'], signal);
  const targets = new Map<string, { host: string; port: number }>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\S+\s+(.+)\._adb-tls-connect\._tcp\.local\. can be reached at ([a-zA-Z0-9_.-]+\.local\.?):(\d+) \(interface \d+\)$/.exec(line);
    if (!match || match[1] !== name) continue;
    const host = match[2]!;
    const port = Number(match[3]);
    if (port >= 1 && port <= 65535) targets.set(`${host}:${port}`, { host, port });
  }
  const services = await mapLimit([...targets.values()], async ({ host, port }) => {
    const addresses = new Set<string>();
    const output = await bonjourOutput(['-G', 'v4', host], signal);
    for (const line of output.split(/\r?\n/)) {
      const [, action, , , hostname, address] = line.trim().split(/\s+/);
      if (hostname !== host || !address || isIP(address) !== 4) continue;
      if (action === 'Add') addresses.add(address);
      if (action === 'Rmv') addresses.delete(address);
    }
    return [...addresses].map(address => ({ name, endpoint: `${address}:${port}` }));
  });
  return services.flat();
}

export async function reconnectKnown(config: Config, live: Device[], retries: WirelessRetries, interval: number, signal: AbortSignal) {
  const missing = config.devices.filter(d => d.wirelessServices?.length && !live.some(l => l.id === d.id && l.state === 'device'));
  const errors: Problem[] = [];
  if (!missing.length) return { attempted: false, errors };
  const services = await discoveredServices();
  if (process.platform === 'darwin') {
    const names = missing.filter(d => !services.some(s => d.wirelessServices!.includes(s.name)))
      .flatMap(d => d.wirelessServices!);
    services.push(...(await mapLimit([...new Set(names)], name => bonjourService(name, signal))).flat());
  }
  let attempted = false;
  for (const d of missing) {
    if (signal.aborted) break;
    const candidates = [...new Set(services.filter(s => d.wirelessServices!.includes(s.name)).map(s => s.endpoint))];
    if (candidates.length !== 1) {
      errors.push({ deviceId: d.id, code: candidates.length ? 'WIRELESS_AMBIGUOUS' : 'WIRELESS_NOT_DISCOVERED',
        message: `${d.alias ?? d.id}: ${candidates.length ? 'Several wireless endpoints match' : 'No remembered TLS service found'}. Check wireless debugging, pairing and mDNS.`, retryable: true });
      continue;
    }
    const endpoint = candidates[0]!;
    const previous = retries.get(d.id);
    if (previous?.endpoint === endpoint && previous.next > Date.now()) continue;
    attempted = true;
    const output = await adb(['connect', endpoint]);
    const failures = previous?.endpoint === endpoint ? previous.failures + 1 : 1;
    retries.set(d.id, { endpoint, failures, next: Date.now() + Math.min(30_000, interval * 2 ** Math.min(failures, 8)) });
    if (output.exitCode !== 0 || !/^(already )?connected to /m.test(output.stdout)) {
      errors.push({ deviceId: d.id, code: 'WIRELESS_CONNECT_FAILED',
        message: output.stderr.trim() || output.stdout.trim() || 'Wireless connection failed. Check pairing.', retryable: true });
    }
  }
  return { attempted, errors };
}
