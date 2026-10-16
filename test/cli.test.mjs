import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = new URL('../dist/cli.js', import.meta.url);

test('help describes the device and optional Metro commands', () => {
  const output = execFileSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.match(output, /adbdock devices/);
  assert.match(output, /adbdock adb/);
  assert.match(output, /adbdock metro/);
});

test('unknown commands return a JSON argument error', () => {
  const result = spawnSync(process.execPath, [cli.pathname, 'oops', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.ok, false);
  assert.equal(output.errors[0].code, 'INVALID_ARGUMENT');
});
