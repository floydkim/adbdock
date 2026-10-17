import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { setup, terminal, cliPath } from './helpers.mjs';
const tty = { skip: process.platform !== 'darwin' };

test('command aliases include menu, reverse and screenshot without Metro setup', async t => {
  const app = await setup(t, []);
  const output = await app.run('adb-alias', 'list', '--json');
  assert.equal(output.code, 0, output.stdout);
  assert.deepEqual(JSON.parse(output.stdout).data.map(a => a.name), ['menu', 'reverse', 'screenshot']);
  assert.deepEqual(await app.calls(), []);
});

test('saved commands run for selected devices with short and long target options', async t => {
  const app = await setup(t, [{ serial: 'usb1' }, { serial: 'usb2' }, { serial: 'usb3' }]);
  assert.equal((await app.run('adb-alias', 'add', 'model', 'adb shell getprop ro.product.model', '--json')).code, 0);
  const output = await app.run('@model', '-d', 'usb1', '--device', 'usb3', '--json');
  assert.equal(output.code, 0, output.stdout);
  assert.deepEqual((await app.calls()).filter(c => c.includes('ro.product.model')).map(c => c[1]).sort(), ['usb1', 'usb3']);
  assert.equal((await app.run('adb', '-d', 'usb2', '--json', '--', 'shell', 'echo', 'ok')).code, 0);
});

test('overwrites require confirmation or force and deleted defaults stay deleted', async t => {
  const app = await setup(t, []);
  const overwrite = await app.run('adb-alias', 'add', 'menu', 'echo custom', '--json');
  assert.equal(JSON.parse(overwrite.stdout).errors[0].code, 'ALIAS_EXISTS');
  assert.equal((await app.run('adb-alias', 'add', 'menu', 'echo custom', '--force', '--json')).code, 0);
  for (const name of ['menu', 'reverse', 'screenshot']) assert.equal((await app.run('adb-alias', 'remove', name, '--json')).code, 0);
  assert.deepEqual(JSON.parse((await app.run('adb-alias', 'list', '--json')).stdout).data, []);
});

test('a human can reject an overwrite without losing the existing command', tty, async t => {
  const app = await setup(t, []);
  const output = await terminal(app, ['adb-alias', 'add', 'menu', 'echo changed'], [['Overwrite', 'n\n']]);
  assert.match(output.stdout, /keyevent 82/);
  assert.match(output.stdout, /echo changed/);
  assert.match(output.stdout, /cancelled/i);
  const list = JSON.parse((await app.run('adb-alias', 'list', '--json')).stdout).data;
  assert.match(list.find(a => a.name === 'menu').command, /keyevent 82/);
});

test('shell arguments and device values do not become shell syntax', async t => {
  const app = await setup(t, [{ serial: 'usb1', model: 'Phone_1' }]);
  await app.run('adb-alias', 'add', 'argument', 'adb shell echo "$1"; printf "device=%s\\n" "$ADBDOCK_DEVICE"', '--json');
  const argument = 'literal; $(echo injected) "quoted"';
  const output = await app.run('@argument', '-d', 'usb1', '--json', '--', argument);
  assert.equal(output.code, 0, output.stdout);
  assert.deepEqual((await app.calls()).find(c => c.includes('echo')), ['-s', 'usb1', 'shell', 'echo', argument]);
});

test('screenshots from several identical models have unique binary files', async t => {
  const app = await setup(t, [{ serial: 'usb1', model: 'Same' }, { serial: 'usb2', model: 'Same' }]);
  const script = `adb exec-out screencap -p > "${app.directory}/$ADBDOCK_MODEL-$ADBDOCK_RUN_ID.png"`;
  await app.run('adb-alias', 'add', 'capture', script, '--json');
  const output = await app.run('@capture', '--all', '--json');
  assert.equal(output.code, 0, output.stdout);
  const files = (await readdir(app.directory)).filter(f => f.endsWith('.png'));
  assert.equal(files.length, 2);
  for (const file of files) assert.deepEqual(await readFile(`${app.directory}/${file}`), Buffer.from([137,80,78,71,13,10,26,10,0,255,128]));
});

test('reverse parameters apply only to selected devices without saving Metro mappings', async t => {
  const app = await setup(t);
  const output = await app.run('@reverse', '-d', 'usb1', '--json', '--', '8082', '18081');
  assert.equal(output.code, 0, output.stdout);
  assert.deepEqual((await app.calls()).find(c => c.includes('reverse')), ['-s','usb1','reverse','tcp:18081','tcp:8082']);
  assert.deepEqual((await app.state()).devices[0].reverse, { 'tcp:18081': 'tcp:8082' });
});

test('aliases reject ambiguous or invalid targets before any script runs', async t => {
  const app = await setup(t);
  for (const targets of [[], ['-d', 'missing'], ['-d', 'usb1', '-d', 'missing']]) {
    assert.notEqual((await app.run('@menu', ...targets, '--json')).code, 0);
  }
  assert.equal((await app.calls()).some(c => c.includes('keyevent')), false);
});

