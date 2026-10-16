#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const statePath = process.env.FAKE_ADB_STATE;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
appendFileSync(`${statePath}.calls`, `${JSON.stringify(args)}\n`);
if (args[0] === 'devices') {
  console.log('List of devices attached');
  for (const d of state.devices) console.log(`${d.serial}\t${d.state ?? 'device'} model:${d.model ?? 'Pixel'} transport_id:1`);
} else if (args[0] === 'mdns') {
  console.log(state.mdns ?? 'List of discovered mdns services');
} else if (args[0] === 'connect') {
  const added = state.connectDevices?.[args[1]];
  if (added) {
    state.devices.push(added);
    delete state.connectDevices[args[1]];
    writeFileSync(statePath, JSON.stringify(state));
  }
  console.log(`connected to ${args[1]}`);
} else if (args[0] === '-s') {
  const device = state.devices.find(d => d.serial === args[1]);
  if (!device || device.state === 'offline') { console.error('device offline'); process.exit(1); }
  const command = args.slice(2);
  if (command.join(' ') === 'shell getprop ro.serialno') {
    if (device.identityFail) { console.error('identity unavailable'); process.exit(1); }
    console.log(device.id ?? device.serial);
  }
  else if (command.join(' ') === 'shell getprop persist.adb.wifi.guid') console.log(device.guid ?? '');
  else if (command.join(' ') === 'emu avd name') console.log(`${device.avd ?? 'Pixel_API_35'}\nOK`);
  else if (command[0] === 'reverse') {
    device.reverse ??= {};
    if (command[1] === '--list') {
      for (const [from, to] of Object.entries(device.reverse)) console.log(`${device.serial} ${from} ${to}`);
    } else if (command[1] === '--remove') {
      delete device.reverse[command[2]];
    } else {
      const ports = command.filter(arg => arg.startsWith('tcp:'));
      device.reverse[ports[0]] = ports[1];
    }
    writeFileSync(statePath, JSON.stringify(state));
  } else if (device.hang) {
    setTimeout(() => {}, 60_000);
  } else if (device.fail) {
    console.error('command failed'); process.exit(1);
  } else console.log(`${device.serial}: ${JSON.stringify(command)}`);
} else process.exit(1);
