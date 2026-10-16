import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { devices, remember } from './devices.js';
import { applyBinding, problem } from './link.js';
import { home, saveConfig, withConfig } from './store.js';
import { result } from './output.js';
import type { Problem } from './output.js';
import { reconnectKnown } from './wireless.js';
import type { WirelessRetries } from './wireless.js';

export async function logEvent(value: unknown): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, 'watch.log');
  try {
    if ((await stat(file)).size > 1024 * 1024) await rename(file, `${file}.1`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await appendFile(file, `${JSON.stringify({ time: new Date().toISOString(), event: value })}\n`, { mode: 0o600 });
}

export async function watchLoop(interval: number, signal: AbortSignal): Promise<void> {
  const retries = new Map<string, { failures: number; next: number; signature: string }>();
  const wirelessRetries: WirelessRetries = new Map();
  let lastEvent = '';
  while (!signal.aborted) {
    try {
      const output = await withConfig(async config => {
        const before = JSON.stringify(config);
        let live = await devices(config);
        const errors: Problem[] = [];
        const data: unknown[] = [];
        try {
          const wireless = await reconnectKnown(config, live, wirelessRetries, interval, signal);
          errors.push(...wireless.errors);
          if (wireless.attempted && !signal.aborted) live = await devices(config);
        } catch (error) { errors.push(problem(error, 'wireless-discovery')); }
        for (const device of live) {
          if (config.devices.some(d => d.id === device.id)) {
            remember(config, device);
            if (device.state === 'device') wirelessRetries.delete(device.id);
          }
        }
        for (const b of config.bindings) {
          if (signal.aborted) break;
          const device = live.find(d => d.id === b.deviceId);
          const key = `${b.deviceId}:${b.devicePort}`;
          const signature = `${b.metroPort}:${device?.serial}:${device?.state}`;
          const previous = retries.get(key);
          if (previous?.signature === signature && previous.next > Date.now()) continue;
          try {
            await applyBinding(b, device);
            if (device) remember(config, device);
            retries.delete(key);
            data.push({ deviceId: b.deviceId, devicePort: b.devicePort, metroPort: b.metroPort, state: 'ready' });
          } catch (error) {
            const failures = previous?.signature === signature ? previous.failures + 1 : 1;
            retries.set(key, { signature, failures, next: Date.now() + Math.min(30_000, interval * 2 ** Math.min(failures, 8)) });
            errors.push(problem(error, b.deviceId));
          }
        }
        if (JSON.stringify(config) !== before) await saveConfig(config);
        return result(data, errors);
      });
      const event = JSON.stringify(output);
      if (event !== lastEvent) { await logEvent(output); lastEvent = event; }
    } catch (error) {
      const event = JSON.stringify({ error: (error as Error).message });
      if (event !== lastEvent) { await logEvent({ error: (error as Error).message }); lastEvent = event; }
    }
    try { await sleep(interval, undefined, { signal }); }
    catch (error) { if (!signal.aborted) throw error; }
  }
}
