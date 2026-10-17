import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './helpers.mjs';

const modes = [
  { name: 'ADB', args: ['adb'], command: ['--', 'shell', 'echo', 'scenario-probe'] },
  { name: 'saved alias', args: ['@probe'], command: [] },
];

const scenarios = [
  {
    name: 'an explicit missing target never falls back to the only online device',
    devices: [{ serial: 'usb1' }],
    targets: ['-d', 'missing'],
    code: 3, error: 'DEVICE_NOT_FOUND'
  },
  {
    name: 'an explicit offline target never falls back to another online device',
    devices: [{ serial: 'usb1' }, { serial: 'offline', state: 'offline' }],
    targets: ['-d', 'offline'],
    code: 3, error: 'DEVICE_UNAVAILABLE'
  },
  {
    name: 'all selects only available devices',
    devices: [{ serial: 'usb1' }, { serial: 'usb2' }, { serial: 'offline', state: 'offline' }, { serial: 'locked', state: 'unauthorized' }],
    targets: ['--all'],
    serials: ['usb1', 'usb2']
  },
  {
    name: 'all cannot be combined with a device selector',
    devices: [{ serial: 'usb1' }],
    targets: ['--all', '-d', 'usb1'],
    code: 2, error: 'INVALID_ARGUMENT'
  },
  {
    name: 'alias, serial and ID selectors for one transport execute only once',
    devices: [{ serial: 'usb1' }],
    alias: true,
    targets: ['-d', 'phone', '--device', 'usb1', '-d', 'android:usb1'],
    serials: ['usb1']
  },
  {
    name: 'an exact Wi-Fi serial overrides USB preference',
    devices: [{ serial: 'usb1', id: 'phone1' }, { serial: '192.168.0.7:45000', id: 'phone1' }],
    targets: ['-d', '192.168.0.7:45000'],
    serials: ['192.168.0.7:45000']
  },
  {
    name: 'two emulators with the same AVD name still require selection',
    devices: [{ serial: 'emulator-5554', avd: 'Same_AVD' }, { serial: 'emulator-5556', avd: 'Same_AVD' }],
    targets: [],
    code: 3, error: 'AMBIGUOUS_DEVICE'
  },
];

test('ADB and saved aliases use the same target selection rules', async t => {
  for (const scenario of scenarios) {
    for (const mode of modes) {
      await t.test(`${mode.name}: ${scenario.name}`, async t => {
        const app = await setup(t, scenario.devices);
        assert.equal((await app.run('adb-alias', 'add', 'probe', 'adb shell echo scenario-probe', '--json')).code, 0);
        if (scenario.alias) assert.equal((await app.run('alias', 'usb1', 'phone', '--json')).code, 0);
        const output = await app.run(...mode.args, ...scenario.targets, '--json', ...mode.command);
        const result = JSON.parse(output.stdout);
        assert.equal(output.code, scenario.code ?? 0, output.stdout);
        const calls = (await app.calls()).filter(c => c.includes('scenario-probe'));
        if (scenario.error) {
          assert.equal(result.errors[0].code, scenario.error);
          assert.deepEqual(calls, []);
        } else {
          assert.deepEqual(result.data.map(d => d.transportSerial).sort(), scenario.serials);
          assert.deepEqual(calls.map(c => c[1]).sort(), scenario.serials);
        }
      });
    }
  }
});

test('script arguments after the separator keep option-like and literal values', async t => {
  const app = await setup(t, [{ serial: 'usb1' }]);
  assert.equal((await app.run('adb-alias', 'add', 'arguments', 'adb shell echo "$@"', '--json')).code, 0);
  const values = ['--help', '--json', '-d', 'other', '--all', '--timeout', '0', '--', '', 'a file', 'literal; $(echo injected)'];
  for (const args of [
    ['adb', '--json', '--', 'shell', 'echo', ...values],
    ['@arguments', '--json', '--', ...values],
  ]) {
    const output = await app.run(...args);
    assert.equal(output.code, 0, output.stdout);
    assert.equal(JSON.parse(output.stdout).data.length, 1);
  }
  assert.deepEqual((await app.calls()).filter(c => c[2] === 'shell' && c[3] === 'echo'), [
    ['-s', 'usb1', 'shell', 'echo', ...values], ['-s', 'usb1', 'shell', 'echo', ...values],
  ]);
  const plain = await app.run('@arguments', '--', '--json');
  assert.equal(plain.code, 0, plain.stdout);
  assert.match(plain.stdout, /^\[usb1\] exit=0/);
});

test('invalid command timeout values do not start ADB mutations or saved scripts', async t => {
  const app = await setup(t, [{ serial: 'usb1' }]);
  for (const timeout of ['0', '-1', '1.5', '3600001', 'invalid']) {
    for (const args of [['adb', '--', 'install', 'app.apk'], ['@menu']]) {
      const output = await app.run(args[0], '--timeout', timeout, '--json', ...args.slice(1));
      assert.equal(output.code, 2, `${args[0]} timeout=${timeout}: ${output.stdout}`);
      assert.equal(JSON.parse(output.stdout).errors[0].code, 'INVALID_ARGUMENT');
    }
  }
  assert.deepEqual(await app.calls(), []);
});