test('interactive command editor can remove one chosen alias', tty, async t => {
  const app = await setup(t, []);
  await terminal(app, ['adb-alias'], [['Choose an alias number:', '1\n'], ['[e]dit', 'd\n']]);
  const list = JSON.parse((await app.run('adb-alias', 'list', '--json')).stdout).data;
  assert.deepEqual(list.map(a => a.name), ['reverse', 'screenshot']);
});

test('interactive edits show the old command and save the replacement after confirmation', tty, async t => {
  const app = await setup(t, []);
  await terminal(app, ['adb-alias', 'edit', 'menu'], [['New command', 'adb shell echo new\n'], ['Overwrite', 'y\n']]);
  const list = JSON.parse((await app.run('adb-alias', 'list', '--json')).stdout).data;
  assert.equal(list[0].command, 'adb shell echo new');
});

test('an overwrite confirmation cannot overwrite a command changed by another task', tty, async t => {
  const app = await setup(t, []);
  const output = await terminal(app, ['adb-alias', 'add', 'menu', 'echo first'], [['Overwrite', async () => {
    await app.run('adb-alias', 'add', 'menu', 'echo second', '--force', '--json');
    return 'y\n';
  }]]);
  assert.match(output.stdout, /ALIAS_CHANGED/);
  assert.equal(JSON.parse((await app.run('adb-alias', 'list', '--json')).stdout).data[0].command, 'echo second');
});

test('one failed alias target does not stop other devices', async t => {
  const app = await setup(t, [{ serial: 'usb1', fail: true }, { serial: 'usb2' }]);
  const output = await app.run('@menu', '--all', '--json');
  assert.equal(output.code, 1);
  const data = JSON.parse(output.stdout).data;
  assert.deepEqual(data.map(d => d.exitCode), [1, 0]);
});

test('the adb wrapper rejects target overrides and host commands', async t => {
  const app = await setup(t);
  for (const command of ['adb -s other shell echo wrong', 'adb kill-server', 'adb shell']) {
    await app.run('adb-alias', 'add', 'invalid', command, '--force', '--json');
    assert.equal((await app.run('@invalid', '-d', 'usb1', '--json')).code, 1);
  }
  assert.equal((await app.calls()).some(c => c.includes('kill-server') || c.includes('wrong')), false);
});

test('a timed out alias terminates its child processes and is not retried', async t => {
  const app = await setup(t);
  const pidFile = `${app.directory}/child.pid`;
  await app.run('adb-alias', 'add', 'slow', `sleep 60 & child=$!; printf '%s' "$child" > '${pidFile}'; wait`, '--json');
  const output = await app.run('@slow', '-d', 'usb1', '--timeout', '100', '--json');
  assert.equal(output.code, 1, output.stdout);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'COMMAND_TIMEOUT');
  const pid = Number(await readFile(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 20; i++) {
    try { process.kill(pid, 0); } catch { alive = false; break; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(alive, false, `child ${pid} survived timeout`);
});

test('an invalid command registry is not overwritten by another setting', async t => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const app = await setup(t);
  await mkdir(app.env.ADBDOCK_HOME, { recursive: true });
  const config = `${app.env.ADBDOCK_HOME}/config.json`;
  const text = JSON.stringify({ schemaVersion:1, devices:[], bindings:[], commandAliases:{ bad:42 } });
  await writeFile(config, text);
  const output = await app.run('alias', 'usb1', 'phone', '--json');
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'CONFIG_ERROR');
  assert.equal(await readFile(config, 'utf8'), text);
});

test('an exited shell with a surviving child is still reported as timed out', async t => {
  const app = await setup(t);
  await app.run('adb-alias', 'add', 'background', 'sleep 60 & exit 0', '--json');
  const output = await app.run('@background', '-d', 'usb1', '--timeout', '100', '--json');
  assert.equal(output.code, 1, output.stdout);
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'COMMAND_TIMEOUT');
});


