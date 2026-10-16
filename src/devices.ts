import { checkedAdb, mapLimit } from './adb.js';
import { CliError } from './output.js';
import type { Config, SavedDevice } from './store.js';

interface Transport {
  serial: string;
  state: string;
  kind: 'usb' | 'wifi' | 'emulator';
  model: string;
}

export interface Device extends Transport {
  id: string;
  alias?: string;
  transports: Transport[];
}

export async function devices(config: Config): Promise<Device[]> {
  const output = await checkedAdb(['devices', '-l']);
  const transports: Transport[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('List ') || line.startsWith('*')) continue;
    const [serial, state] = line.trim().split(/\s+/);
    if (!serial || !state) continue;
    const kind = serial.startsWith('emulator-') ? 'emulator' : (serial.includes(':') || serial.includes('._adb-')) ? 'wifi' : 'usb';
    transports.push({ serial, state, kind, model: /\bmodel:(\S+)/.exec(line)?.[1]?.replaceAll('_', ' ') ?? 'unknown' });
  }
  const identified = await mapLimit(transports, async transport => {
    let id = config.devices.find(d => d.serials.includes(transport.serial))?.id ?? `transport:${transport.serial}`;
    if (transport.state === 'device') {
      try {
        if (transport.kind === 'emulator') {
          const name = (await checkedAdb(['-s', transport.serial, 'emu', 'avd', 'name'])).trim().split(/\r?\n/)[0];
          if (name && name !== 'OK') id = `avd:${name}`;
        } else {
          const hardware = (await checkedAdb(['-s', transport.serial, 'shell', 'getprop', 'ro.serialno'])).trim();
          if (hardware && hardware !== 'unknown' && hardware !== '0123456789ABCDEF') id = `android:${hardware}`;
        }
      } catch { /* A listed transport can disconnect before identity lookup. */ }
    }
    return { ...transport, id };
  });
  const grouped = new Map<string, Device>();
  for (const item of identified) {
    const peers = identified.filter(d => d.id === item.id);
    const ambiguous = peers.filter(d => d.kind === 'usb').length > 1 || (item.kind === 'emulator' && peers.length > 1);
    const id = ambiguous ? `transport:${item.serial}` : item.id;
    const previous = grouped.get(id);
    if (previous) {
      previous.transports.push(item);
      if (item.state === 'device' && (previous.state !== 'device' || item.kind === 'usb')) {
        Object.assign(previous, item, { id });
      }
    } else {
      grouped.set(id, { ...item, id, alias: config.devices.find(d => d.id === id)?.alias, transports: [item] });
    }
  }
  return [...grouped.values()];
}

export function resolveDevice(target: string, live: Device[], config: Config): Device | SavedDevice {
  const matches = new Map<string, Device | SavedDevice>();
  for (const d of config.devices) {
    if (d.id === target || d.alias === target || d.serials.includes(target)) matches.set(d.id, d);
  }
  for (const d of live) {
    if (d.id === target || d.alias === target || d.transports.some(t => t.serial === target) || matches.has(d.id)) matches.set(d.id, d);
  }
  if (matches.size !== 1) throw new CliError(matches.size ? 'AMBIGUOUS_DEVICE' : 'DEVICE_NOT_FOUND',
    `Device '${target}' ${matches.size ? 'is ambiguous' : 'was not found'}. Use adbdock devices.`, 3);
  const selected = [...matches.values()][0]!;
  // An exact transport argument must stay exact even when USB is normally preferred.
  if ('transports' in selected) {
    const exact = selected.transports.find(t => t.serial === target);
    if (exact) return { ...selected, ...exact };
  }
  return selected;
}

export function remember(config: Config, device: Device | SavedDevice): SavedDevice {
  let saved = config.devices.find(d => d.id === device.id);
  if (!saved) {
    saved = { id: device.id, kind: device.kind, serials: [] };
    config.devices.push(saved);
  }
  if ('transports' in device) saved.serials = [...new Set([...saved.serials, ...device.transports.map(t => t.serial)])];
  return saved;
}

export function selectDevices(targets: string[], all: boolean, live: Device[], config: Config): Device[] {
  if ((!all && targets.length === 0) || (all && targets.length > 0)) {
    throw new CliError('INVALID_ARGUMENT', 'Choose --device <device> (repeatable) or --all.', 2);
  }
  if (all) {
    const online = live.filter(d => d.state === 'device');
    if (!online.length) throw new CliError('DEVICE_NOT_FOUND', 'No online devices.', 3);
    return online;
  }
  const selected = targets.map(t => resolveDevice(t, live, config));
  for (const d of selected) {
    if (!('state' in d) || d.state !== 'device') throw new CliError('DEVICE_UNAVAILABLE', `${d.alias ?? d.id} is offline or requires authorization.`, 3);
  }
  return [...new Map((selected as Device[]).map(d => [d.serial, d])).values()];
}
