import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.mjs';

test('devices work without Metro configuration', async t => {
  const app = await setup(t, [{ serial: 'usb1' }, { serial: 'usb2', state: 'unauthorized' }, { serial: 'emulator-5554', avd: 'Test_AVD' }]);
  const output = await app.run('devices', '--json');
  assert.equal(output.code, 0, output.stderr);
  const devices = JSON.parse(output.stdout).data;
  assert.equal(devices.length, 3);
  assert.equal(devices[1].state, 'unauthorized');
  assert.equal(devices[2].kind, 'emulator');
});

test('aliases persist across processes', async t => {
  const app = await setup(t);
  assert.equal((await app.run('alias', 'usb1', 'pixel', '--json')).code, 0);
  const output = await app.run('devices', '--json');
  assert.equal(JSON.parse(output.stdout).data[0].alias, 'pixel');
  const command = await app.run('adb', '--device', 'pixel', '--json', '--', 'shell', 'getprop', 'ro.product.model');
  assert.equal(command.code, 0);
  assert.equal(JSON.parse(command.stdout).data[0].transportSerial, 'usb1');
});

test('duplicate aliases are rejected', async t => {
  const app = await setup(t);
  await app.run('alias', 'usb1', 'pixel');
  const output = await app.run('alias', 'wifi1', 'pixel', '--json');
  assert.equal(output.code, 2);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'ALIAS_EXISTS');
});

test('USB and Wi-Fi transports with the same hardware identity are grouped', async t => {
  const app = await setup(t, [{ serial: 'usb1', id: 'hardware1' }, { serial: '192.168.1.2:5555', id: 'hardware1' }]);
  const output = await app.run('devices', '--json');
  const devices = JSON.parse(output.stdout).data;
  assert.equal(devices.length, 1);
  assert.equal(devices[0].serial, 'usb1');
  assert.equal(devices[0].transports.length, 2);
  await app.run('adb', '--all', '--', 'shell', 'echo', 'hello');
  assert.equal((await app.calls()).filter(c => c.includes('hello')).length, 1);
});

test('a damaged config is not overwritten', async t => {
  const app = await setup(t);
  await app.run('alias', 'usb1', 'pixel');
  const { writeFile, readFile } = await import('node:fs/promises');
  const path = `${app.env.ADBDOCK_HOME}/config.json`;
  await writeFile(path, '{invalid');
  assert.equal((await app.run('alias', 'usb1', 'other', '--json')).code, 1);
  assert.equal(await readFile(path, 'utf8'), '{invalid');
});

test('a remembered endpoint is not trusted when live identity cannot be verified', async t => {
  const app = await setup(t, [{ serial: '192.168.0.7:5555', id: 'phone1' }]);
  await app.run('alias', '192.168.0.7:5555', 'pixel');
  await app.setState({ devices: [{ serial: '192.168.0.7:5555', identityFail: true }] });
  const output = await app.run('adb', '--device', 'pixel', '--json', '--', 'install', 'app.apk');
  assert.notEqual(output.code, 0);
  assert.equal((await app.calls()).filter(c => c.includes('install')).length, 0);
});

test('concurrent alias writes preserve both devices', async t => {
  const app = await setup(t);
  const outputs = await Promise.all([app.run('alias', 'usb1', 'pixel', '--json'), app.run('alias', 'wifi1', 'galaxy', '--json')]);
  assert.ok(outputs.every(r => r.code === 0), JSON.stringify(outputs));
  const output = JSON.parse((await app.run('devices', '--json')).stdout);
  assert.deepEqual(output.data.map(d => d.alias).sort(), ['galaxy', 'pixel']);
});
