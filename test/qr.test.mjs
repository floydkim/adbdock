import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setup, cliPath } from './helpers.mjs';
const preload = new URL('./fixtures/qr-scan-preload.mjs', import.meta.url).pathname;
async function scenario(t, extra = {}) {
  const app = await setup(t, []);
  app.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`;
  await app.setState({ devices: [], pairGuid: 'adb-phone1-xyz',
    mdns: 'studio-other _adb-tls-pairing._tcp 192.168.0.8:37000\nadb-phone1-xyz _adb-tls-connect._tcp 192.168.0.7:45000',
    connectDevices: { '192.168.0.7:45000': { serial: '192.168.0.7:45000', id: 'phone1', guid: 'phone1-xyz' } },
    addresses: { 'phone.local.': ['192.168.0.7'] }, ...extra });
  return app;
}

test('QR scan pairs only this session service and registers the device', async t => {
  const app = await scenario(t);
  const output = await app.run('pair', '--qr', '--alias', 'pixel', '--json');
  assert.equal(output.code, 0, output.stdout);
  assert.equal(JSON.parse(output.stdout).data.connected, true);
  const { qrScan } = await app.state();
  assert.match(qrScan.service, /^studio-adbdock-[a-f0-9]+$/);
  assert.equal((output.stdout + output.stderr).includes(qrScan.password), false);
  assert.deepEqual((await app.calls()).find(c => c[0] === 'pair'), ['pair', '192.168.0.7:37000']);
  const config = await readFile(`${app.env.ADBDOCK_HOME}/config.json`, 'utf8');
  assert.equal(config.includes(qrScan.password), false);
  assert.equal(JSON.parse(config).devices[0].alias, 'pixel');
  assert.match(output.stderr, /[█▀▄]/);
});

test('QR scan can resolve its exact pairing service through Bonjour', { skip: process.platform !== 'darwin' }, async t => {
  const app = await scenario(t, { qrBonjourOnly: true });
  const output = await app.run('pair', '--qr', '--json');
  assert.equal(output.code, 0, output.stdout);
  const { qrScan } = await app.state();
  const calls = (await readFile(`${app.statePath}.bonjour`, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls[0], ['-L', qrScan.service, '_adb-tls-pairing._tcp', 'local']);
});

test('QR pairing times out without pairing to another phone', async t => {
  const app = await scenario(t, { qrIgnore: true });
  const output = await app.run('pair', '--qr', '--timeout', '100', '--json');
  assert.notEqual(output.code, 0);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'PAIR_SCAN_TIMEOUT');
  assert.equal((await app.calls()).some(c => c[0] === 'pair'), false);
});

test('QR pairing refuses conflicting endpoints for the same scan', async t => {
  const app = await scenario(t, { qrAmbiguous: true });
  const output = await app.run('pair', '--qr', '--json');
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'PAIR_AMBIGUOUS');
  assert.equal((await app.calls()).some(c => c[0] === 'pair'), false);
});

test('QR pairing creates fresh service credentials each time', async t => {
  const app = await scenario(t);
  await app.run('pair', '--qr', '--json');
  const first = (await app.state()).qrScan;
  await app.run('pair', '--qr', '--json');
  const second = (await app.state()).qrScan;
  assert.notEqual(first.service, second.service);
  assert.notEqual(first.password, second.password);
});

test('QR discovery cancels on SIGINT before trust is created', async t => {
  const app = await scenario(t, { qrIgnore: true, bonjourHang: true });
  const output = await new Promise(resolve => {
    const child = spawn(process.execPath, [cliPath, 'pair', '--qr', '--json'], { env: app.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => stdout += b);
    child.stderr.on('data', b => { stderr += b; if (stderr.includes('Scan this QR')) child.kill('SIGINT'); });
    child.once('exit', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(output.code, 130);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'PAIR_CANCELLED');
  assert.equal((await app.calls()).some(c => c[0] === 'pair'), false);
});


test('QR pairing failures hide the generated password and suggest a fresh QR', async t => {
  const app = await scenario(t, { pairFail: true });
  const output = await app.run('pair', '--qr', '--json');
  const { qrScan } = await app.state();
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'PAIR_FAILED');
  assert.match(JSON.parse(output.stdout).errors[0].message, /--qr/);
  assert.equal((output.stdout + output.stderr).includes(qrScan.password), false);
});
