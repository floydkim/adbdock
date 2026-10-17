import { isIP } from 'node:net';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { adb } from './adb.js';
import { assignAlias, devices, remember } from './devices.js';
import { CliError, result } from './output.js';
import { isPort, readConfig, saveConfig, withConfig } from './store.js';
import { bonjourService, discoveredServices } from './wireless.js';

export async function pairingServices(): Promise<{ name: string; endpoint: string }[]> {
  const services = await discoveredServices('_adb-tls-pairing._tcp');
  return services.filter(s => /^adb-[a-zA-Z0-9_-]+$/.test(s.name));
}

function endpoint(value: string): string {
  const [host, port, extra] = value.split(':');
  if (!host || isIP(host) !== 4 || !port || !/^\d+$/.test(port) || !isPort(Number(port)) || extra !== undefined) {
    throw new CliError('INVALID_ARGUMENT', 'Use an IPv4 address and port, such as 192.168.0.7:37000.', 2);
  }
  return value;
}

function readLine(prompt: string, hidden = false, piped = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = hidden ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stderr;
    const reader = createInterface({ input: process.stdin, output, terminal: !piped });
    const cancel = () => { reader.close(); };
    process.once('SIGINT', cancel);
    reader.once('SIGINT', cancel);
    reader.once('close', () => {
      process.removeListener('SIGINT', cancel);
      process.stdin.pause();
      reject(new CliError('PAIR_CANCELLED', 'Pairing input cancelled.', 130));
    });
    const answer = (line: string) => { resolve(line.trim()); reader.close(); if (hidden && !piped) process.stderr.write('\n'); };
    if (piped) reader.once('line', answer);
    else {
      if (hidden) process.stderr.write(prompt);
      reader.question(hidden ? '' : prompt, answer);
    }
  });
}

export async function pairDevice(options: { endpoint?: string; alias?: string; connect?: string; codeStdin: boolean }) {
  let target = options.endpoint;
  if (target) endpoint(target);
  if (options.connect) endpoint(options.connect);
  if (options.alias !== undefined && !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(options.alias)) {
    throw new CliError('INVALID_ARGUMENT', 'Alias must start with a letter and use letters, numbers, _ or - (up to 64 characters).', 2);
  }
  if ((!process.stdin.isTTY && !options.codeStdin) || (options.codeStdin && !target)) {
    throw new CliError('INVALID_ARGUMENT', 'Noninteractive pairing needs an explicit pairing endpoint and --code-stdin. Pass one six-digit code line on stdin.', 2);
  }
  // Read config before creating a trust relationship, without holding its lock during prompts.
  await readConfig();
  if (!target) {
    process.stderr.write('On your phone, open Wireless debugging > Pair device with pairing code.\n');
    const services = await pairingServices();
    if (!services.length) throw new CliError('PAIR_NOT_DISCOVERED', 'No code-pairing services found. Open the pairing screen or specify its IP:port.');
    services.forEach((s, i) => process.stderr.write(`${i + 1}. ${s.name} (${s.endpoint})\n`));
    const choice = services.length === 1 ? 1 : Number(await readLine('Choose a device number: '));
    if (!Number.isInteger(choice) || choice < 1 || choice > services.length) throw new CliError('INVALID_ARGUMENT', 'Choose one of the listed device numbers.', 2);
    target = services[choice - 1]!.endpoint;
  }
  const code = await readLine(`Pairing code for ${target}: `, true, options.codeStdin);
  if (!/^\d{6}$/.test(code)) throw new CliError('INVALID_ARGUMENT', 'Pairing code must contain six digits.', 2);
  const paired = await adb(['pair', target], 30_000, `${code}\n`);
  if (paired.exitCode !== 0 || !paired.stdout.includes('Successfully paired to ')) {
    throw new CliError('PAIR_FAILED', 'Pairing failed. Reopen the pairing-code screen and check its address and code.');
  }
  const guid = /\[guid=([a-zA-Z0-9_-]+)\]/.exec(paired.stdout)?.[1];
  const pending = (message: string) => result({ paired: true, connected: false, pairingEndpoint: target, pairedGuid: guid }, [{ code: 'PAIR_CONNECTION_PENDING', message }]);
  if (!guid) return pending('Pairing succeeded, but ADB did not return a device GUID. Check adb devices before registering the device.');
  try {
    let connect = options.connect;
    let attempted = false;
    let bonjourTried = false;
    const resolvedEndpoints = new Set<string>();
    const deadline = Date.now() + 5000;
    while (true) {
      const config = await readConfig();
      const live = await devices(config);
      const device = live.find(d => {
        if (d.state !== 'device' || !d.id.startsWith('android:')) return false;
        const savedIdentity = config.devices.some(saved => saved.id === d.id && saved.wirelessServices?.includes(guid));
        const discoveredEndpoint = d.transports.some(t => resolvedEndpoints.has(t.serial));
        const matchingGuid = d.wirelessServices.includes(guid)
          || (!d.wirelessServices.length && (savedIdentity || discoveredEndpoint));
        const onlineWifi = d.transports.some(t => t.kind === 'wifi' && t.state === 'device'
          && (!connect || t.serial === connect || t.serial === `${guid}._adb-tls-connect._tcp`));
        return matchingGuid && onlineWifi;
      });
      if (device) {
        if (!device.wirelessServices.includes(guid)) device.wirelessServices.push(guid);
        try {
          const saved = await withConfig(async current => {
            const saved = options.alias ? assignAlias(current, device, live, options.alias) : remember(current, device);
            await saveConfig(current);
            return saved;
          });
          return result({ paired: true, connected: true, device: saved });
        } catch (error) {
          return result({ paired: true, connected: true, deviceId: device.id }, [{
            code: error instanceof CliError ? error.code : 'CONFIG_ERROR',
            message: `Pairing and connection succeeded, but registration failed: ${(error as Error).message}`,
          }]);
        }
      }
      if (!resolvedEndpoints.size) {
        let services = (await discoveredServices().catch(() => [])).filter(s => s.name === guid);
        if (!services.length && !bonjourTried && process.platform === 'darwin') {
          bonjourTried = true;
          services = await bonjourService(guid, new AbortController().signal);
        }
        for (const service of services) resolvedEndpoints.add(service.endpoint);
        if (!connect && resolvedEndpoints.size > 1) return pending('Pairing succeeded, but several connection endpoints match. Specify --connect with the wireless-debugging connection address.');
        connect ??= [...resolvedEndpoints][0];
      }
      if (connect && !attempted) {
        attempted = true;
        const output = await adb(['connect', connect]);
        if (output.exitCode !== 0 || !/^(already )?connected to /m.test(output.stdout)) return pending('Pairing succeeded, but connection failed. Check the wireless-debugging connection address.');
        // Always verify once after connect, even if discovery used the polling window.
        continue;
      }
      if (Date.now() >= deadline) break;
      await sleep(250);
    }
    return pending('Pairing succeeded, but no matching online wireless device was verified. Check wireless debugging and discovery, or use --connect with its connection IP:port.');
  } catch (error) {
    const code = error instanceof CliError ? error.code : 'INTERNAL_ERROR';
    return pending(`Pairing succeeded, but connection verification failed (${code}). Check adb devices and the connection address.`);
  }
}
