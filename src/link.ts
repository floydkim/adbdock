import { checkedAdb } from './adb.js';
import type { Device } from './devices.js';
import { remember } from './devices.js';
import { CliError, result } from './output.js';
import type { Problem } from './output.js';
import type { Binding, Config } from './store.js';
import { saveConfig } from './store.js';

export async function reversePorts(serial: string): Promise<Map<number, string>> {
  const output = await checkedAdb(['-s', serial, 'reverse', '--list']);
  const ports = new Map<number, string>();
  for (const line of output.trim().split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const from = parts.at(-2);
    const to = parts.at(-1);
    if (from?.startsWith('tcp:') && to) ports.set(Number(from.slice(4)), to);
  }
  return ports;
}

export function problem(error: unknown, deviceId: string): Problem {
  return { deviceId, code: error instanceof CliError ? error.code : 'OPERATION_FAILED',
    message: (error as Error).message, retryable: !(error instanceof CliError && error.code === 'REVERSE_CONFLICT') };
}

export async function applyBinding(binding: Binding, device: Device | undefined, replace = false): Promise<void> {
  if (!device || device.state !== 'device') throw new CliError('DEVICE_UNAVAILABLE', `${device?.alias ?? binding.deviceId} is offline or requires authorization.`);
  const ports = await reversePorts(device.serial);
  const current = ports.get(binding.devicePort);
  const desired = `tcp:${binding.metroPort}`;
  if (current === desired) return;
  if (current && current !== `tcp:${binding.managedPort}` && !replace) {
    throw new CliError('REVERSE_CONFLICT', `${device.alias ?? device.serial}: tcp:${binding.devicePort} points to ${current}. Use metro bind --replace to take over.`);
  }
  const args = ['-s', device.serial, 'reverse'];
  if (!current) args.push('--no-rebind');
  await checkedAdb([...args, `tcp:${binding.devicePort}`, desired]);
  binding.managedPort = binding.metroPort;
  const after = await reversePorts(device.serial);
  if (after.get(binding.devicePort) !== desired) throw new CliError('REVERSE_VERIFY_FAILED', `Could not verify tcp:${binding.devicePort} on ${device.serial}.`);
}

export async function repairBindings(config: Config, live: Device[], deviceId?: string) {
  const data: unknown[] = [];
  const errors: Problem[] = [];
  for (const binding of config.bindings.filter(b => !deviceId || b.deviceId === deviceId)) {
    const device = live.find(d => d.id === binding.deviceId);
    try {
      await applyBinding(binding, device);
      if (device) remember(config, device);
      data.push({ ...binding, state: 'ready' });
    } catch (error) {
      const failure = problem(error, binding.deviceId);
      errors.push(failure);
      data.push({ ...binding, state: failure.code });
    }
  }
  await saveConfig(config);
  return result(data, errors);
}

export async function removeBinding(binding: Binding, device: Device | undefined): Promise<void> {
  if (binding.managedPort === undefined) return;
  if (!device || device.state !== 'device') throw new CliError('DEVICE_UNAVAILABLE', 'Mapping removed from configuration; the offline device tunnel could not be checked.');
  const current = (await reversePorts(device.serial)).get(binding.devicePort);
  if (!current) return;
  if (current !== `tcp:${binding.managedPort}`) throw new CliError('REVERSE_CONFLICT', 'Mapping removed from configuration; the tunnel was changed by another tool and was preserved.');
  await checkedAdb(['-s', device.serial, 'reverse', '--remove', `tcp:${binding.devicePort}`]);
}
