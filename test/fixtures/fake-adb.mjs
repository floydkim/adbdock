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
  if (state.mdnsFail) { console.error('mDNS unavailable'); process.exit(1); }
  console.log(state.mdns ?? 'List of discovered mdns services');
  if (state.qrScan && !state.qrIgnore && !state.qrBonjourOnly) {
    console.log(`${state.qrScan.service} _adb-tls-pairing._tcp 192.168.0.7:37000`);
    if (state.qrAmbiguous) console.log(`${state.qrScan.service} _adb-tls-pairing._tcp 192.168.0.8:37000`);
  }
} else if (args[0] === 'pair') {
  let code = '';
  for await (const chunk of process.stdin) code += chunk;
  if (code.trim() !== (state.qrScan?.password ?? state.pairCode ?? '123456') || state.pairFail) {
    console.error(`Wrong pairing code: ${code.trim()}`); process.exit(1);
  }
  if (state.autoConnect) state.devices.push(state.autoConnect);
  writeFileSync(statePath, JSON.stringify(state));
  console.log(`Successfully paired to ${args[1]} [guid=${state.pairGuid ?? 'adb-phone1-xyz'}]`);
} else if (args[0] === 'connect') {
  if (state.connectFail) { console.error('connection refused'); process.exit(1); }
  if (state.connectDelay) await new Promise(resolve => setTimeout(resolve, state.connectDelay));
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
  if (device.commandFailures?.some(prefix => command.join(' ') === prefix || command.join(' ').startsWith(`${prefix} `))) {
    console.error('simulated command failure'); process.exit(1);
  }
  if (command.join(' ') === 'shell getprop ro.serialno') {
    if (device.identityFail) { console.error('identity unavailable'); process.exit(1); }
    console.log(device.id ?? device.serial);
  }
  else if (command.join(' ') === 'shell getprop persist.adb.wifi.guid') console.log(device.guid ?? '');
  else if (command.join(' ') === 'emu avd name') console.log(`${device.avd ?? 'Pixel_API_35'}\nOK`);
  else if (command[0] === 'shell' && command[1] === 'run-as') {
    // apps: { [package]: { host?: string } }; a missing package behaves like a non-debuggable app.
    const app = device.apps?.[command[2]];
    if (!app) { console.error(`run-as: package not debuggable: ${command[2]}`); process.exit(1); }
    if (app.host === undefined) { console.error(`cat: ${command[4]}: No such file or directory`); process.exit(1); }
    console.log(`<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <string name="debug_http_host">${app.host}</string>\n</map>`);
  }
  else if (command.join(' ') === 'shell dumpsys SurfaceFlinger --display-id') {
    for (const id of device.displays ?? []) console.log(`Display ${id} (HWC display 0): port=130`);
  } else if (command.slice(0, 3).join(' ') === 'exec-out screencap -p') {
    if (device.displays?.length > 1 && !command.includes('-d')) console.log('[Warning] Multiple displays were found.');
    process.stdout.write(Buffer.from([137,80,78,71,13,10,26,10,0,255,128]));
  }
  else if (command[0] === 'reverse') {
    device.reverse ??= {};
    if (command[1] === '--list') {
      for (const [from, to] of Object.entries(device.reverse)) console.log(`${device.serial} ${from} ${to}`);
    } else if (command[1] === '--remove') {
      delete device.reverse[command[2]];
    } else {
      const ports = command.filter(arg => arg.startsWith('tcp:'));
      if (device.reverseBeforeCreate) {
        Object.assign(device.reverse, device.reverseBeforeCreate);
        delete device.reverseBeforeCreate;
        writeFileSync(statePath, JSON.stringify(state));
      }
      if (command.includes('--no-rebind') && Object.hasOwn(device.reverse, ports[0])) {
        console.error('cannot rebind existing socket'); process.exit(1);
      }
      device.reverse[ports[0]] = ports[1];
    }
    if (command[1] !== '--list' && !state.recordOnlyReverse) writeFileSync(statePath, JSON.stringify(state));
  } else if (command[0] === 'shell' && command.join(' ').includes('toybox nc')) {
    if (device.probeFail) { console.error('probe failed'); process.exit(1); }
    if (device.probeHang) { await new Promise(resolve => setTimeout(resolve, 3000)); }
    const port = /127\.0\.0\.1 (\d+)/.exec(command.join(' '))?.[1];
    const target = device.reverse?.[`tcp:${port}`]?.replace('tcp:', '');
    const response = await fetch(`http://127.0.0.1:${target}/probe`);
    console.log(await response.text());
  } else if (device.hang) {
    setTimeout(() => {}, 60_000);
  } else if (device.fail) {
    console.error('command failed'); process.exit(1);
  } else console.log(`${device.serial}: ${JSON.stringify(command)}`);
} else process.exit(1);
