#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs, promisify } from 'node:util';

const exec = promisify(execFile);
const cli = new URL('../dist/cli.js', import.meta.url).pathname;

async function main() {
  const { values } = parseArgs({ options: { device: { type: 'string', multiple: true }, report: { type: 'string' } } });
  assert(values.device?.length, 'Supply --device <ADB serial> (repeatable). No devices are selected automatically.');
  const reportPath = path.resolve(values.report ?? `.test-results/devices-${Date.now()}.json`);
  const configHome = await mkdtemp(path.join(tmpdir(), 'adbdock-smoke-'));
  const env = { ...process.env, ADBDOCK_HOME: configHome };
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const report = { ok: false, startedAt: new Date().toISOString(), configHome, devices: [], checks: [], cleanup: { ok: false, errors: [] } };
  const servers = [];
  const aliases = [];
  let devicePort;

  async function run(args, cleanup = false, allowFailure = false) {
    if (!cleanup) controller.signal.throwIfAborted();
    let output;
    try {
      // Let finite CLI commands finish before cleanup; killing a parent can leave its adb child running.
      output = await exec(process.execPath, [cli, ...args], { env, timeout: 60000 });
    } catch (error) {
      if (!allowFailure) throw new Error(`${args.join(' ')}: ${error.stdout || error.message}`);
      output = error;
    }
    const parsed = JSON.parse(output.stdout);
    if (!allowFailure) assert(parsed.ok, JSON.stringify(parsed.errors));
    return parsed;
  }
  const deviceCommand = (alias, args, cleanup = false) => run(['adb', '--device', alias, '--json', '--', ...args], cleanup);
  async function reverse(alias, cleanup = false) {
    const result = await deviceCommand(alias, ['reverse', '--list'], cleanup);
    const entries = result.data[0].stdout.trim().split(/\r?\n/).filter(Boolean).map(line => line.trim().split(/\s+/).slice(-2));
    return new Map(entries);
  }
  async function probe(alias, server) {
    // Keep stdin open long enough for toybox nc to flush the request and read the response.
    const command = `{ printf 'GET /probe HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n'; sleep 1; } | toybox nc -w 3 -W 3 127.0.0.1 ${devicePort}`;
    const result = await deviceCommand(alias, ['shell', command]);
    assert(result.data[0].stdout.includes(server.marker), `${alias}: Android HTTP response did not contain the expected server marker`);
  }
  async function waitFor(check) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      controller.signal.throwIfAborted();
      if (await check()) return;
      await delay(200, undefined, { signal: controller.signal });
    }
    throw new Error('Timed out waiting for recovery');
  }
  async function check(name, action) {
    const started = Date.now();
    await action();
    report.checks.push({ name, ok: true, elapsedMs: Date.now() - started });
    console.log(`PASS ${name}`);
  }
  async function listen(server, port = 0) {
    server.http.listen(port, '127.0.0.1');
    await once(server.http, 'listening');
    server.port = server.http.address().port;
  }
  async function close(server) {
    if (!server.http.listening) return;
    const closed = new Promise((resolve, reject) => server.http.close(error => error ? reject(error) : resolve()));
    server.http.closeAllConnections();
    await closed;
  }

  try {
    const live = (await run(['devices', '--json'])).data;
    for (const serial of values.device) {
      const device = live.find(d => d.transports.some(t => t.serial === serial && t.state === 'device'));
      assert(device, `Online ADB serial not found: ${serial}`);
      assert(!report.devices.some(d => d.id === device.id), 'Select each physical device only once; USB/Wi-Fi transports can refer to the same phone.');
      const alias = `smoke${aliases.length + 1}`;
      await run(['alias', serial, alias, '--json']);
      aliases.push(alias);
      report.devices.push({ id: device.id, requestedSerial: serial, alias });
    }
    await check('aliases and commands without Metro', async () => {
      const result = await run(['adb', ...aliases.flatMap(alias => ['--device', alias]), '--json', '--', 'shell', 'echo', 'adbdock-smoke']);
      assert.equal(result.data.length, aliases.length);
      assert(result.data.every(d => d.stdout.includes('adbdock-smoke')));
      const status = await run(['status', '--json']);
      assert(aliases.every(alias => status.data.find(d => d.alias === alias)?.metro === 'not_configured'));
    });
    const used = new Set();
    for (const alias of aliases) for (const port of (await reverse(alias)).keys()) used.add(port);
    do { devicePort = randomInt(40000, 60000); } while (used.has(`tcp:${devicePort}`));
    report.devicePort = devicePort;
    for (let i = 0; i < Math.max(2, aliases.length); i++) {
      const marker = `adbdock-${randomUUID()}`;
      const server = { marker, http: createServer((req, res) => res.end(req.url === '/status' ? 'packager-status:running' : marker)) };
      servers.push(server);
      await listen(server);
    }
    report.hostPorts = servers.map(server => server.port);
    await check('shared host port', async () => {
      for (const alias of aliases) {
        await run(['metro', 'bind', alias, '--port', String(servers[0].port), '--device-port', String(devicePort), '--json']);
        await probe(alias, servers[0]);
      }
    });
    await check('separate host ports', async () => {
      for (const [i, alias] of aliases.entries()) {
        await run(['metro', 'bind', alias, '--port', String(servers[i].port), '--device-port', String(devicePort), '--json']);
        await probe(alias, servers[i]);
      }
    });
    // Finish the handshake before honoring SIGINT so a detached watcher cannot start after cleanup.
    await run(['watch', '--background', '--interval', '300', '--json'], true);
    await check('watcher repairs missing tunnel', async () => {
      await deviceCommand(aliases[0], ['reverse', '--remove', `tcp:${devicePort}`]);
      await waitFor(async () => (await reverse(aliases[0])).get(`tcp:${devicePort}`) === `tcp:${servers[0].port}`);
      await probe(aliases[0], servers[0]);
      for (const [i, alias] of aliases.entries()) await probe(alias, servers[i]);
    });
    await check('server stop and restart', async () => {
      await close(servers[0]);
      const status = await run(['status', '--json']);
      const first = status.data.find(d => d.alias === aliases[0]);
      assert.equal(first.metro[0].reverse, 'ready');
      assert.equal(first.metro[0].server, 'unreachable');
      for (let i = 1; i < aliases.length; i++) await probe(aliases[i], servers[i]);
      await listen(servers[0], servers[0].port);
      await probe(aliases[0], servers[0]);
    });
    await check('external conflict is preserved', async () => {
      assert.equal((await reverse(aliases[0])).get(`tcp:${devicePort}`), `tcp:${servers[0].port}`);
      const externalTarget = `tcp:${servers[1].port}`;
      await deviceCommand(aliases[0], ['reverse', `tcp:${devicePort}`, externalTarget]);
      await waitFor(async () => (await readFile(path.join(configHome, 'watch.log'), 'utf8')).includes('REVERSE_CONFLICT'));
      assert.equal((await reverse(aliases[0])).get(`tcp:${devicePort}`), externalTarget);
      await run(['stop', '--json']);
      const unbound = await run(['metro', 'unbind', aliases[0], '--device-port', String(devicePort), '--json'], false, true);
      assert(unbound.errors.some(e => e.code === 'REVERSE_CONFLICT'));
      assert.equal((await reverse(aliases[0])).get(`tcp:${devicePort}`), externalTarget);
    });
    report.ok = true;
  } catch (error) {
    report.error = error.message;
  } finally {
    async function cleanup(action) {
      try { await action(); } catch (error) { report.cleanup.errors.push(error.message); }
    }
    await cleanup(() => run(['stop', '--json'], true));
    for (const alias of aliases) {
      if (!devicePort) continue;
      await cleanup(() => run(['metro', 'unbind', alias, '--device-port', String(devicePort), '--json'], true));
      // An interrupted bind may create the tunnel before saving managedPort.
      await cleanup(async () => {
        const current = (await reverse(alias, true)).get(`tcp:${devicePort}`);
        if (servers.some(server => current === `tcp:${server.port}`)) {
          await deviceCommand(alias, ['reverse', '--remove', `tcp:${devicePort}`], true);
        } else assert(!current, 'The test port changed again; preserved the external tunnel.');
        assert(!(await reverse(alias, true)).has(`tcp:${devicePort}`), 'Test tunnel remains after cleanup.');
      });
    }
    for (const server of servers) await cleanup(() => close(server));
    try { report.watchLog = await readFile(path.join(configHome, 'watch.log'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') report.cleanup.errors.push(error.message); }
    report.cleanup.ok = report.cleanup.errors.length === 0;
    if (report.cleanup.ok) await cleanup(() => rm(configHome, { recursive: true, force: true }));
    report.cleanup.ok = report.cleanup.errors.length === 0;
    report.ok &&= report.cleanup.ok;
    report.finishedAt = new Date().toISOString();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${reportPath}`);
    if (!report.ok) {
      console.error(report.error ?? report.cleanup.errors.join('\n'));
      process.exitCode = 1;
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
