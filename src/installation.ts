import { execFile, spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { watcherInfo } from './daemon.js';
import { CliError } from './output.js';
import { home } from './store.js';

const exec = promisify(execFile);

export async function manageInstallation(action: 'upgrade' | 'uninstall', json: boolean) {
  let prefix: string;
  try {
    const output = await exec('npm', ['prefix', '--global'], { timeout: 10000 });
    prefix = await realpath(output.stdout.trim());
  } catch (error) {
    throw new CliError('NPM_UNAVAILABLE', `Cannot query the global npm installation: ${(error as Error).message}`);
  }
  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  if (root !== path.join(prefix, 'lib', 'node_modules', 'adbdock')) {
    throw new CliError('GLOBAL_INSTALL_REQUIRED',
      'This command only manages an npm global installation in the current npm prefix. For npx, use npx adbdock@latest; for source checkouts or npm links, update or remove them manually.', 2);
  }
  if (await watcherInfo()) {
    throw new CliError('WATCH_RUNNING', `Run adbdock watch stop for the current configuration before ${action}.`, 4);
  }
  const args = action === 'upgrade'
    ? ['install', '--global', '--prefix', prefix, 'adbdock@latest']
    : ['uninstall', '--global', '--prefix', prefix, 'adbdock'];
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', args, { stdio: ['inherit', json ? 'ignore' : 'inherit', 'inherit'] });
    child.on('error', error => reject(new CliError('NPM_FAILED', error.message)));
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new CliError('NPM_FAILED', `npm ${args[0]} failed (${signal ?? code}). Configuration and logs were not removed.`));
    });
  });
  if (action === 'upgrade') {
    const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    return { action, version, configHome: home };
  }
  const homePrefix = `${homedir()}/`;
  const cleanupPath = home.startsWith(homePrefix) ? home.slice(homePrefix.length) : home;
  const cleanupCommand = `rm -rf -- ${home.startsWith(homePrefix) ? "~/" : ""}'${cleanupPath.replaceAll("'", "'\\''")}'`;
  return { action, configHome: home, cleanupCommand };
}
