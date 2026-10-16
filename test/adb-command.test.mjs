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

test('targets must be explicit and validated before any command is sent', async t => {
  const app = await setup(t);
  for (const targets of [[], ['--device', 'missing'], ['--device', 'usb1', '--device', 'missing']]) {
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
