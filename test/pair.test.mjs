import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setup, cliPath, terminal } from './helpers.mjs';

const pairing = '192.168.0.7:37000';
const connection = '192.168.0.7:45000';
const guid = 'adb-phone1-xyz';
const mdns = `${guid} _adb-tls-pairing._tcp ${pairing}\n${guid} _adb-tls-connect._tcp ${connection}`;
async function input(app, args, code = '123456\n') {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliPath, ...args], { env: app.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b);
    child.stderr.on('data', b => stderr += b);
    child.once('exit', status => resolve({ code: status, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(code);
  });
}
async function scenario(t, extra = {}) {
  const app = await setup(t, []);
  await app.setState({ devices: [], mdns, pairGuid: guid,
    connectDevices: { [connection]: { serial: connection, id: 'phone1', guid: 'phone1-xyz' } }, ...extra });
  return app;
}

test('pair lists only valid code-pairing services without changing devices', async t => {
  const app = await scenario(t, { mdns: `${mdns}\nstudio-qr _adb-tls-pairing._tcp 192.168.0.8:40000\nadb-bad _adb-tls-pairing._tcp 192.168.0.8:0` });
  const output = await app.run('pair', '--list', '--json');
  assert.equal(output.code, 0, output.stdout);
  assert.deepEqual(JSON.parse(output.stdout).data, [{ name: guid, endpoint: pairing }]);
  assert.equal((await app.calls()).some(c => ['pair', 'connect'].includes(c[0])), false);
});

test('pair connects to the separate TLS port and saves an alias without saving the code', async t => {
  const app = await scenario(t);
  const output = await input(app, ['pair', pairing, '--alias', 'pixel', '--code-stdin', '--json']);
  assert.equal(output.code, 0, output.stdout);
  const data = JSON.parse(output.stdout).data;
  assert.equal(data.paired, true);
  assert.equal(data.connected, true);
  assert.equal(data.device.alias, 'pixel');
  assert.deepEqual((await app.calls()).find(c => c[0] === 'pair'), ['pair', pairing]);
  assert.deepEqual((await app.calls()).find(c => c[0] === 'connect'), ['connect', connection]);
  const config = await readFile(`${app.env.ADBDOCK_HOME}/config.json`, 'utf8');
  assert.equal(config.includes('123456'), false);
  assert.equal((output.stdout + output.stderr).includes('123456'), false);
  assert.deepEqual(JSON.parse(config).devices[0].wirelessServices, [guid]);
  assert.deepEqual(JSON.parse(config).bindings, []);
});

test('pair accepts an explicit connection endpoint when mDNS is unavailable', async t => {
  const app = await scenario(t, { mdns: '' });
  const output = await input(app, ['pair', pairing, '--connect', connection, '--code-stdin', '--json']);
  assert.equal(output.code, 0, output.stdout);
  assert.equal(JSON.parse(output.stdout).data.device.id, 'android:phone1');
});

test('pair redacts ADB errors containing the entered code', async t => {
  const app = await scenario(t, { pairFail: true });
  const output = await input(app, ['pair', pairing, '--code-stdin', '--json']);
  assert.notEqual(output.code, 0);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'PAIR_FAILED');
  assert.equal((output.stdout + output.stderr).includes('123456'), false);
  assert.equal((await app.calls()).some(c => c[0] === 'connect'), false);
});

test('pair does not mistake an existing USB device for the new wireless connection', async t => {
  const app = await scenario(t, { devices: [{ serial: 'usb1', id: 'phone1', guid: 'phone1-xyz' }], mdns: '' });
  const output = await input(app, ['pair', pairing, '--code-stdin', '--json']);
  assert.notEqual(output.code, 0);
  assert.equal(JSON.parse(output.stdout).data.paired, true);
  assert.equal(JSON.parse(output.stdout).data.connected, false);
});

test('pair rejects a connection whose GUID differs from the paired device', async t => {
  const app = await scenario(t, { connectDevices: { [connection]: { serial: connection, id: 'other', guid: 'other-guid' } } });
  const output = await input(app, ['pair', pairing, '--connect', connection, '--code-stdin', '--json']);
  assert.notEqual(output.code, 0);
  assert.equal(JSON.parse(output.stdout).data.paired, true);
  await assert.rejects(readFile(`${app.env.ADBDOCK_HOME}/config.json`), { code: 'ENOENT' });
});

test('pair requires explicit stdin mode and a pairing endpoint in noninteractive use', async t => {
  const app = await scenario(t);
  for (const args of [['pair', pairing, '--json'], ['pair', '--code-stdin', '--json']]) {
    const output = await input(app, args);
    assert.equal(JSON.parse(output.stdout).errors[0].code, 'INVALID_ARGUMENT');
  }
  assert.equal((await app.calls()).some(c => c[0] === 'pair'), false);
});

test('pair rejects invalid code, addresses and aliases before invoking adb pair', async t => {
  const app = await scenario(t);
  for (const [endpoint, alias, code] of [[pairing, 'pixel', '123\n'], ['192.168.0.7:0', 'pixel', '123456\n'], [pairing, 'invalid alias', '123456\n']]) {
    const output = await input(app, ['pair', endpoint, '--alias', alias, '--code-stdin', '--json'], code);
    assert.equal(JSON.parse(output.stdout).errors[0].code, 'INVALID_ARGUMENT');
  }
  assert.equal((await app.calls()).some(c => c[0] === 'pair'), false);
});

