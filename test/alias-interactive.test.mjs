import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setup, terminal } from './helpers.mjs';
const tty = { skip: process.platform !== 'darwin' };

test('alias lists devices and saves a name for the selected phone', tty, async t => {
  const app = await setup(t, [{ serial: 'usb1', model: 'Galaxy_Flip' }, { serial: 'emulator-5554', avd: 'Pixel' }]);
  const output = await terminal(app, ['alias'], [['Choose a device number:', '1\n'], ['Alias', 'phone\n']]);
  assert.match(output.stdout, /Galaxy Flip/);
  assert.match(output.stdout, /usb/);
  const config = JSON.parse(await readFile(`${app.env.ADBDOCK_HOME}/config.json`, 'utf8'));
  assert.equal(config.devices[0].alias, 'phone');
});

test('alias changes the selected device current name without changing its bindings', tty, async t => {
  const app = await setup(t);
  await app.run('alias', 'usb1', 'old');
  await app.run('metro', 'bind', 'old', '--port', '8082');
  const before = JSON.parse(await readFile(`${app.env.ADBDOCK_HOME}/config.json`, 'utf8'));
  const output = await terminal(app, ['alias'], [['Choose a device number:', '1\n'], ['Alias', 'new\n']]);
  assert.match(output.stdout, /old/);
  const after = JSON.parse(await readFile(`${app.env.ADBDOCK_HOME}/config.json`, 'utf8'));
  assert.equal(after.devices[0].alias, 'new');
  assert.deepEqual(after.bindings, before.bindings);
});

test('alias can rename a remembered offline device', tty, async t => {
  const app = await setup(t);
  await app.run('alias', 'usb1', 'old');
  await app.setState({ devices: [] });
  const output = await terminal(app, ['alias'], [['Choose a device number:', '1\n'], ['Alias', 'new\n']]);
  assert.match(output.stdout, /offline/);
  assert.match(output.stdout, /"alias": "new"/);
});

test('alias cancels without saving when Ctrl+C is pressed', tty, async t => {
  const app = await setup(t);
  const output = await terminal(app, ['alias'], [['Choose a device number:', '\x03']]);
  assert.match(output.stdout, /CANCELLED/);
  await assert.rejects(readFile(`${app.env.ADBDOCK_HOME}/config.json`), { code: 'ENOENT' });
});

test('alias reports conflicts without replacing another device name', tty, async t => {
  const app = await setup(t);
  await app.run('alias', 'usb1', 'phone');
  const output = await terminal(app, ['alias', 'wifi1'], [['Alias', 'phone\n']]);
  assert.match(output.stdout, /ALIAS_EXISTS/);
  const config = JSON.parse(await readFile(`${app.env.ADBDOCK_HOME}/config.json`, 'utf8'));
  assert.equal(config.devices.length, 1);
});


test('alias rejects invalid selection without writing configuration', tty, async t => {
  const app = await setup(t);
  const output = await terminal(app, ['alias'], [['Choose a device number:', '99\n']]);
  assert.match(output.stdout, /INVALID_ARGUMENT/);
  await assert.rejects(readFile(`${app.env.ADBDOCK_HOME}/config.json`), { code: 'ENOENT' });
});

test('alias missing arguments fail in noninteractive mode', async t => {
  const app = await setup(t);
  const output = await app.run('alias', '--json');
  assert.equal(output.code, 2);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'INVALID_ARGUMENT');
});


test('alias keeps the chosen identity when another task reassigns the old name during input', tty, async t => {
  const app = await setup(t);
  await app.run('alias', 'usb1', 'old');
  await terminal(app, ['alias', 'old'], [['Alias', async () => {
    await app.run('alias', 'usb1', 'moved');
    await app.run('alias', 'wifi1', 'old');
    return 'new\n';
  }]]);
  const config = JSON.parse(await readFile(`${app.env.ADBDOCK_HOME}/config.json`, 'utf8'));
  assert.equal(config.devices.find(d => d.id === 'android:usb1').alias, 'new');
  assert.equal(config.devices.find(d => d.id === 'android:phone2').alias, 'old');
});
