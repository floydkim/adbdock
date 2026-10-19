import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { setup } from './helpers.mjs';

test('each device can bind to a different Metro port', async t => {
  const app = await setup(t);
  assert.equal((await app.run('metro', 'bind', 'usb1', '--port', '8081', '--json')).code, 0);
  assert.equal((await app.run('metro', 'bind', 'wifi1', '--port', '8082', '--json')).code, 0);
  const state = await app.state();
  assert.equal(state.devices[0].reverse['tcp:8081'], 'tcp:8081');
  assert.equal(state.devices[1].reverse['tcp:8081'], 'tcp:8082');
});

test('bindings survive a disconnected device and repair restores the tunnel', async t => {
  const app = await setup(t);
  await app.run('alias', 'usb1', 'pixel');
  await app.setState({ devices: [] });
  const bind = await app.run('metro', 'bind', 'pixel', '--port', '8082', '--json');
  assert.equal(bind.code, 1);
  assert.equal(JSON.parse(bind.stdout).errors[0].code, 'DEVICE_UNAVAILABLE');
  await app.setState({ devices: [{ serial: 'usb1' }] });
  assert.equal((await app.run('metro', 'repair', '--device', 'pixel', '--json')).code, 0);
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:8082');
});

test('external tunnels are preserved unless replacement is explicit', async t => {
  const app = await setup(t, [{ serial: 'usb1', reverse: { 'tcp:8081': 'tcp:9999' } }]);
  const bind = await app.run('metro', 'bind', 'usb1', '--port', '8082', '--json');
  assert.equal(bind.code, 1);
  assert.equal(JSON.parse(bind.stdout).errors[0].code, 'REVERSE_CONFLICT');
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:9999');
  assert.equal((await app.run('metro', 'bind', 'usb1', '--port', '8082', '--replace', '--json')).code, 0);
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:8082');
});

test('changing a managed mapping updates its port', async t => {
  const app = await setup(t);
  await app.run('metro', 'bind', 'usb1', '--port', '8081');
  assert.equal((await app.run('metro', 'bind', 'usb1', '--port', '8083', '--json')).code, 0);
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:8083');
});

test('unbind does not delete a tunnel that another tool changed', async t => {
  const app = await setup(t);
  await app.run('metro', 'bind', 'usb1', '--port', '8081');
  const state = await app.state();
  state.devices[0].reverse['tcp:8081'] = 'tcp:9999';
  await app.setState(state);
  const output = await app.run('metro', 'unbind', 'usb1', '--json');
  assert.equal(output.code, 1);
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:9999');
  assert.equal(JSON.parse(output.stdout).errors[0].code, 'REVERSE_CONFLICT');
});

test('multiple mappings on one device require an explicit unbind port', async t => {
  const app = await setup(t);
  await app.run('metro', 'bind', 'usb1', '--port', '8081');
  await app.run('metro', 'bind', 'usb1', '--port', '8082', '--device-port', '8082');
  assert.equal((await app.run('metro', 'unbind', 'usb1', '--json')).code, 2);
  assert.equal((await app.run('metro', 'unbind', 'usb1', '--device-port', '8082', '--json')).code, 0);
  assert.deepEqual((await app.state()).devices[0].reverse, { 'tcp:8081': 'tcp:8081' });
});

test('repair does not rewrite an already correct mapping', async t => {
  const app = await setup(t);
  await app.run('metro', 'bind', 'usb1', '--port', '8082');
  await app.run('metro', 'repair', '--all', '--json');
  const mutations = (await app.calls()).filter(c => c[2] === 'reverse' && c[3] !== '--list');
  assert.equal(mutations.length, 1);
});

