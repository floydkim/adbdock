import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'adbdock-plugin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'plugins/adbdock/.claude-plugin', 'plugins/adbdock/skills/adbdock/references', '.claude-plugin', '.agents/plugins']) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await copyFile(new URL('../scripts/plugin.mjs', import.meta.url), path.join(root, 'scripts/plugin.mjs'));
  const put = (name, value) => writeFile(path.join(root, name), JSON.stringify(value, null, 2) + '\n');
  await put('package.json', { name: 'adbdock', version: '9.0.0' });
  await put('plugins/adbdock/plugin.json', { name: 'adbdock', version: '0.1.0', description: 'Keep me' });
  await put('plugins/adbdock/.claude-plugin/plugin.json', { name: 'adbdock', version: '0.1.0' });
  await put('.claude-plugin/marketplace.json', { name: 'adbdock', plugins: [{ name: 'adbdock', source: './plugins/adbdock' }] });
  await put('.agents/plugins/marketplace.json', { name: 'adbdock', plugins: [{ name: 'adbdock', source: { source: 'local', path: './plugins/adbdock' } }] });
  await writeFile(path.join(root, 'plugins/adbdock/skills/adbdock/SKILL.md'), '[Metro](references/metro.md)\n');
  await writeFile(path.join(root, 'plugins/adbdock/skills/adbdock/references/metro.md'), 'Metro instructions\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '.');
  git('commit', '-qm', 'Initial');
  const base = git('rev-parse', 'HEAD');
  const run = (...args) => spawnSync(process.execPath, ['scripts/plugin.mjs', ...args], { cwd: root, encoding: 'utf8' });
  const get = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
  return { root, put, get, run, base, git };
}

test('plugin versions do not have to match the CLI version', async t => {
  const app = await fixture(t);
  const result = app.run('check', '--base', app.base);
  assert.equal(result.status, 0, result.stderr);
});

test('a patch release updates both plugin manifests without changing the CLI or creating a tag', async t => {
  const app = await fixture(t);
  const result = app.run('version', 'patch');
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['plugins/adbdock/plugin.json', 'plugins/adbdock/.claude-plugin/plugin.json']) {
    assert.equal((await app.get(name)).version, '0.1.1');
  }
  assert.equal((await app.get('plugins/adbdock/plugin.json')).description, 'Keep me');
  assert.equal((await app.get('package.json')).version, '9.0.0');
  assert.equal(app.git('tag'), '');
  assert.equal(app.run('check', '--base', app.base).status, 0);
});

test('minor, major and explicit plugin releases update both manifests', async t => {
  const app = await fixture(t);
  for (const [input, expected] of [['minor', '0.2.0'], ['major', '1.0.0'], ['2.3.4', '2.3.4']]) {
    const result = app.run('version', input);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await app.get('plugins/adbdock/plugin.json')).version, expected);
    assert.equal((await app.get('plugins/adbdock/.claude-plugin/plugin.json')).version, expected);
  }
});

test('PR validation accepts plugin changes without a manual version bump', async t => {
  const app = await fixture(t);
  await writeFile(path.join(app.root, 'plugins/adbdock/skills/adbdock/references/metro.md'), 'Changed instructions\n');
  const result = app.run('check', '--base', app.base);
  assert.equal(result.status, 0, result.stderr);
});

test('manually lowering both plugin versions is rejected against the base commit', async t => {
  const app = await fixture(t);
  for (const name of ['plugins/adbdock/plugin.json', 'plugins/adbdock/.claude-plugin/plugin.json']) {
    const manifest = await app.get(name);
    await app.put(name, { ...manifest, version: '0.0.9' });
  }
  assert.equal(app.run('check', '--base', app.base).status, 1);
});

test('unrelated changes do not require a plugin release', async t => {
  const app = await fixture(t);
  await app.put('package.json', { version: '10.0.0' });
  assert.equal(app.run('check', '--base', app.base).status, 0);
});

