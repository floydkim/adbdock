import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, writeFile, symlink, chmod, access, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setup } from './helpers.mjs';

const exec = promisify(execFile);

async function installation(t) {
  const app = await setup(t, []);
  const prefix = path.join(app.directory, 'global prefix');
  const root = path.join(prefix, 'lib/node_modules/adbdock');
  const bin = path.join(app.directory, 'npm-bin');
  const callsFile = path.join(app.directory, 'npm-calls.jsonl');
  await mkdir(root, { recursive: true });
  await mkdir(bin);
  await cp(new URL('../dist/', import.meta.url), path.join(root, 'dist'), { recursive: true });
  await cp(new URL('../package.json', import.meta.url), path.join(root, 'package.json'));
  await symlink(new URL('../node_modules/', import.meta.url).pathname, path.join(root, 'node_modules'));
  await writeFile(path.join(bin, 'npm'), `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPM_CALLS, JSON.stringify(args)+'\\n');
if(args.join(' ')==='prefix --global') console.log(process.env.FAKE_NPM_PREFIX);
else if(process.env.FAKE_NPM_FAIL) { console.error('simulated npm failure'); process.exitCode=5; }
else if(args[0]==='install') {
 const file=process.env.FAKE_NPM_PACKAGE+'/package.json';
 const pkg=JSON.parse(fs.readFileSync(file,'utf8'));pkg.version='9.8.7';
 fs.writeFileSync(file,JSON.stringify(pkg));
 fs.rmSync(process.env.FAKE_NPM_PACKAGE+'/dist',{recursive:true});
 console.log('npm install progress');
} else if(args[0]==='uninstall') {
 fs.rmSync(process.env.FAKE_NPM_PACKAGE,{recursive:true});console.log('npm uninstall progress');
} else { console.error('unexpected npm arguments');process.exitCode=99; }
`);
  await chmod(path.join(bin, 'npm'), 0o755);
  Object.assign(app.env, { PATH: `${bin}${path.delimiter}${app.env.PATH}`, FAKE_NPM_CALLS: callsFile,
    FAKE_NPM_PREFIX: prefix, FAKE_NPM_PACKAGE: root });
  const config = '{"schemaVersion":1,"devices":[],"bindings":[]}\n';
  await mkdir(app.env.ADBDOCK_HOME, { recursive: true });
  await writeFile(path.join(app.env.ADBDOCK_HOME, 'config.json'), config);
  await writeFile(path.join(app.env.ADBDOCK_HOME, 'watch.log'), 'existing log\n');
  return { app, root, prefix, config,
    async run(...args) {
      try { const r = await exec(process.execPath, [path.join(root, 'dist/cli.js'), ...args], { env: app.env, timeout: 15000 }); return { ...r, code: 0 }; }
      catch (error) { return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code }; }
    },
    async calls() { try { return (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } },
    async checkConfig() {
      assert.equal(await readFile(path.join(app.env.ADBDOCK_HOME, 'config.json'), 'utf8'), config);
      assert.equal(await readFile(path.join(app.env.ADBDOCK_HOME, 'watch.log'), 'utf8'), 'existing log\n');
    },
  };
}

test('upgrade survives replacement of its running files and reports the installed version in JSON', async t => {
  const pkg = await installation(t);
  const output = await pkg.run('upgrade', '--json');
  assert.equal(output.code, 0, output.stderr || output.stdout);
  const result = JSON.parse(output.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.data.version, '9.8.7');
  await assert.rejects(access(path.join(pkg.root, 'dist/cli.js')), { code: 'ENOENT' });
  assert.deepEqual((await pkg.calls())[1], ['install', '--global', '--prefix', await realpath(pkg.prefix), 'adbdock@latest']);
  await pkg.checkConfig();
});

test('uninstall can remove its own package while preserving configuration and logs', async t => {
  const pkg = await installation(t);
  const output = await pkg.run('uninstall', '--json');
  assert.equal(output.code, 0, output.stderr || output.stdout);
  const data = JSON.parse(output.stdout).data;
  assert.equal(data.action, 'uninstall');
  assert.equal(data.configHome, pkg.app.env.ADBDOCK_HOME);
  assert.equal(data.cleanupCommand, `rm -rf -- '${pkg.app.env.ADBDOCK_HOME}'`);
  assert.deepEqual((await pkg.calls())[1], ['uninstall', '--global', '--prefix', await realpath(pkg.prefix), 'adbdock']);
  await assert.rejects(access(pkg.root), { code: 'ENOENT' });
  await pkg.checkConfig();
});

test('source checkout and another npm prefix are rejected before changing packages', async t => {
  const pkg = await installation(t);
  for (const command of ['upgrade', 'uninstall']) {
    const output = await pkg.app.run(command, '--json');
    assert.equal(output.code, 2);
    assert.equal(JSON.parse(output.stdout).errors[0].code, 'GLOBAL_INSTALL_REQUIRED');
  }
  const originalPrefix = pkg.app.env.FAKE_NPM_PREFIX;
  pkg.app.env.FAKE_NPM_PREFIX = pkg.app.directory;
  const output = await pkg.run('upgrade', '--json');
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'GLOBAL_INSTALL_REQUIRED');
  pkg.app.env.FAKE_NPM_PREFIX = originalPrefix;
  assert((await pkg.calls()).every(args => args.join(' ') === 'prefix --global'));
});

