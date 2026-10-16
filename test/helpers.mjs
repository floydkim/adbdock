import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const cliPath = new URL('../dist/cli.js', import.meta.url).pathname;

export async function setup(t, devices = [{ serial: 'usb1' }, { serial: 'wifi1', id: 'phone2' }]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'adbdock-'));
  const statePath = path.join(directory, 'adb.json');
  await writeFile(statePath, JSON.stringify({ devices }));
  const env = { ...process.env, ADBDOCK_HOME: path.join(directory, 'home'),
    ADBDOCK_ADB: new URL('./fixtures/fake-adb.mjs', import.meta.url).pathname,
    FAKE_ADB_STATE: statePath };
  t.after(async () => {
    await exec(process.execPath, [cliPath, 'stop', '--json'], { env, timeout: 5000 }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });
  return {
    env, directory, statePath,
    async run(...args) {
      try {
        const output = await exec(process.execPath, [cliPath, ...args], { env, timeout: 15_000 });
        return { ...output, code: 0 };
      } catch (error) {
        return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code };
      }
    },
    async calls() {
      try { return (await readFile(`${statePath}.calls`, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    async state() { return JSON.parse(await readFile(statePath, 'utf8')); },
    async setState(state) { await writeFile(statePath, JSON.stringify(state)); },
  };
}
