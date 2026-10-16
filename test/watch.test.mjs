import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { cliPath, setup } from './helpers.mjs';

async function waitFor(fn, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(50);
  }
  assert.fail('Timed out waiting for watcher');
}

test('background watch restores a missing tunnel and stop preserves it', async t => {
  const app = await setup(t, [{ serial: 'usb1' }]);
  await app.run('metro', 'bind', 'usb1', '--port', '8082');
  await app.setState({ devices: [{ serial: 'usb1' }] });
  t.after(() => app.run('stop', '--json'));
  const start = await app.run('watch', '--background', '--interval', '100', '--json');
  assert.equal(start.code, 0, start.stdout);
  assert.ok(JSON.parse(start.stdout).data.pid);
  await waitFor(async () => (await app.state()).devices[0].reverse?.['tcp:8081'] === 'tcp:8082');
  const duplicate = await app.run('watch', '--background', '--json');
  assert.equal(duplicate.code, 4);
  assert.equal(JSON.parse(duplicate.stdout).errors[0].code, 'WATCH_RUNNING');
  assert.equal((await app.run('stop', '--json')).code, 0);
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:8082');
});

test('foreground watch recovers after reconnect and exits on SIGINT', async t => {
  const app = await setup(t, [{ serial: 'usb1' }]);
  await app.run('metro', 'bind', 'usb1', '--port', '8082');
  await app.setState({ devices: [] });
  const child = spawn(process.execPath, [cliPath, 'watch', '--interval', '100', '--json'], { env: app.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => { child.kill('SIGINT'); await exited; });
  await waitFor(async () => output.includes('watching'));
  await app.setState({ devices: [{ serial: 'usb1' }] });
  await waitFor(async () => (await app.state()).devices[0].reverse?.['tcp:8081'] === 'tcp:8082');
  child.kill('SIGINT');
  assert.deepEqual(await exited, { code: 0, signal: null });
  assert.equal(JSON.parse(output).data.state, 'watching');
});

test('watch respects mapping changes while running', async t => {
  const app = await setup(t, [{ serial: 'usb1' }]);
  await app.run('metro', 'bind', 'usb1', '--port', '8081');
  t.after(() => app.run('stop', '--json'));
  assert.equal((await app.run('watch', '--background', '--interval', '100', '--json')).code, 0);
  const changed = await app.run('metro', 'bind', 'usb1', '--port', '8083', '--json');
  assert.equal(changed.code, 0, changed.stdout);
  await delay(250);
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:8083');
});

test('watch does not overwrite a conflicting external tunnel', async t => {
  const app = await setup(t, [{ serial: 'usb1' }]);
  await app.run('metro', 'bind', 'usb1', '--port', '8081');
  await app.setState({ devices: [{ serial: 'usb1', reverse: { 'tcp:8081': 'tcp:9999' } }] });
  t.after(() => app.run('stop', '--json'));
  assert.equal((await app.run('watch', '--background', '--interval', '100', '--json')).code, 0);
  await delay(400);
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:9999');
});

test('stop without an active watcher does not signal any process', async t => {
  const app = await setup(t);
  const output = await app.run('stop', '--json');
  assert.equal(output.code, 0);
  assert.equal(JSON.parse(output.stdout).data.state, 'stopped');
});

test('simultaneous watcher starts elect exactly one process', async t => {
  const app = await setup(t, []);
  const outputs = await Promise.all([app.run('watch', '--background', '--json'), app.run('watch', '--background', '--json')]);
  assert.deepEqual(outputs.map(r => r.code).sort(), [0, 4]);
  assert.equal((await app.run('stop', '--json')).code, 0);
});

test('background startup reports a missing adb executable', async t => {
  const app = await setup(t, []);
  app.env.ADBDOCK_ADB = `${app.directory}/missing-adb`;
  const output = await app.run('watch', '--background', '--json');
  assert.equal(output.code, 4);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'ADB_UNAVAILABLE');
});

test('a crashed watcher can restart after its lease expires', async t => {
  const app = await setup(t, []);
  const first = JSON.parse((await app.run('watch', '--background', '--json')).stdout);
  assert.equal(first.ok, true);
  process.kill(first.data.pid, 'SIGKILL');
  await delay(11_000);
  const second = await app.run('watch', '--background', '--json');
  assert.equal(second.code, 0, second.stdout);
  assert.notEqual(JSON.parse(second.stdout).data.pid, first.data.pid);
  assert.equal((await app.run('stop', '--json')).code, 0);
});
