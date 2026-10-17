import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { setup } from './helpers.mjs';

async function waitFor(fn) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) { if (await fn()) return; await delay(50); }
  assert.fail('Wireless reconnect did not complete');
}

test('macOS Bonjour reconnects a remembered service when ADB discovery is empty', { skip: process.platform !== 'darwin' }, async t => {
  const app = await setup(t, [{ serial: 'usb1', id: 'phone1', guid: 'known' }]);
  await app.run('alias', 'usb1', 'pixel');
  await app.run('metro', 'bind', 'pixel', '--port', '8082');
  await app.setState({ devices: [], bonjourHang: true,
    bonjour: { 'adb-known': [{ host: 'phone.local.', port: 45678 }] },
    addresses: { 'phone.local.': ['192.168.0.9'] },
    connectDevices: { '192.168.0.9:45678': { serial: '192.168.0.9:45678', id: 'phone1' } } });
  await app.run('watch', '--background', '--interval', '100', '--json');
  await waitFor(async () => (await app.state()).devices[0]?.reverse?.['tcp:8081'] === 'tcp:8082');
  assert.deepEqual((await app.calls()).find(c => c[0] === 'connect'), ['connect', '192.168.0.9:45678']);
  const calls = (await readFile(`${app.statePath}.bonjour`, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls[0], ['-L', 'adb-known', '_adb-tls-connect._tcp', 'local']);
  assert.deepEqual(calls[1], ['-G', 'v4', 'phone.local.']);
});

test('Bonjour does not connect missing, unrelated, invalid or ambiguous endpoints', { skip: process.platform !== 'darwin' }, async t => {
  const scenarios = [
    { name: 'missing service', records: [], code: 'WIRELESS_NOT_DISCOVERED' },
    { name: 'unrelated service', records: [{ name: 'adb-other', host: 'phone.local.', port: 40000 }], code: 'WIRELESS_NOT_DISCOVERED' },
    { name: 'invalid port', records: [{ host: 'phone.local.', port: 0 }], code: 'WIRELESS_NOT_DISCOVERED' },
    { name: 'ambiguous ports', records: [{ host: 'phone.local.', port: 40000 }, { host: 'phone.local.', port: 40001 }], code: 'WIRELESS_AMBIGUOUS' },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async t => {
      const app = await setup(t, [{ serial: 'usb1', id: 'phone1', guid: 'known' }]);
      await app.run('alias', 'usb1', 'pixel');
      await app.setState({ devices: [], bonjour: { 'adb-known': scenario.records }, addresses: { 'phone.local.': ['192.168.0.9'] } });
      await app.run('watch', '--background', '--interval', '100', '--json');
      await waitFor(async () => {
        try { return (await readFile(`${app.env.ADBDOCK_HOME}/watch.log`, 'utf8')).includes(scenario.code); }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      });
      assert.equal((await app.calls()).filter(c => c[0] === 'connect').length, 0);
    });
  }
});

test('an ADB-discovered endpoint does not need Bonjour', { skip: process.platform !== 'darwin' }, async t => {
  const app = await setup(t, [{ serial: 'usb1', id: 'phone1', guid: 'known' }]);
  await app.run('alias', 'usb1', 'pixel');
  await app.setState({ devices: [], mdns: 'adb-known _adb-tls-connect._tcp 192.168.0.9:40000',
    connectDevices: { '192.168.0.9:40000': { serial: '192.168.0.9:40000', id: 'phone1' } } });
  await app.run('watch', '--background', '--interval', '100', '--json');
  await waitFor(async () => (await app.calls()).some(c => c[0] === 'connect'));
  await assert.rejects(readFile(`${app.statePath}.bonjour`), { code: 'ENOENT' });
});

