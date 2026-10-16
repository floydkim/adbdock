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

test('invalid ports fail before any reverse command', async t => {
  const app = await setup(t);
  for (const port of ['0', '65536', 'abc', '8081.5']) {
    assert.equal((await app.run('metro', 'bind', 'usb1', '--port', port, '--json')).code, 2);
  }
  assert.equal((await app.calls()).filter(c => c.includes('reverse')).length, 0);
});
