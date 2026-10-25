import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const cli = new URL('../dist/cli.js', import.meta.url);

test('help describes the device and optional Metro commands', () => {
  const output = execFileSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.match(output, /adbdock devices/);
  assert.match(output, /adbdock adb/);
  assert.match(output, /adbdock metro/);
});

test('version flags report the package version without accessing ADB or configuration', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const env = { ...process.env, ADBDOCK_ADB: '/missing/adbdock-version-adb', ADBDOCK_HOME: '/missing/adbdock-version-config' };
  for (const flag of ['--version', '-v']) {
    const plain = spawnSync(process.execPath, [cli.pathname, flag], { encoding: 'utf8', env });
    assert.equal(plain.status, 0, plain.stdout);
    assert.equal(plain.stdout, `${version}\n`);
    assert.equal(plain.stderr, '');
    const json = spawnSync(process.execPath, [cli.pathname, flag, '--json'], { encoding: 'utf8', env });
    assert.equal(json.status, 0, json.stdout);
    assert.deepEqual(JSON.parse(json.stdout), { schemaVersion: 1, ok: true, data: version, errors: [] });
  }
});

test('unknown commands return a JSON argument error', () => {
  const result = spawnSync(process.execPath, [cli.pathname, 'oops', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.ok, false);
  assert.equal(output.errors[0].code, 'INVALID_ARGUMENT');
});

test('command help explains options and notation without accessing devices or config', () => {
  const commands = ['upgrade', 'uninstall', 'devices', 'alias', 'pair', 'adb', 'adb-alias', 'adb-alias add', 'adb-alias list', 'adb-alias add-defaults', 'adb-alias edit', 'adb-alias remove', '@command', 'metro', 'metro bind', 'metro unbind', 'metro repair', 'status', 'watch', 'watch start', 'watch stop', 'watch status'];
  for (const command of commands) {
    const output = spawnSync(process.execPath, [cli.pathname, ...command.split(' '), '--help', '--json'], {
      encoding: 'utf8', env: { ...process.env, ADBDOCK_ADB: '/missing/adbdock-help-adb', ADBDOCK_HOME: '/missing/adbdock-help-config' },
    });
    assert.equal(output.status, 0, `${command}: ${output.stdout}`);
    const help = JSON.parse(output.stdout);
    assert.equal(help.ok, true);
    assert.match(help.data, new RegExp(`adbdock ${command.startsWith('@') ? '@<name>' : command}`));
    assert.match(help.data, /Examples:/);
    assert.match(help.data, /<value>.*required/);
    assert.match(help.data, /\[part\].*optional/);
  }
});

test('short help and the Metro overview work without arguments', () => {
  const short = spawnSync(process.execPath, [cli.pathname, 'pair', '-h'], { encoding: 'utf8' });
  assert.equal(short.status, 0);
  assert.match(short.stdout, /--qr/);
  const metro = spawnSync(process.execPath, [cli.pathname, 'metro'], { encoding: 'utf8' });
  assert.equal(metro.status, 0);
  assert.match(metro.stdout, /bind/);
  assert.match(metro.stdout, /repair/);
});

test('help for an unknown command fails rather than showing unrelated instructions', () => {
  const output = spawnSync(process.execPath, [cli.pathname, 'metro', 'missing', '--help', '--json'], { encoding: 'utf8' });
  assert.equal(output.status, 2);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'INVALID_ARGUMENT');
});

test('help and version flags after the ADB separator are forwarded to the selected device', async t => {
  const { setup } = await import('./helpers.mjs');
  const app = await setup(t);
  for (const flag of ['--help', '--version', '-v']) {
    const output = await app.run('adb', '--device', 'usb1', '--json', '--', 'shell', 'example', flag);
    assert.equal(output.code, 0, output.stdout);
    assert((await app.calls()).some(args => args.join(' ') === `-s usb1 shell example ${flag}`));
  }
});
