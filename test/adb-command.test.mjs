import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.mjs';

test('commands run on the selected devices and preserve arguments', async t => {
  const app = await setup(t, [{ serial: 'usb1' }, { serial: 'usb2' }, { serial: 'usb3' }]);
  const output = await app.run('adb', '--device', 'usb1', '--device', 'usb3', '--json', '--', 'install', '/tmp/a file.apk');
  assert.equal(output.code, 0, output.stderr);
  const calls = (await app.calls()).filter(c => c.includes('install'));
  assert.deepEqual(calls.map(c => c[1]).sort(), ['usb1', 'usb3']);
  assert.ok(calls.every(c => c.at(-1) === '/tmp/a file.apk'));
});

test('one failed device does not stop another device', async t => {
  const app = await setup(t, [{ serial: 'usb1', fail: true }, { serial: 'usb2' }]);
  const output = await app.run('adb', '--all', '--json', '--', 'shell', 'echo', 'hello');
  assert.equal(output.code, 1);
  const data = JSON.parse(output.stdout);
  assert.equal(data.data.length, 2);
  assert.equal(data.data[0].exitCode, 1);
  assert.equal(data.data[1].exitCode, 0);
});

test('multiple devices and invalid targets are rejected before any command is sent', async t => {
  const app = await setup(t);
  for (const targets of [[], ['--device', 'missing'], ['--device', 'usb1', '--device', 'missing'], ['--all', '--device', 'usb1']]) {
    const output = await app.run('adb', ...targets, '--json', '--', 'install', 'app.apk');
    assert.notEqual(output.code, 0);
  }
  assert.equal((await app.calls()).filter(c => c.includes('install')).length, 0);
});

test('host commands and interactive streams are rejected', async t => {
  const app = await setup(t);
  for (const args of [['kill-server'], ['-s', 'other', 'shell', 'id'], ['logcat'], ['shell'], ['shell', '-t', 'id']]) {
    const output = await app.run('adb', '--all', '--json', '--', ...args);
    assert.equal(output.code, 2, JSON.stringify(args));
  }
});

test('a timed out command reports an uncertain outcome without retrying', async t => {
  const app = await setup(t, [{ serial: 'usb1', hang: true }]);
  const output = await app.run('adb', '--all', '--timeout', '100', '--json', '--', 'shell', 'sleep', '60');
  assert.equal(output.code, 1);
  const data = JSON.parse(output.stdout);
  assert.equal(data.data[0].timedOut, true);
  assert.equal(data.errors[0].code, 'COMMAND_TIMEOUT');
  assert.equal((await app.calls()).filter(c => c.includes('sleep')).length, 1);
});

test('commands writing host files require one device to prevent overwrite', async t => {
  const app = await setup(t);
  for (const command of [['pull', '/sdcard/file', '/tmp/file'], ['bugreport', '/tmp/report.zip']]) {
    const output = await app.run('adb', '--all', '--json', '--', ...command);
    assert.equal(output.code, 2);
  }
  assert.equal((await app.calls()).filter(c => c.includes('pull') || c.includes('bugreport')).length, 0);
});

test('one available device is selected automatically despite offline or unauthorized peers', async t => {
  const app = await setup(t, [
    { serial: 'usb1' }, { serial: 'offline', state: 'offline' }, { serial: 'locked', state: 'unauthorized' },
  ]);
  const adb = await app.run('adb', '--json', '--', 'shell', 'echo', 'auto-selected');
  assert.equal(adb.code, 0, adb.stdout);
  const alias = await app.run('@menu', '--json');
  assert.equal(alias.code, 0, alias.stdout);
  for (const output of [adb, alias]) assert.deepEqual(JSON.parse(output.stdout).data.map(d => d.transportSerial), ['usb1']);
  assert((await app.calls()).some(c => c.join(' ') === '-s usb1 shell input keyevent 82'));
});

test('USB and Wi-Fi transports of one verified phone count as one automatic target', async t => {
  const app = await setup(t, [
    { serial: '192.168.1.7:37000', id: 'phone1' }, { serial: 'usb1', id: 'phone1' },
  ]);
  const adb = await app.run('adb', '--json', '--', 'shell', 'echo', 'auto-selected');
  assert.equal(adb.code, 0, adb.stdout);
  const alias = await app.run('@menu', '--json');
  assert.equal(alias.code, 0, alias.stdout);
  for (const output of [adb, alias]) assert.deepEqual(JSON.parse(output.stdout).data.map(d => d.transportSerial), ['usb1']);
});

test('automatic targeting with no available devices explains connection and authorization', async t => {
  for (const devices of [[], [{ serial: 'usb1', state: 'offline' }], [{ serial: 'usb1', state: 'unauthorized' }]]) {
    const app = await setup(t, devices);
    for (const args of [['adb', '--json', '--', 'shell', 'echo', 'auto-selected'], ['@menu', '--json']]) {
      const output = await app.run(...args);
      assert.equal(output.code, 3, output.stdout);
      const error = JSON.parse(output.stdout).errors[0];
      assert.equal(error.code, 'DEVICE_NOT_FOUND');
      assert.match(error.message, /adbdock devices/);
      assert.match(error.message, /authorization/);
    }
    assert.equal((await app.calls()).some(c => c.includes('auto-selected') || c.includes('keyevent')), false);
  }
});

test('multiple available devices still require explicit targets for ADB and saved aliases', async t => {
  const app = await setup(t);
  for (const args of [['adb', '--json', '--', 'shell', 'echo', 'auto-selected'], ['@menu', '--json']]) {
    const output = await app.run(...args);
    assert.equal(output.code, 3, output.stdout);
    const error = JSON.parse(output.stdout).errors[0];
    assert.equal(error.code, 'AMBIGUOUS_DEVICE');
    assert.match(error.message, /--device.*--all/);
  }
  assert.equal((await app.calls()).some(c => c.includes('auto-selected') || c.includes('keyevent')), false);
});
