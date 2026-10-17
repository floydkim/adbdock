import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { setup } from './helpers.mjs';

const exec = promisify(execFile);
const runner = new URL('../scripts/test-devices.mjs', import.meta.url).pathname;

test('device smoke tests preserve existing tunnels and clean up their watcher and config', async t => {
  const app = await setup(t, [{ serial: 'usb1', reverse: { 'tcp:8081': 'tcp:8081' } }, { serial: 'wifi1', id: 'phone2' }]);
  const reportPath = `${app.directory}/report.json`;
  await exec(process.execPath, [runner, '--device', 'usb1', '--device', 'wifi1', '--report', reportPath], { env: app.env, timeout: 30000 });
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.ok, true);
  assert.deepEqual(report.checks.map(c => c.name), ['aliases and commands without Metro', 'shared host port', 'separate host ports', 'watcher repairs missing tunnel', 'server stop and restart', 'external conflict is preserved']);
  assert.equal(report.cleanup.ok, true);
  await assert.rejects(access(report.configHome), { code: 'ENOENT' });
  assert.deepEqual((await app.state()).devices.map(d => d.reverse ?? {}), [{ 'tcp:8081': 'tcp:8081' }, {}]);
});

test('device smoke requires explicit targets before calling ADB', async t => {
  const app = await setup(t);
  await assert.rejects(exec(process.execPath, [runner], { env: app.env }), error => {
    assert.match(error.stderr, /--device/);
    return true;
  });
  assert.deepEqual(await app.calls(), []);
});

test('a failed device probe still removes test tunnels and stops the watcher', async t => {
  const app = await setup(t, [{ serial: 'usb1' }, { serial: 'wifi1', id: 'phone2', probeFail: true }]);
  const reportPath = `${app.directory}/report.json`;
  await assert.rejects(exec(process.execPath, [runner, '--device', 'usb1', '--device', 'wifi1', '--report', reportPath], { env: app.env, timeout: 30000 }));
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(report.cleanup.ok, true);
  assert.deepEqual((await app.state()).devices.map(d => d.reverse ?? {}), [{}, {}]);
});

test('interrupting a device smoke run cleans up its temporary tunnels', async t => {
  const app = await setup(t, [{ serial: 'usb1', probeHang: true }]);
  const reportPath = `${app.directory}/report.json`;
  const child = spawn(process.execPath, [runner, '--device', 'usb1', '--report', reportPath], { env: app.env, stdio: 'ignore' });
  const exited = new Promise(resolve => child.on('exit', resolve));
  t.after(() => child.kill('SIGKILL'));
  let probing = false;
  for (let i = 0; i < 100; i++) {
    if ((await app.calls()).some(c => c.join(' ').includes('toybox nc'))) { probing = true; break; }
    await delay(50);
  }
  assert(probing, 'runner did not reach the device probe');
  child.kill('SIGINT');
  assert.equal(await exited, 1);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(report.cleanup.ok, true);
  assert.deepEqual((await app.state()).devices[0].reverse, {});
});

for (const phase of ['watch', 'bind']) {
  test(`interrupting after ${phase} creates a resource still cleans it up`, async t => {
    const app = await setup(t, [{ serial: 'usb1' }]);
    const reportPath = `${app.directory}/report.json`;
    const marker = `${app.directory}/delayed`;
    const preload = new URL('./fixtures/runner-delay.cjs', import.meta.url).pathname;
    const env = { ...app.env, NODE_OPTIONS: `${app.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(preload)}`,
      FAKE_RUNNER_DELAY: phase, FAKE_RUNNER_MARKER: marker };
    const child = spawn(process.execPath, [runner, '--device', 'usb1', '--report', reportPath], { env, stdio: 'ignore' });
    const exited = new Promise(resolve => child.on('exit', resolve));
    t.after(() => child.kill('SIGKILL'));
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try { await access(marker); ready = true; break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(50);
    }
    assert(ready, 'runner did not reach the resource creation boundary');
    child.kill('SIGINT');
    assert.equal(await exited, 1);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    app.env.ADBDOCK_HOME = report.configHome;
    assert.equal(report.cleanup.ok, true);
    assert.equal(JSON.parse((await app.run('status', '--json')).stdout).watcher, null);
    await assert.rejects(access(report.configHome), { code: 'ENOENT' });
    assert.deepEqual((await app.state()).devices[0].reverse, {});
  });
}
