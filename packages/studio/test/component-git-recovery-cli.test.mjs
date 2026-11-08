import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../src/cli.mjs';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { planComponentUpdate, applyComponentPlan } from '../src/component-updates.mjs';

function cli(...args) {
  let stdout = '', stderr = '';
  const code = runCli(args, { out: part => { stdout += part; }, err: part => { stderr += part; } });
  return { code, stdout, stderr, json: stdout.startsWith('{') ? JSON.parse(stdout) : null };
}
function git(root, ...args) {
  const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}
function fixture(t, { newHostExists = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-recover-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = process.env.LUDORY_STUDIO_TRUST_DIR;
  process.env.LUDORY_STUDIO_TRUST_DIR = path.join(root, 'first-host');
  t.after(() => {
    if (old === undefined) delete process.env.LUDORY_STUDIO_TRUST_DIR;
    else process.env.LUDORY_STUDIO_TRUST_DIR = old;
  });
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  const catalog = path.join(root, 'catalog');
  const template = path.join(catalog, 'templates/owned-web');
  fs.mkdirSync(path.join(template, 'src'), { recursive: true });
  fs.mkdirSync(path.join(catalog, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(catalog, 'profiles/owned-game.json'), JSON.stringify({
    schemaVersion: 1, id: 'owned-game', version: '1.0.0', description: 'fixture',
    engine: 'web', targets: ['vk-games'], templates: ['owned-web'],
  }));
  const descriptor = path.join(template, 'template.json');
  const descriptorVersion = version => fs.writeFileSync(descriptor, JSON.stringify({
    schemaVersion: 1, id: 'owned-web', version, description: 'fixture', profile: 'owned-game',
    engine: 'web', targets: ['vk-games'], files: ['index.html', 'src/main.js'],
  }));
  descriptorVersion('1.2.3');
  fs.writeFileSync(path.join(template, 'index.html'), '<main>Studio</main>\n');
  fs.writeFileSync(path.join(template, 'src/main.js'), 'export const version = 123;\n');
  const project = path.join(root, 'game-studio');
  fs.mkdirSync(project);
  assert.equal(applyCreatePlan(planCreate(project, { id: 'cli-game', title: 'CLI',
    lang: 'en', profile: 'owned-game', template: 'owned-web', targets: ['vk-games'], catalog })).status, 'APPLIED');
  git(root, 'add', 'game-studio');
  git(root, 'commit', '-qm', 'create');
  const fromCommit = git(root, 'rev-parse', 'HEAD');
  descriptorVersion('1.2.4');
  fs.writeFileSync(path.join(template, 'src/main.js'), 'export const version = 124;\n');
  assert.equal(applyComponentPlan(planComponentUpdate(project, { catalog })).status, 'APPLIED');
  git(root, 'add', 'game-studio/index.html', 'game-studio/src/main.js', 'game-studio/ludory.components.json');
  git(root, 'commit', '-qm', 'upgrade');
  const toCommit = git(root, 'rev-parse', 'HEAD');
  for (const item of fs.readdirSync(project).filter(name => name.startsWith('.ludory-components-backup-'))) {
    fs.rmSync(path.join(project, item), { recursive: true });
  }
  process.env.LUDORY_STUDIO_TRUST_DIR = path.join(root, 'new-host');
  if (newHostExists) fs.mkdirSync(process.env.LUDORY_STUDIO_TRUST_DIR, { mode: 0o700 });
  return { project, fromCommit, toCommit, catalog };
}

test('CLI recovery reports how to initialize a missing host-registry before a fresh preview', t => {
  const f = fixture(t, { newHostExists: false });
  const registry = process.env.LUDORY_STUDIO_TRUST_DIR;
  const args = ['--project', f.project, '--from-commit', f.fromCommit,
    '--to-commit', f.toCommit, '--json'];
  const missing = cli('components', 'recover', ...args);
  assert.equal(missing.code, 2);
  assert.equal(missing.json.status, 'BLOCKED');
  assert.equal(missing.json.hostRegistryPath, registry);
  assert.match(missing.json.nextAction, /create|preview/i);
  assert.equal(missing.json.recoverySha256, undefined, 'do not offer an owner approval digest');
  assert.equal(fs.existsSync(registry), false);
  const human = cli('components', 'recover', '--project', f.project,
    '--from-commit', f.fromCommit, '--to-commit', f.toCommit);
  assert.equal(human.code, 2);
  assert.match(human.stdout, /host registry to initialize:/i);
  assert.ok(human.stdout.includes(registry));
  fs.mkdirSync(registry, { mode: 0o700 });
  const fresh = cli('components', 'recover', ...args);
  assert.equal(fresh.json.status, 'NEEDS_USER_ACTION');
  assert.match(fresh.json.recoverySha256, /^[a-f0-9]{64}$/);
});

test('CLI recover is read-only by default and requires exact owner confirmation to create host record', t => {
  const f = fixture(t);
  const args = ['--project', f.project, '--from-commit', f.fromCommit,
    '--to-commit', f.toCommit, '--json'];
  const before = fs.readFileSync(path.join(f.project, 'src/main.js'));
  const preview = cli('components', 'recover', ...args);
  assert.equal(preview.code, 2, preview.stderr);
  assert.equal(preview.json.status, 'NEEDS_USER_ACTION');
  assert.match(preview.json.recoverySha256, /^[a-f0-9]{64}$/);
  const rejected = cli('components', 'recover', ...args, '--apply');
  assert.equal(rejected.code, 1);
  assert.equal(rejected.json.status, 'FAILED');
  assert.match(rejected.json.conflicts.join(' '), /confirmation|requires/i);
  const wrong = cli('components', 'recover', ...args, '--accept-recovery-sha256', 'f'.repeat(64), '--apply');
  assert.equal(wrong.code, 2);
  assert.equal(wrong.json.status, 'CONFLICT');
  const applied = cli('components', 'recover', ...args,
    '--accept-recovery-sha256', preview.json.recoverySha256, '--apply');
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(applied.json.status, 'RECOVERED');
  assert.deepEqual(fs.readFileSync(path.join(f.project, 'src/main.js')), before);
  const trust = cli('components', 'trust', '--project', f.project, '--json');
  assert.equal(trust.code, 2);
  assert.equal(trust.json.status, 'NEEDS_USER_ACTION');
  const status = cli('components', 'status', '--project', f.project, '--catalog', f.catalog, '--json');
  assert.equal(status.json.status, 'BLOCKED', 'recovery alone is not a Studio trust grant');
});

test('CLI recover reports missing history as a blocked result without host writes', t => {
  const f = fixture(t);
  const result = cli('components', 'recover', '--project', f.project,
    '--from-commit', f.toCommit, '--to-commit', f.toCommit, '--json');
  assert.equal(result.code, 2);
  assert.equal(result.json.status, 'CONFLICT');
});
