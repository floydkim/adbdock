import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import lockfile from 'proper-lockfile';
import { CliError } from './output.js';
import { home, readConfig } from './store.js';
import { watchLoop } from './watch.js';
import { checkedAdb } from './adb.js';

const runtime = path.join('/tmp', `adbdock-${process.getuid?.() ?? 'user'}-${createHash('sha256').update(home).digest('hex').slice(0, 16)}`);
const socketPath = path.join(runtime, 'watch.sock');
interface WatchInfo { pid: number; token: string; state: string }

async function prepareRuntime(): Promise<void> {
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const info = await lstat(runtime);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
    throw new CliError('WATCH_UNAVAILABLE', 'Unsafe watcher runtime directory.', 4);
  }
  await chmod(runtime, 0o700);
}

async function request(message: unknown): Promise<WatchInfo | null> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    socket.setTimeout(1000, () => socket.destroy(new Error('Watcher response timed out')));
    socket.on('connect', () => socket.write(`${JSON.stringify(message)}\n`));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 4096) { socket.destroy(new Error('Invalid watcher response')); return; }
      if (!buffer.includes('\n')) return;
      try {
        const data = JSON.parse(buffer.split('\n')[0]!);
        if (typeof data.pid !== 'number' || typeof data.token !== 'string') throw new Error('Invalid watcher identity');
        resolve(data);
        socket.end();
      } catch (error) { socket.destroy(error as Error); }
    });
    socket.on('end', () => {
      if (!buffer.includes('\n')) reject(new CliError('WATCH_UNAVAILABLE', 'Watcher closed without a response.', 4));
    });
    socket.on('error', error => {
      if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) resolve(null);
      else reject(new CliError('WATCH_UNAVAILABLE', error.message, 4));
    });
  });
}

export async function watcherInfo(): Promise<WatchInfo | null> {
  return request({ command: 'ping' });
}

export async function stopWatcher() {
  const info = await watcherInfo();
  if (!info) return { state: 'stopped' };
  await request({ command: 'stop', token: info.token });
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (!await lockfile.check(path.join(runtime, 'owner'), { realpath: false, stale: 10_000 })) return { state: 'stopped' };
    await sleep(100);
  }
  throw new CliError('WATCH_STOP_TIMEOUT', 'Watcher is still finishing an ADB operation. Check status and retry stop.', 4);
}

export async function runWatcher(interval: number, ready: (info: WatchInfo) => void): Promise<void> {
  await readConfig();
  await prepareRuntime();
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(path.join(runtime, 'owner'), { realpath: false, stale: 10_000, update: 2000, retries: 0 });
  } catch { throw new CliError('WATCH_RUNNING', 'A watcher is already running (or its crash lease is still expiring).', 4); }
  const controller = new AbortController();
  const info: WatchInfo = { pid: process.pid, token: randomUUID(), state: 'watching' };
  const stop = () => { info.state = 'stopping'; controller.abort(); };
  const server = net.createServer(socket => {
    socket.on('error', () => socket.destroy());
    socket.setTimeout(2000, () => socket.destroy());
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 4096) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      try {
        const message = JSON.parse(buffer.split('\n')[0]!);
        if (message.command === 'stop' && message.token === info.token) stop();
        else if (message.command !== 'ping') { socket.destroy(); return; }
        socket.end(`${JSON.stringify(info)}\n`);
      } catch { socket.destroy(); }
    });
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await checkedAdb(['devices', '-l']);
    // Only the process holding the watcher lease may remove an old socket.
    await unlink(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); });
    });
    server.on('error', stop);
    ready(info);
    await watchLoop(interval, controller.signal);
  } finally {
    stop();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await release();
  }
}

export async function startBackground(interval: number): Promise<WatchInfo> {
  await readConfig();
  if (await watcherInfo()) throw new CliError('WATCH_RUNNING', 'A watcher is already running.', 4);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./watch-entry.js', import.meta.url)), String(interval)], {
      detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: process.env,
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new CliError('WATCH_START_TIMEOUT', 'Watcher did not become ready.', 4));
    }, 15_000);
    child.on('message', (message: { ready?: WatchInfo; error?: string; code?: string }) => {
      clearTimeout(timer);
      if (message.ready) {
        child.disconnect();
        child.unref();
        resolve(message.ready);
      } else reject(new CliError(message.code ?? 'WATCH_START_FAILED', message.error ?? 'Watcher startup failed.', 4));
    });
    child.on('error', error => { clearTimeout(timer); reject(new CliError('WATCH_START_FAILED', error.message, 4)); });
    child.on('exit', () => { clearTimeout(timer); reject(new CliError('WATCH_START_FAILED', 'Watcher exited during startup.', 4)); });
  });
}