test('mismatched plugin versions and invalid release requests leave files unchanged', async t => {
  const app = await fixture(t);
  for (const input of ['0.1.0', '0.0.9', 'garbage', '1.2', '01.2.3']) {
    assert.equal(app.run('version', input).status, 1);
    assert.equal((await app.get('plugins/adbdock/plugin.json')).version, '0.1.0');
  }
  await app.put('plugins/adbdock/.claude-plugin/plugin.json', { name: 'adbdock', version: '0.2.0' });
  assert.equal(app.run('check').status, 1);
  assert.equal(app.run('version', 'patch').status, 1);
  assert.equal((await app.get('plugins/adbdock/plugin.json')).version, '0.1.0');
});

test('missing references and incorrect marketplace paths fail validation', async t => {
  const app = await fixture(t);
  const reference = path.join(app.root, 'plugins/adbdock/skills/adbdock/references/metro.md');
  await rm(reference);
  assert.equal(app.run('check').status, 1);
  await writeFile(reference, 'Restored\n');
  await app.put('.agents/plugins/marketplace.json', { name: 'adbdock', plugins: [{ name: 'adbdock', source: { source: 'local', path: './wrong' } }] });
  assert.equal(app.run('check').status, 1);
});

test('a first push or manual run can validate without a comparison commit', async t => {
  const app = await fixture(t);
  assert.equal(app.run('check', '--base', '').status, 0);
  assert.equal(app.run('check', '--base', '0'.repeat(40)).status, 0);
  assert.equal(app.run('check', '--base', 'missing-ref').status, 1);
});


test('automatic release increments both versions once and preserves the CLI version', async t => {
  const app = await fixture(t);
  await writeFile(path.join(app.root, 'plugins/adbdock/skills/adbdock/references/metro.md'), 'Changed instructions\n');
  app.git('add', '.');
  app.git('commit', '-qm', 'Update skill');
  const result = app.run('auto-version');
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['plugins/adbdock/plugin.json', 'plugins/adbdock/.claude-plugin/plugin.json']) {
    assert.equal((await app.get(name)).version, '0.1.1');
  }
  assert.equal((await app.get('package.json')).version, '9.0.0');
  app.git('add', '.');
  app.git('commit', '-qm', 'Bot version bump');
  assert.equal(app.run('auto-version').status, 0);
  assert.equal(app.git('status', '--porcelain'), '');
});

test('automatic release skips a manually increased version', async t => {
  const app = await fixture(t);
  await writeFile(path.join(app.root, 'plugins/adbdock/skills/adbdock/references/metro.md'), 'Changed instructions\n');
  assert.equal(app.run('version', 'minor').status, 0);
  app.git('add', '.');
  app.git('commit', '-qm', 'Release manually');
  assert.equal(app.run('auto-version').status, 0);
  assert.equal((await app.get('plugins/adbdock/plugin.json')).version, '0.2.0');
  assert.equal(app.git('status', '--porcelain'), '');
  await writeFile(path.join(app.root, 'plugins/adbdock/skills/adbdock/references/metro.md'), 'Another change\n');
  app.git('add', '.');
  app.git('commit', '-qm', 'Next skill change');
  assert.equal(app.run('auto-version').status, 0);
  assert.equal((await app.get('plugins/adbdock/plugin.json')).version, '0.2.1');
});

test('automatic release finds pending plugin changes before a later CLI-only push', async t => {
  const app = await fixture(t);
  await app.put('plugins/adbdock/plugin.json', { name: 'adbdock', version: '0.1.0', description: 'Updated metadata' });
  app.git('add', '.');
  app.git('commit', '-qm', 'Plugin metadata without version change');
  await app.put('package.json', { name: 'adbdock', version: '10.0.0' });
  app.git('add', '.');
  app.git('commit', '-qm', 'CLI-only follow-up');
  assert.equal(app.run('auto-version').status, 0);
  assert.equal((await app.get('plugins/adbdock/plugin.json')).version, '0.1.1');
});

test('automatic release leaves an unchanged plugin alone', async t => {
  const app = await fixture(t);
  await app.put('package.json', { name: 'adbdock', version: '10.0.0' });
  app.git('add', '.');
  app.git('commit', '-qm', 'Only CLI changed');
  assert.equal(app.run('auto-version').status, 0);
  assert.equal(app.git('status', '--porcelain'), '');
});