test('upgrade and uninstall refuse to change packages while the current watcher is running', async t => {
  const pkg = await installation(t);
  assert.equal((await pkg.app.run('watch', 'start', '--background', '--json')).code, 0);
  for (const command of ['upgrade', 'uninstall']) {
    const output = await pkg.run(command, '--json');
    assert.equal(output.code, 4);
    const error = JSON.parse(output.stdout).errors[0];
    assert.equal(error.code, 'WATCH_RUNNING');
    assert.match(error.message, /adbdock watch stop/);
  }
  assert((await pkg.calls()).every(args => args.join(' ') === 'prefix --global'));
  assert((await pkg.app.run('watch', 'status', '--json')).stdout.includes('watching'));
});

test('npm failure is reported without a success result or configuration changes', async t => {
  const pkg = await installation(t);
  pkg.app.env.FAKE_NPM_FAIL = '1';
  const output = await pkg.run('upgrade', '--json');
  assert.equal(output.code, 1);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'NPM_FAILED');
  assert.match(output.stderr, /simulated npm failure/);
  await pkg.checkConfig();
});

test('installation commands reject extra options and arguments before invoking npm', async t => {
  const pkg = await installation(t);
  for (const args of [['upgrade', '--force'], ['uninstall', 'adbdock']]) {
    const output = await pkg.run(...args, '--json');
    assert.equal(output.code, 2);
    assert.equal(JSON.parse(output.stdout).errors[0].code, 'INVALID_ARGUMENT');
  }
  assert.deepEqual(await pkg.calls(), []);
});


test('npm development links cannot be upgraded or uninstalled as a regular global package', async t => {
  const pkg = await installation(t);
  const source = path.join(pkg.app.directory, 'linked-source');
  await rename(pkg.root, source);
  await symlink(source, pkg.root);
  for (const action of ['upgrade', 'uninstall']) {
    const output = await pkg.run(action, '--json');
    assert.equal(output.code, 2);
    assert.equal(JSON.parse(output.stdout).errors[0].code, 'GLOBAL_INSTALL_REQUIRED');
  }
  assert((await pkg.calls()).every(args => args.join(' ') === 'prefix --global'));
  await access(path.join(source, 'package.json'));
});

test('a missing npm executable produces a clear error', async t => {
  const pkg = await installation(t);
  pkg.app.env.PATH = '/missing/adbdock-npm';
  const output = await pkg.run('upgrade', '--json');
  assert.equal(output.code, 1);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'NPM_UNAVAILABLE');
});

test('uninstall shows an optional cleanup command that safely quotes the configuration path', async t => {
  const pkg = await installation(t);
  const originalHome = pkg.app.env.ADBDOCK_HOME;
  const customHome = path.join(pkg.app.directory, "phone's settings $(echo ignored)");
  await rename(originalHome, customHome);
  pkg.app.env.ADBDOCK_HOME = customHome;
  const output = await pkg.run('uninstall');
  assert.equal(output.code, 0, output.stderr || output.stdout);
  assert(output.stdout.includes('To permanently delete those settings and logs, run:'));
  const command = output.stdout.trim().split('\n').at(-1).trim();
  // Replace rm with printf to check the shell receives one exact path without deleting it.
  const parsed = await exec('/bin/sh', ['-c', command.replace('rm -rf --', "printf '%s' --")]);
  assert.equal(parsed.stdout, `--${customHome}`);
  await pkg.checkConfig();
});

test('uninstall abbreviates the home directory while keeping JSON paths absolute', async t => {
  for (const json of [false, true]) {
    const pkg = await installation(t);
    pkg.app.env.HOME = pkg.app.directory;
    const configHome = path.join(pkg.app.directory, 'Library/Application Support/adbdock');
    await mkdir(path.dirname(configHome), { recursive: true });
    await rename(pkg.app.env.ADBDOCK_HOME, configHome);
    pkg.app.env.ADBDOCK_HOME = configHome;
    const output = await pkg.run('uninstall', ...(json ? ['--json'] : []));
    assert.equal(output.code, 0, output.stderr || output.stdout);
    const command = json ? JSON.parse(output.stdout).data.cleanupCommand : output.stdout.trim().split('\n').at(-1).trim();
    assert.equal(command, "rm -rf -- ~/'Library/Application Support/adbdock'");
    if (json) assert.equal(JSON.parse(output.stdout).data.configHome, configHome);
    else assert(output.stdout.includes('  ~/Library/Application Support/adbdock\n'));
    const parsed = await exec('/bin/sh', ['-c', command.replace('rm -rf --', "printf '%s' --")], { env: pkg.app.env });
    assert.equal(parsed.stdout, `--${configHome}`);
    await pkg.checkConfig();
  }
});
