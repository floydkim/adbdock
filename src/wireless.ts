import { isIP } from 'node:net';
import { adb, checkedAdb } from './adb.js';
import type { Device } from './devices.js';
import type { Config } from './store.js';
import type { Problem } from './output.js';

interface Service { name: string; endpoint: string }
export type WirelessRetries = Map<string, { failures: number; next: number; endpoint: string }>;

export async function discoveredServices(): Promise<Service[]> {
  const output = await checkedAdb(['mdns', 'services']);
  const services: Service[] = [];
  for (const line of output.split(/\r?\n/)) {
    const [name, type, endpoint] = line.trim().split(/\s+/);
    if (!name || !endpoint || type?.replace(/\.$/, '') !== '_adb-tls-connect._tcp') continue;
    const match = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/.exec(endpoint);
    if (!match || isIP(match[1]!) !== 4 || Number(match[2]) < 1 || Number(match[2]) > 65535) continue;
    services.push({ name, endpoint });
  }
  return services;
}

export async function reconnectKnown(config: Config, live: Device[], retries: WirelessRetries, interval: number, signal: AbortSignal) {
  const missing = config.devices.filter(d => d.wirelessServices?.length && !live.some(l => l.id === d.id && l.state === 'device'));
  const errors: Problem[] = [];
  if (!missing.length) return { attempted: false, errors };
  const services = await discoveredServices();
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
