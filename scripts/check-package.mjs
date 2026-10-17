#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'adbdock-package-'));
const prefix = path.join(directory, 'prefix');
const executable = path.join(prefix, 'bin', 'adbdock');
const env = { ...process.env, ADBDOCK_HOME: path.join(directory, 'config'),
  ADBDOCK_ADB: fileURLToPath(new URL('../test/fixtures/fake-adb.mjs', import.meta.url)),
  FAKE_ADB_STATE: path.join(directory, 'devices.json') };
async function cli(...args) {
  return JSON.parse((await exec(executable, [...args, '--json'], { env, timeout: 20000 })).stdout);
}
let installed = false;
try {
  const packed = JSON.parse((await exec('npm', ['pack', '--json', '--pack-destination', directory], { cwd: root, timeout: 60000 })).stdout)[0];
  controller.signal.throwIfAborted();
  const names = packed.files.map(file => file.path);
  for (const name of ['package.json', 'README.md', 'LICENSE', 'dist/cli.js', 'dist/help.js', 'dist/pair.js', 'dist/qr.js', 'dist/prompt.js', 'dist/alias.js', 'dist/watch-entry.js']) assert(names.includes(name), `Missing ${name}`);
  assert(names.every(name => ['package.json', 'README.md', 'LICENSE'].includes(name) || /^dist\/[^/]+\.js$/.test(name)), 'Unexpected package files');
  assert(packed.files.find(file => file.path === 'dist/cli.js').mode & 0o111, 'CLI is not executable');
  const tarball = path.join(directory, packed.filename);
  await exec('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', tarball], { timeout: 120000 });
  installed = true;
  controller.signal.throwIfAborted();
  const manifest = JSON.parse(await readFile(path.join(prefix, 'lib/node_modules', packed.name, 'package.json'), 'utf8'));
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.bin.adbdock, 'dist/cli.js');
  assert.equal(manifest.scripts.prepare, undefined, 'Consumers must not run the TypeScript build during installation');
  await writeFile(env.FAKE_ADB_STATE, '{"devices":[]}');
  const help = JSON.parse((await exec(executable, ['--help', '--json'], { env, timeout: 20000 })).stdout);
  assert(help.ok && help.data.includes('adbdock pair'));
  assert((await cli('metro', 'bind', '--help')).data.includes('--device-port'));
  assert.deepEqual((await cli('devices')).data, []);
  assert.deepEqual((await cli('pair', '--list')).data, []);
  const qrScan = await exec(executable, ['pair', '--qr', '--timeout', '1', '--json'], { env, timeout: 20000 }).catch(error => error);
  assert.equal(JSON.parse(qrScan.stdout).errors[0].code, 'PAIR_SCAN_TIMEOUT');
  assert(qrScan.stderr.includes('Scan this QR'), 'Installed QR renderer did not run');
  const watching = await cli('watch', 'start', '--background');
  assert(watching.ok);
  assert.equal((await cli('watch', 'status')).watcher.pid, watching.data.pid);
  controller.signal.throwIfAborted();
  assert.equal((await cli('watch', 'stop')).data.state, 'stopped');
  const oneOff = JSON.parse((await exec('npm', ['exec', '--yes', '--package', tarball, '--', 'adbdock', '--help', '--json'], { env, cwd: directory, timeout: 120000 })).stdout);
  assert(oneOff.ok && oneOff.data.includes('adbdock'));
  const dryRun = JSON.parse((await exec('npm', ['publish', tarball, '--dry-run', '--ignore-scripts', '--json'], { cwd: directory, timeout: 60000 })).stdout);
  assert.equal(dryRun.name, manifest.name);
  controller.signal.throwIfAborted();
  console.log(JSON.stringify({ ok: true, name: packed.name, version: packed.version, files: names,
    bytes: packed.size, integrity: packed.integrity, checks: ['production-only temporary global install', 'installed help, device query, pairing discovery and QR rendering/timeout', 'installed background watcher start/stop', 'npm exec tarball (npx equivalent)', 'publish dry run; nothing published'] }, null, 2));
} finally {
  // Stop only the watcher created with this temporary configuration.
  if (installed) await cli('watch', 'stop');
  await rm(directory, { recursive: true, force: true });
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