test('status separates Metro reachability from app connectivity', async t => {
  const server = createServer((req, res) => res.end('packager-status:running'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const app = await setup(t);
  await app.run('metro', 'bind', 'usb1', '--port', String(port));
  const output = await app.run('status', '--json');
  assert.equal(output.code, 0);
  const data = JSON.parse(output.stdout).data;
  const bound = data.find(d => d.serial === 'usb1');
  assert.equal(bound.metro[0].reverse, 'ready');
  assert.equal(bound.metro[0].server, 'running');
  assert.equal(bound.app, 'unknown');
  assert.equal(data.find(d => d.serial === 'wifi1').metro, 'not_configured');
});

test('status reports which Metro address a bound app actually uses', async t => {
  const app = await setup(t, [
    { serial: 'usb1', apps: { 'com.example.app': { host: 'localhost:8081' } } },
    { serial: 'usb2', apps: { 'com.example.app': { host: 'localhost:8090' } } },
    { serial: 'emulator-5554', apps: { 'com.example.app': {} } },
    { serial: 'usb3' },
  ]);
  for (const serial of ['usb1', 'usb2', 'emulator-5554', 'usb3']) {
    assert.equal((await app.run('metro', 'bind', serial, '--port', '8090', '--app', 'com.example.app', '--json')).code, 0);
  }
  const data = JSON.parse((await app.run('status', '--json')).stdout).data;
  const appOf = serial => data.find(d => d.serial === serial).metro[0].app;
  assert.deepEqual(appOf('usb1'), { package: 'com.example.app', host: 'localhost:8081', source: 'saved', route: 'tunnel' });
  assert.equal(appOf('usb2').route, 'other_port');
  assert.deepEqual(appOf('emulator-5554'), { package: 'com.example.app', host: '10.0.2.2:8081', source: 'default', route: 'direct' });
  assert.equal(appOf('usb3').route, 'unknown');
  assert.match(appOf('usb3').error, /not debuggable/);
});

test('status shows where a conflicting tunnel currently points', async t => {
  const app = await setup(t, [{ serial: 'usb1' }]);
  await app.run('metro', 'bind', 'usb1', '--port', '8090');
  const state = await app.state();
  state.devices[0].reverse['tcp:8081'] = 'tcp:8081';
  await app.setState(state);
  const bound = JSON.parse((await app.run('status', '--json')).stdout).data.find(d => d.serial === 'usb1');
  assert.equal(bound.metro[0].reverse, 'conflict');
  assert.equal(bound.metro[0].current, 'tcp:8081');
  assert.equal(bound.metro[0].app, undefined);
});

test('an invalid app package fails before any reverse command', async t => {
  const app = await setup(t);
  for (const name of ['app', 'com.example.', '1com.example', 'com.example.app; rm']) {
    assert.equal((await app.run('metro', 'bind', 'usb1', '--port', '8090', '--app', name, '--json')).code, 2, name);
  }
  assert.equal((await app.calls()).filter(c => c.includes('reverse')).length, 0);
});

test('invalid ports fail before any reverse command', async t => {
  const app = await setup(t);
  for (const port of ['0', '65536', 'abc', '8081.5']) {
    assert.equal((await app.run('metro', 'bind', 'usb1', '--port', port, '--json')).code, 2);
  }
  assert.equal((await app.calls()).filter(c => c.includes('reverse')).length, 0);
});

test('a reverse rule created between inspection and binding is preserved', async t => {
  const app = await setup(t, [{ serial: 'usb1', reverseBeforeCreate: { 'tcp:8081': 'tcp:9999' } }]);
  const output = await app.run('metro', 'bind', 'usb1', '--port', '8082', '--json');
  assert.equal(output.code, 1, output.stdout);
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:9999');
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(`${app.env.ADBDOCK_HOME}/config.json`, 'utf8'));
  assert.equal(config.bindings[0].metroPort, 8082);
  assert.equal(config.bindings[0].managedPort, undefined);
  assert((await app.calls()).some(c => c.includes('--no-rebind')));
});

test('an already matching external reverse rule is not claimed or removed on unbind', async t => {
  const app = await setup(t, [{ serial: 'usb1', reverse: { 'tcp:8081': 'tcp:8082' } }]);
  assert.equal((await app.run('metro', 'bind', 'usb1', '--port', '8082', '--json')).code, 0);
  assert.equal((await app.run('metro', 'unbind', 'usb1', '--json')).code, 0);
  assert.equal((await app.state()).devices[0].reverse['tcp:8081'], 'tcp:8082');
  assert.equal((await app.calls()).filter(c => c[2] === 'reverse' && c[3] !== '--list').length, 0);
});

test('repair continues to other devices when one reverse query fails', async t => {
  const app = await setup(t, [{ serial: 'usb1' }, { serial: 'usb2' }]);
  assert.equal((await app.run('metro', 'bind', 'usb1', '--port', '8082', '--json')).code, 0);
  assert.equal((await app.run('metro', 'bind', 'usb2', '--port', '8083', '--json')).code, 0);
  await app.setState({ devices: [{ serial: 'usb1', commandFailures: ['reverse --list'] }, { serial: 'usb2' }] });
  const output = await app.run('metro', 'repair', '--all', '--json');
  assert.equal(output.code, 1, output.stdout);
  const result = JSON.parse(output.stdout);
  assert.deepEqual(result.data.map(binding => binding.state), ['ADB_ERROR', 'ready']);
  assert.equal(result.errors[0].deviceId, 'android:usb1');
  assert.equal((await app.state()).devices[1].reverse['tcp:8081'], 'tcp:8083');
});