test('Ctrl+C cancels all owned command groups and leaves no child jobs', async t => {
  const app = await setup(t, [{ serial:'usb1' }, { serial:'usb2' }]);
  const script = `sleep 60 & child=$!; printf '%s' "$child" > "${app.directory}/$ADBDOCK_DEVICE.pid"; wait`;
  await app.run('adb-alias', 'add', 'waiting', script, '--json');
  const child = spawn(process.execPath, [cliPath, '@waiting', '--all', '--json'], { env:app.env, stdio:['ignore','pipe','pipe'] });
  let stdout = '';
  child.stdout.on('data', data => stdout += data);
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(() => child.kill('SIGKILL'));
  let files = [];
  for (let i = 0; i < 200; i++) {
    files = (await readdir(app.directory)).filter(f => f.endsWith('.pid'));
    if (files.length === 2) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(files.length,2);
  child.kill('SIGINT');
  assert.equal(await exited, 130);
  assert(JSON.parse(stdout).data.every(d => d.cancelled));
  for (const file of files) {
    const pid = Number(await readFile(`${app.directory}/${file}`,'utf8'));
    let alive=true;
    for (let i=0;i<20;i++) {
      try { process.kill(pid,0); } catch { alive=false;break; }
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(alive,false,`child ${pid} survived cancellation`);
  }
});

test('reverse without arguments uses each device mapping and falls back to 8081', async t => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const app = await setup(t, [{ serial: 'usb1' }, { serial: 'usb2' }, { serial: 'usb3' }]);
  await app.setState({ ...(await app.state()), recordOnlyReverse: true });
  const home = app.env.ADBDOCK_HOME;
  await mkdir(home, { recursive: true });
  const config = { schemaVersion: 1, devices: [], bindings: [
    { deviceId: 'android:usb1', devicePort: 8081, metroPort: 8082 },
    { deviceId: 'android:usb1', devicePort: 18081, metroPort: 8083 },
    { deviceId: 'android:usb2', devicePort: 18082, metroPort: 8084 },
  ] };
  await writeFile(`${home}/config.json`, JSON.stringify(config));
  const output = await app.run('@reverse', '--all', '--json');
  assert.equal(output.code, 0, output.stdout);
  const calls = (await app.calls()).filter(c => c.includes('reverse')).map(c => c.join(' ')).sort();
  assert.deepEqual(calls, [
    '-s usb1 reverse tcp:18081 tcp:8083', '-s usb1 reverse tcp:8081 tcp:8082',
    '-s usb2 reverse tcp:18082 tcp:8084', '-s usb3 reverse tcp:8081 tcp:8081',
  ]);
  const explicit = await app.run('@reverse', '-d', 'usb1', '--json', '--', '9090');
  assert.equal(explicit.code, 0, explicit.stdout);
  assert.deepEqual((await app.calls()).at(-1), ['-s', 'usb1', 'reverse', 'tcp:8081', 'tcp:9090']);
  assert.deepEqual(JSON.parse(await readFile(`${home}/config.json`, 'utf8')), config);
});


test('default screenshot selects a display so foldable warnings do not corrupt PNGs', async t => {
  const app = await setup(t, [{ serial: 'usb1', displays: ['4630946784334733698', '4630946183746106243'] }]);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const output = await promisify(execFile)(process.execPath, [cliPath, '@screenshot', '-d', 'usb1', '--json'], {
    env: app.env, cwd: app.directory, timeout: 15000,
  });
  assert.equal(JSON.parse(output.stdout).ok, true);
  const files = (await readdir(app.directory)).filter(f => f.endsWith('.png'));
  assert.equal(files.length, 1);
  assert.deepEqual(await readFile(`${app.directory}/${files[0]}`), Buffer.from([137,80,78,71,13,10,26,10,0,255,128]));
  assert.deepEqual((await app.calls()).find(c => c.includes('screencap')), ['-s', 'usb1', 'exec-out', 'screencap', '-p', '-d', '4630946784334733698']);
});

test('command alias previews fit the terminal while JSON keeps complete scripts', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const app = await setup(t, []);
  const name = 'long'.repeat(16);
  const command = 'echo first line\n' + 'echo 한글 메시지; '.repeat(30);
  await app.run('adb-alias', 'add', name, command, '--json');
  for (const columns of [40, 80]) {
    const source = `process.stdout.columns = ${columns}; process.argv = ${JSON.stringify([process.execPath, cliPath, 'adb-alias', 'list'])}; await import(${JSON.stringify(cliPath)});`;
    const output = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source], { env: app.env });
    const lines = output.stdout.trimEnd().split('\n');
    assert.equal(lines.length, 6);
    const displayWidth = line => [...line].reduce((total, char) => total + (/[가-힣]/u.test(char) ? 2 : 1), 0);
    assert(lines.every(line => displayWidth(line) <= columns), output.stdout);
    assert.match(output.stdout, /…/);
  }
  const listed = JSON.parse((await app.run('adb-alias', 'list', '--json')).stdout).data;
  assert.equal(listed.find(entry => entry.name === name).command, command);
});

test('interactive alias selection shows the full multiline command before choosing an action', tty, async t => {
  const app = await setup(t, []);
  const listed = JSON.parse((await app.run('adb-alias', 'list', '--json')).stdout).data;
  const command = listed.find(entry => entry.name === 'screenshot').command;
  const output = await terminal(app, ['adb-alias'], [['Choose an alias number:', '3\n'], ['[e]dit', 'q\n']]);
  const [preview, detail] = output.stdout.replaceAll('\r', '').split('Choose an alias number:');
  assert(preview.trimEnd().split('\n').every(line => line.length <= 80), preview);
  assert(detail.includes(command), detail);
  assert.equal(JSON.parse((await app.run('adb-alias', 'list', '--json')).stdout).data[2].command, command);
});
