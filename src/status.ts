import http from 'node:http';
import { mapLimit } from './adb.js';
import { devices } from './devices.js';
import { reversePorts } from './link.js';
import { readConfig } from './store.js';

function metroStatus(port: number): Promise<string> {
  return new Promise(resolve => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/status' }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 1024) request.destroy(new Error('Unexpected response'));
      });
      response.on('end', () => resolve(response.statusCode === 200 && body.trim() === 'packager-status:running' ? 'running' : 'unexpected_response'));
      response.on('error', () => resolve('unreachable'));
    });
    const timer = setTimeout(() => request.destroy(new Error('Timeout')), 700);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => resolve('unreachable'));
  });
}

export async function status() {
  const config = await readConfig();
  const live = await devices(config);
  const known = [...live, ...config.devices.filter(saved => !live.some(d => d.id === saved.id))];
  const servers = new Map<number, Promise<string>>();
  for (const b of config.bindings) if (!servers.has(b.metroPort)) servers.set(b.metroPort, metroStatus(b.metroPort));
  return mapLimit(known, async d => {
    const online = 'state' in d && d.state === 'device';
    const bindings = config.bindings.filter(b => b.deviceId === d.id);
    let tunnels = new Map<number, string>();
    let reverseError: string | undefined;
    if (online && bindings.length) {
      try { tunnels = await reversePorts(d.serial); }
      catch (error) { reverseError = (error as Error).message; }
    }
    return { id: d.id, alias: d.alias, serial: 'serial' in d ? d.serial : null,
      state: 'state' in d ? d.state : 'disconnected', kind: d.kind,
      metro: bindings.length ? await Promise.all(bindings.map(async b => ({ devicePort: b.devicePort,
        metroPort: b.metroPort, reverse: !online ? 'unavailable' : reverseError ? 'error' : tunnels.get(b.devicePort) === `tcp:${b.metroPort}` ? 'ready' : tunnels.has(b.devicePort) ? 'conflict' : 'missing',
        server: await servers.get(b.metroPort), ...(reverseError ? { error: reverseError } : {}) }))) : 'not_configured',
      app: 'unknown' };
  });
}
