#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pluginPath = 'plugins/adbdock';
const manifests = [`${pluginPath}/plugin.json`, `${pluginPath}/.claude-plugin/plugin.json`];
const readJson = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function parts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid plugin version: ${version}. Use major.minor.patch.`);
  }
  return version.split('.').map(Number);
}

function newer(next, previous) {
  const a = parts(next);
  const b = parts(previous);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

try {
  const [command, ...args] = process.argv.slice(2);
  const values = await Promise.all(manifests.map(readJson));
  const version = values[0].version;
  parts(version);
  for (const manifest of values) {
    if (manifest.name !== 'adbdock' || manifest.version !== version) {
      throw new Error('Both plugin manifests must have name adbdock and the same version.');
    }
  }

  let requested = args[0];
  if (command === 'auto-version' && args.length === 0) {
    // Find the first manifest commit at this version, including unchanged-version metadata edits.
    const history = git('log', '--first-parent', '--format=%H', '--', manifests[0]).split('\n').filter(Boolean);
    let released;
    for (const commit of history) {
      const previous = JSON.parse(git('show', `${commit}:${manifests[0]}`)).version;
      if (previous !== version) break;
      released = commit;
    }
    if (!released || !git('diff', '--name-only', released, '--', pluginPath)) {
      console.log(`Plugin ${version}: no unreleased changes; version unchanged.`);
      process.exit(0);
    }
    requested = 'patch';
  }

  if ((command === 'version' && args.length === 1) || (command === 'auto-version' && args.length === 0)) {
    const current = parts(version);
    const bump = ['major', 'minor', 'patch'].indexOf(requested);
    let next = requested;
    if (bump !== -1) {
      current[bump]++;
      current.fill(0, bump + 1);
      next = current.join('.');
    }
    if (!newer(next, version)) throw new Error(`Plugin version must be newer than ${version}.`);
    for (let i = 0; i < manifests.length; i++) {
      values[i].version = next;
      await writeFile(path.join(root, manifests[i]), JSON.stringify(values[i], null, 2) + '\n');
    }
    console.log(`Plugin ${version} → ${next}. CLI version unchanged; no commit or tag created.`);
  } else if (command === 'check' && (args.length === 0 || (args.length === 2 && args[0] === '--base'))) {
    for (const file of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']) {
      const catalog = await readJson(file);
      const entry = catalog.plugins?.find(plugin => plugin.name === 'adbdock');
      const source = file.startsWith('.claude-plugin') ? entry?.source : entry?.source?.path;
      if (catalog.name !== 'adbdock' || source !== `./${pluginPath}` || (entry.version && entry.version !== version)) {
        throw new Error(`Incorrect plugin entry in ${file}.`);
      }
    }
    const directory = path.join(root, pluginPath);
    await access(path.join(directory, 'skills/adbdock/SKILL.md'));
    for (const file of await readdir(directory, { recursive: true })) {
      if (!file.endsWith('.md')) continue;
      const markdown = await readFile(path.join(directory, file), 'utf8');
      for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const link = match[1].split('#')[0];
        if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
        const target = path.resolve(directory, path.dirname(file), link);
        const relative = path.relative(directory, target);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error(`Reference escapes plugin directory: ${file}: ${link}`);
        }
        await access(target);
      }
    }
    const base = args[1];
    if (base && !/^0+$/.test(base)) {
      const commit = git('rev-parse', '--verify', `${base}^{commit}`);
      const changed = git('diff', '--name-only', commit, '--', pluginPath);
      if (changed && git('ls-tree', '--name-only', commit, '--', manifests[0])) {
        const previous = JSON.parse(git('show', `${commit}:${manifests[0]}`)).version;
        if (newer(previous, version)) {
          throw new Error(`Plugin version cannot decrease from ${previous} to ${version}.`);
        }
      }
    }
    console.log(`Plugin ${version}: manifests, marketplaces and references OK.`);
  } else {
    throw new Error('Usage: plugin.mjs check [--base <commit>] | auto-version | version <patch|minor|major|major.minor.patch>');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