test('pair reports completed pairing and connection when alias registration conflicts', async t => {
  const app = await scenario(t, { devices: [{ serial: 'usb2', id: 'other' }] });
  await app.run('alias', 'usb2', 'pixel');
  const output = await input(app, ['pair', pairing, '--alias', 'pixel', '--code-stdin', '--json']);
  const result = JSON.parse(output.stdout);
  assert.notEqual(output.code, 0);
  assert.equal(result.data.paired, true);
  assert.equal(result.data.connected, true);
  assert.equal(result.errors[0].code, 'ALIAS_EXISTS');
  const config = JSON.parse(await readFile(`${app.env.ADBDOCK_HOME}/config.json`, 'utf8'));
  assert.equal(config.devices.length, 1);
  assert.equal(config.devices[0].id, 'android:other');
});

test('pair uses the already connected paired Wi-Fi device without connecting again', async t => {
  const app = await scenario(t, { autoConnect: { serial: `${guid}._adb-tls-connect._tcp`, id: 'phone1', guid: 'phone1-xyz' } });
  const output = await input(app, ['pair', pairing, '--code-stdin', '--json']);
  assert.equal(output.code, 0, output.stdout);
  assert.equal((await app.calls()).some(c => c[0] === 'connect'), false);
});

test('pair refuses unrelated or ambiguous connection services', async t => {
  for (const discovery of ['adb-other _adb-tls-connect._tcp 192.168.0.8:45000', `${mdns}\n${guid} _adb-tls-connect._tcp 192.168.0.7:45001`]) {
    const app = await scenario(t, { mdns: discovery });
    const output = await input(app, ['pair', pairing, '--code-stdin', '--json']);
    assert.equal(JSON.parse(output.stdout).data.connected, false);
    assert.equal((await app.calls()).some(c => c[0] === 'connect'), false);
  }
});

test('interactive pair selects a discovered device and hides the typed code', { skip: process.platform !== 'darwin' }, async t => {
  const app = await scenario(t, { mdns: `adb-other _adb-tls-pairing._tcp 192.168.0.8:37000\n${mdns}` });
  const output = await terminal(app, ['pair', '--alias', 'pixel'], [['Choose a device number:', '2\n'], ['Pairing code for', '123456\n']]);
  assert.match(output.stdout, /"connected": true/, JSON.stringify(output));
  assert.equal(output.stdout.includes('123456'), false);
  assert.deepEqual((await app.calls()).find(c => c[0] === 'pair'), ['pair', pairing]);
});

test('interactive pair cancels before pairing when Ctrl+C is pressed', { skip: process.platform !== 'darwin' }, async t => {
  const app = await scenario(t);
  const output = await terminal(app, ['pair', pairing], [['Pairing code for', '\x03']]);
  assert.match(output.stdout, /PAIR_CANCELLED/, JSON.stringify(output));
  assert.equal((await app.calls()).some(c => c[0] === 'pair'), false);
});

test('pair uses Bonjour to verify a new device when ADB discovery and GUID property are empty', { skip: process.platform !== 'darwin' }, async t => {
  const app = await scenario(t, { mdns: '',
    bonjour: { [guid]: [{ host: 'phone.local.', port: 45000 }] }, addresses: { 'phone.local.': ['192.168.0.7'] },
    connectDevices: { [connection]: { serial: connection, id: 'phone1' } } });
  const output = await input(app, ['pair', pairing, '--alias', 'pixel', '--code-stdin', '--json']);
  assert.equal(output.code, 0, output.stdout);
  assert.deepEqual(JSON.parse(output.stdout).data.device.wirelessServices, [guid]);
});

test('pair recognizes previously verified hardware when discovery and live GUID are unavailable', async t => {
  const app = await scenario(t, { devices: [{ serial: connection, id: 'phone1', guid: 'phone1-xyz' }] });
  await app.run('alias', connection, 'pixel');
  const state = await app.state();
  state.devices[0].guid = ''; state.mdns = '';
  await app.setState(state);
  const output = await input(app, ['pair', pairing, '--alias', 'pixel', '--code-stdin', '--json']);
  assert.equal(output.code, 0, output.stdout);
  assert.equal((await app.calls()).some(c => c[0] === 'connect'), false);
});

test('pair preserves completed trust when service discovery errors', async t => {
  const app = await scenario(t, { mdnsFail: true });
  const output = await input(app, ['pair', pairing, '--code-stdin', '--json']);
  const result = JSON.parse(output.stdout);
  assert.equal(result.data.paired, true);
  assert.equal(result.data.connected, false);
  assert.equal(result.errors[0].code, 'PAIR_CONNECTION_PENDING');
});

test('pair still connects to the explicit endpoint when mDNS errors', async t => {
  const app = await scenario(t, { mdnsFail: true });
  const output = await input(app, ['pair', pairing, '--connect', connection, '--code-stdin', '--json']);
  assert.equal(output.code, 0, output.stdout);
  assert.equal(JSON.parse(output.stdout).data.connected, true);
});

test('pair verifies a successful connection even when discovery and connect exceed the polling window', { skip: process.platform !== 'darwin' }, async t => {
  const app = await scenario(t, { mdns: '', bonjourHang: true, connectDelay: 2100,
    bonjour: { [guid]: [{ host: 'phone.local.', port: 45000 }] }, addresses: { 'phone.local.': ['192.168.0.7'] } });
  const output = await input(app, ['pair', pairing, '--code-stdin', '--json']);
  assert.equal(output.code, 0, output.stdout);
  assert.equal(JSON.parse(output.stdout).data.connected, true);
});