test('stopping the watcher terminates an active Bonjour query', { skip: process.platform !== 'darwin' }, async t => {
  const app = await setup(t, [{ serial: 'usb1', id: 'phone1', guid: 'known' }]);
  await app.run('alias', 'usb1', 'pixel');
  await app.setState({ devices: [], bonjourHang: true });
  await app.run('watch', '--background', '--interval', '100', '--json');
  let pid;
  await waitFor(async () => {
    try { pid = Number((await readFile(`${app.statePath}.bonjour-pids`, 'utf8')).trim()); return Boolean(pid); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
  assert.equal((await app.run('watch', 'stop', '--json')).code, 0);
  await waitFor(() => {
    try { process.kill(pid, 0); return false; }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  });
  assert.equal((await app.calls()).filter(c => c[0] === 'connect').length, 0);
});

test('a Bonjour endpoint with a different hardware identity receives no saved mapping', { skip: process.platform !== 'darwin' }, async t => {
  const app = await setup(t, [{ serial: 'usb1', id: 'phone1', guid: 'known' }]);
  await app.run('alias', 'usb1', 'pixel');
  await app.run('metro', 'bind', 'pixel', '--port', '8082');
  await app.setState({ devices: [], bonjour: { 'adb-known': [{ host: 'phone.local.', port: 40000 }] },
    addresses: { 'phone.local.': ['192.168.0.9'] },
    connectDevices: { '192.168.0.9:40000': { serial: '192.168.0.9:40000', id: 'another-phone' } } });
  await app.run('watch', '--background', '--interval', '100', '--json');
  await waitFor(async () => {
    try { return (await readFile(`${app.env.ADBDOCK_HOME}/watch.log`, 'utf8')).includes('DEVICE_UNAVAILABLE'); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
  assert.equal((await app.state()).devices[0].reverse, undefined);
});

test('a remembered wireless service reconnects using its new endpoint without Metro', async t => {
  const serial = 'adb-phone1-xyz._adb-tls-connect._tcp';
  const app = await setup(t, [{ serial, id: 'phone1', guid: 'phone1-xyz' }]);
  await app.run('alias', serial, 'pixel');
  await app.setState({ devices: [], mdns: 'List of discovered mdns services\nadb-phone1-xyz _adb-tls-connect._tcp. 192.168.0.7:45678',
    connectDevices: { '192.168.0.7:45678': { serial, id: 'phone1', guid: 'phone1-xyz' } } });
  t.after(() => app.run('watch', 'stop', '--json'));
  assert.equal((await app.run('watch', '--background', '--interval', '100', '--json')).code, 0);
  await waitFor(async () => (await app.calls()).some(c => c[0] === 'connect'));
  assert.deepEqual((await app.calls()).find(c => c[0] === 'connect'), ['connect', '192.168.0.7:45678']);
  const output = await app.run('devices', '--json');
  assert.equal(JSON.parse(output.stdout).data[0].alias, 'pixel');
});

test('a known GUID can reconnect a device previously registered through USB', async t => {
  const app = await setup(t, [{ serial: 'usb1', id: 'phone1', guid: 'phone1-xyz' }]);
  await app.run('alias', 'usb1', 'pixel');
  await app.run('metro', 'bind', 'pixel', '--port', '8082');
  await app.setState({ devices: [], mdns: 'adb-phone1-xyz _adb-tls-connect._tcp 192.168.0.9:40000',
    connectDevices: { '192.168.0.9:40000': { serial: '192.168.0.9:40000', id: 'phone1', guid: 'phone1-xyz' } } });
  t.after(() => app.run('watch', 'stop', '--json'));
  assert.equal((await app.run('watch', '--background', '--interval', '100', '--json')).code, 0);
  await waitFor(async () => (await app.state()).devices[0]?.reverse?.['tcp:8081'] === 'tcp:8082');
});

test('a live endpoint records its matching mDNS service when the GUID is unavailable', async t => {
  const app = await setup(t, [{ serial: '192.168.0.7:40000', id: 'phone1' }]);
  const state = await app.state();
  state.mdns = 'adb-phone1-xyz _adb-tls-connect._tcp 192.168.0.7:40000';
  await app.setState(state);
  assert.equal((await app.run('alias', '192.168.0.7:40000', 'pixel', '--json')).code, 0);
  await app.setState({ devices: [], mdns: 'adb-phone1-xyz _adb-tls-connect._tcp 192.168.0.8:45000',
    connectDevices: { '192.168.0.8:45000': { serial: '192.168.0.8:45000', id: 'phone1' } } });
  await app.run('watch', '--background', '--interval', '100', '--json');
  await waitFor(async () => (await app.calls()).some(c => c[0] === 'connect'));
  assert.deepEqual((await app.calls()).find(c => c[0] === 'connect'), ['connect', '192.168.0.8:45000']);
});

test('unknown services and pairing endpoints are never connected', async t => {
  const app = await setup(t, [{ serial: 'usb1', id: 'phone1', guid: 'known' }]);
  await app.run('alias', 'usb1', 'pixel');
  await app.setState({ devices: [], mdns: 'adb-other _adb-tls-connect._tcp 192.168.0.2:12345\nadb-known _adb-tls-pairing._tcp 192.168.0.3:12345' });
  t.after(() => app.run('watch', 'stop', '--json'));
  await app.run('watch', '--background', '--interval', '100', '--json');
  await waitFor(async () => (await app.calls()).some(c => c[0] === 'mdns'));
  assert.equal((await app.calls()).filter(c => c[0] === 'connect').length, 0);
});

test('duplicate emulator identities do not receive a saved AVD alias', async t => {
  const app = await setup(t, [{ serial: 'emulator-5554', avd: 'Same_AVD' }]);
  await app.run('alias', 'emulator-5554', 'emulator');
  await app.setState({ devices: [{ serial: 'emulator-5554', avd: 'Same_AVD' }, { serial: 'emulator-5556', avd: 'Same_AVD' }] });
  const output = await app.run('adb', '--device', 'emulator', '--json', '--', 'install', 'app.apk');
  assert.notEqual(output.code, 0);
  assert.equal((await app.calls()).filter(c => c.includes('install')).length, 0);
});

test('exact emulator transports stay selectable when an AVD is running twice', async t => {
  const app = await setup(t, [{ serial: 'emulator-5554', avd: 'Same_AVD' }]);
  await app.run('alias', 'emulator-5554', 'emulator');
  await app.setState({ devices: [{ serial: 'emulator-5554', avd: 'Same_AVD' }, { serial: 'emulator-5556', avd: 'Same_AVD' }] });
  const command = await app.run('adb', '--device', 'emulator-5554', '--json', '--', 'shell', 'echo', 'hello');
  assert.equal(command.code, 0, command.stdout);
  assert.equal(JSON.parse(command.stdout).data[0].transportSerial, 'emulator-5554');
  const binding = await app.run('metro', 'bind', 'emulator-5556', '--port', '8082', '--json');
  assert.equal(binding.code, 0, binding.stdout);
  assert.equal(JSON.parse(binding.stdout).data.deviceId, 'transport:emulator-5556');
  await app.setState({ devices: [{ serial: 'emulator-5554', avd: 'Same_AVD' }] });
  await app.run('metro', 'repair', '--all', '--json');
  assert.equal((await app.state()).devices[0].reverse?.['tcp:8081'], undefined);
});
