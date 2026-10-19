import http from 'node:http';
import { adb, mapLimit } from './adb.js';
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

// React Native reads a host saved from the dev menu first. Without one, emulators use 10.0.2.2,
// which reaches the Mac directly and skips adb reverse, and devices use localhost.
// The default port is the build's dev server port; 8081 unless the app changed it.
async function appMetro(serial: string, kind: string, app: string, devicePort: number) {
  const output = await adb(['-s', serial, 'shell', 'run-as', app, 'cat', `shared_prefs/${app}_preferences.xml`]);
  const text = `${output.stdout}\n${output.stderr}`;
  if (output.exitCode !== 0 && !/No such file/.test(text)) {
    return { package: app, route: 'unknown', error: output.stderr.trim() || output.stdout.trim() || 'run-as failed' };
  }
  const saved = /<string name="debug_http_host">([^<]*)<\/string>/.exec(output.stdout)?.[1]?.trim();
  const host = saved || (kind === 'emulator' ? '10.0.2.2:8081' : 'localhost:8081');
  const [name, portText] = host.split(':');
  const local = name === 'localhost' || name === '127.0.0.1';
  const route = !local ? 'direct' : Number(portText) === devicePort ? 'tunnel' : 'other_port';
  return { package: app, host, source: saved ? 'saved' : 'default', route };
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
      metro: bindings.length ? await Promise.all(bindings.map(async b => {
        const reverse = !online ? 'unavailable' : reverseError ? 'error' : tunnels.get(b.devicePort) === `tcp:${b.metroPort}` ? 'ready' : tunnels.has(b.devicePort) ? 'conflict' : 'missing';
        return { devicePort: b.devicePort, metroPort: b.metroPort, reverse,
          ...(reverse === 'conflict' ? { current: tunnels.get(b.devicePort) } : {}),
          server: await servers.get(b.metroPort), ...(reverseError ? { error: reverseError } : {}),
          ...(online && b.app ? { app: await appMetro(d.serial, d.kind, b.app, b.devicePort) } : {}) };
      })) : 'not_configured',
      app: 'unknown' };
  });
}
