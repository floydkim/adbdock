import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import qrcode from 'qrcode-terminal';
import { bonjourService, discoveredServices } from './wireless.js';
import { CliError } from './output.js';

export async function scanQr(timeout: number) {
  const service = `studio-adbdock-${randomBytes(6).toString('hex')}`;
  const password = randomBytes(8).toString('base64url').slice(0, 10);
  const controller = new AbortController();
  const cancel = () => controller.abort('cancelled');
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const timer = setTimeout(() => controller.abort('timeout'), timeout);
  try {
    qrcode.generate(`WIFI:T:ADB;S:${service};P:${password};;`, { small: true }, qr => process.stderr.write(`\x1b[37;40m${qr}\x1b[0m\n`));
    process.stderr.write('Scan this QR: Wireless debugging > Pair device with QR code.\n');
    while (!controller.signal.aborted) {
      let services = (await discoveredServices('_adb-tls-pairing._tcp').catch(() => [])).filter(s => s.name === service);
      if (!services.length && process.platform === 'darwin' && !controller.signal.aborted) {
        services = await bonjourService(service, controller.signal, '_adb-tls-pairing._tcp');
      }
      if (controller.signal.aborted) break;
      const endpoints = [...new Set(services.map(s => s.endpoint))];
      if (endpoints.length > 1) throw new CliError('PAIR_AMBIGUOUS', 'Several endpoints advertise this QR session. Cancel and try a new QR.');
      if (endpoints.length === 1) return { endpoint: endpoints[0]!, password };
      await sleep(250, undefined, { signal: controller.signal }).catch(() => {});
    }
    if (controller.signal.reason === 'cancelled') throw new CliError('PAIR_CANCELLED', 'QR pairing cancelled.', 130);
    throw new CliError('PAIR_SCAN_TIMEOUT', 'QR scan timed out. Run pair --qr again, or use pairing-code mode.');
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
