import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { runCli } from '../src/cli.mjs';

test('Studio test runner always isolates the host trust registry', () => {
  assert.match(process.env.LUDORY_STUDIO_TRUST_DIR ?? '', /ludory-test-host-trust-/);
});

function cli(...args) {
  let stdout = '';
  let stderr = '';
  const status = runCli(args, {
    out: text => { stdout += text; },
    err: text => { stderr += text; },
  });
  return { status, stdout, stderr };
}

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('CLI help and unknown options have explicit exit codes', () => {
  const help = cli('help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /ludory (inspect|init|migrate)/);
  const unknown = cli('nonsense');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown command/i);
  const flag = cli('inspect', '--project', '.', '--force');
  assert.equal(flag.status, 1);
  assert.match(flag.stderr, /Unknown option/i);
});

test('components native doctor is read-only and explains the exact Windows build prerequisite', () => {
  const outcome = cli('components', 'native', '--json');
  assert.equal(outcome.status, 0, outcome.stderr);
  const result = JSON.parse(outcome.stdout);
  assert.equal(result.mode, 'component-native-doctor');
  assert.equal(result.status, process.platform === 'win32' ? 'READY' : 'NOT_REQUIRED');
  assert.equal(result.native, process.platform === 'win32');
  assert.equal(result.buildCommand, 'npm run build:windows-pin');
  assert.deepEqual(result.writes, []);
  assert.equal(cli('components', 'native', '--apply').status, 1,
    'Native inspection must not introduce an implicit build or write path');
});

test('init previews by default and applies explicit manifest only', t => {
  const project = temporary(t);
  const args = ['init', '--project', project, '--id', 'space-game', '--title', 'Космос', '--lang', 'ru', '--engine', 'phaser', '--targets', 'vk-games,yandex-games', '--json'];
  const preview = cli(...args);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).status, 'READY');
  assert.deepEqual(fs.readdirSync(project), []);
  const applied = cli(...args, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).status, 'APPLIED');
  assert.match(cli('inspect', '--project', project).stdout, /IN_SYNC|CURRENT/);
  const second = temporary(t);
  const readableArgs = args.map(item => item === project ? second : item).filter(item => item !== '--json');
  const readable = cli(...readableArgs, '--apply');
  assert.equal(readable.status, 0);
  assert.match(readable.stdout, /created: ludory\.project\.json/);
  assert.doesNotMatch(readable.stdout, /would create/);
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'ludory.project.json'), 'utf8'));
  assert.deepEqual(manifest.targets, ['vk-games', 'yandex-games']);
  const inspect = cli('inspect', '--project', project, '--json');
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).status, 'CURRENT');
});

test('CLI preserves existing data, fails closed and forbids apply to inspect', t => {
  const project = temporary(t);
  fs.writeFileSync(path.join(project, 'existing.txt'), 'owned');
  const blocked = cli('init', '--project', project, '--id', 'test', '--title', 'Test', '--lang', 'en', '--engine', 'phaser', '--targets', 'vk-games', '--apply', '--json');
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).status, 'BLOCKED');
  assert.deepEqual(fs.readdirSync(project), ['existing.txt']);
  const disallow = cli('inspect', '--project', project, '--apply');
  assert.equal(disallow.status, 1);
  assert.match(disallow.stderr, /not valid|Unknown option/i);
});

test('invalid init metadata and ambiguous flags fail without writes', t => {
  const project = temporary(t);
  const common = ['init', '--project', project, '--id', 'one', '--title', 'One', '--lang', 'en', '--engine', 'phaser', '--targets', 'vk-games'];
  assert.equal(cli(...common, '--id', 'two').status, 1);
  assert.equal(cli(...common, '--version', 'invalid').status, 1);
  assert.equal(cli(...common, '--targets', '').status, 1);
  assert.deepEqual(fs.readdirSync(project), []);
});

test('migrate CLI previews then adopts legacy game metadata with explicit apply', t => {
  const project = temporary(t);
  const legacy = 'schemaVersion: 2\nproject:\n  slug: old-game\n  title:\n    ru: Старая игра\n  engine: phaser\n  platform: yandex-games\n';
  fs.writeFileSync(path.join(project, 'game-spec.yaml'), legacy);
  fs.writeFileSync(path.join(project, 'package.json'), '{"version":"2.3.1"}\n');
  for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']]) {
    const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const before = fs.readFileSync(path.join(project, 'game-spec.yaml'));
  const preview = cli('migrate', '--project', project, '--json');
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).status, 'READY');
  assert.equal(fs.existsSync(path.join(project, 'ludory.project.json')), false);
  const applied = cli('migrate', '--project', project, '--apply', '--json');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).status, 'APPLIED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'ludory.project.json'))).version, '2.3.1');
  assert.deepEqual(fs.readFileSync(path.join(project, 'game-spec.yaml')), before);
  assert.equal(JSON.parse(cli('inspect', '--project', project, '--json').stdout).status, 'IN_SYNC');
});

test('profiles and templates support read-only list/show with stable JSON', () => {
  const profiles = cli('profiles', 'list', '--json');
  assert.equal(profiles.status, 0, profiles.stderr);
  assert.deepEqual(JSON.parse(profiles.stdout).profiles.map(x => x.id), ['narrative-game', 'web-game']);
  const template = cli('templates', 'show', '--name', 'web-basic', '--json');
  assert.equal(template.status, 0, template.stderr);
  assert.equal(JSON.parse(template.stdout).template.profile, 'web-game');
  assert.match(cli('profiles', 'list').stdout, /web-game/);
  assert.equal(cli('templates', 'show', '--json').status, 1);
  assert.equal(cli('profiles', 'list', '--apply').status, 1);
});

test('create generates files only with --apply and preserves legacy commands', t => {
  const project = temporary(t);
  const args = ['create', '--project', project, '--id', 'my-demo', '--title', 'Демо', '--lang', 'ru',
    '--profile', 'web-game', '--template', 'web-basic', '--targets', 'vk-games,yandex-games', '--json'];
  const preview = cli(...args);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).status, 'READY');
  assert.deepEqual(fs.readdirSync(project), []);
  const applied = cli(...args, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).status, 'APPLIED');
  assert.ok(fs.existsSync(path.join(project, 'src', 'main.js')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'ludory.project.json'))).engine, 'web');
  assert.equal(cli(...args, '--apply').status, 2);
  assert.equal(JSON.parse(cli('inspect', '--project', project, '--json').stdout).status, 'CURRENT');
});

test('create validates profile/template flags and rejects conflicting options', t => {
  const project = temporary(t);
  const args = ['create', '--project', project, '--id', 'my-demo', '--title', 'Demo', '--lang', 'en',
    '--profile', 'web-game', '--template', 'web-basic', '--targets', 'vk-games'];
  assert.equal(cli(...args, '--profile', 'web-game').status, 1);
  assert.equal(cli(...args, '--engine', 'phaser').status, 1);
  assert.equal(cli(...args, '--targets', 'unsupported-platform', '--json').status, 1); // duplicate options
  const targetArgs = args.map((v, i) => i === args.length - 1 ? 'unsupported-platform' : v);
  assert.equal(cli(...targetArgs, '--json').status, 2);
  assert.equal(cli('profiles', 'show', '--name', 'unknown').status, 1);
  assert.deepEqual(fs.readdirSync(project), []);
});

test('profiles apply/update/status preview then explicitly apply in an existing game', t => {
  const project = temporary(t);
  fs.writeFileSync(path.join(project, 'ludory.project.json'), JSON.stringify({
    schemaVersion: 1, id: 'existing', version: '1.0.0', title: { en: 'Existing' },
    engine: 'web', targets: ['vk-games'],
  }));
  fs.writeFileSync(path.join(project, 'owner.txt'), 'my code is mine');
  const args = ['profiles', 'apply', '--project', project, '--name', 'web-game', '--json'];
  const preview = cli(...args);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).status, 'READY');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  const applied = cli(...args, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).status, 'APPLIED');
  const status = cli('profiles', 'status', '--project', project, '--json');
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).status, 'IN_SYNC');
  assert.equal(JSON.parse(status.stdout).profile.id, 'web-game');
  assert.equal(JSON.parse(cli('profiles', 'update', '--project', project, '--json').stdout).status, 'IN_SYNC');
  assert.equal(cli(...args, '--apply').status, 0);
  assert.equal(fs.readFileSync(path.join(project, 'owner.txt'), 'utf8'), 'my code is mine');
});

test('profiles apply rejects incompatible games and malformed operation flags', t => {
  const project = temporary(t);
  fs.writeFileSync(path.join(project, 'ludory.project.json'), JSON.stringify({
    schemaVersion: 1, id: 'existing', version: '1.0.0', title: { en: 'Existing' },
    engine: 'phaser', targets: ['yandex-games'],
  }));
  const blocked = cli('profiles', 'apply', '--project', project, '--name', 'web-game', '--apply', '--json');
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).status, 'BLOCKED');
  assert.equal(cli('profiles', 'status', '--project', project, '--apply').status, 1);
  assert.equal(cli('profiles', 'apply', '--project', project).status, 1);
  assert.equal(cli('profiles', 'update', '--project', project, '--name', 'web-game').status, 1);
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});

function componentFixture(t) {
  const root = temporary(t);
  const project = path.join(root, 'new-game');
  const catalog = path.join(root, 'catalog');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(catalog, 'profiles'), { recursive: true });
  const templateDir = path.join(catalog, 'templates', 'cli-web');
  fs.mkdirSync(path.join(templateDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(catalog, 'profiles', 'cli-game.json'), JSON.stringify({
    schemaVersion: 1, id: 'cli-game', version: '1.0.0', description: 'CLI test profile',
    engine: 'web', targets: ['vk-games'], templates: ['cli-web'],
  }));
  const descriptor = path.join(templateDir, 'template.json');
  fs.writeFileSync(descriptor, JSON.stringify({
    schemaVersion: 1, id: 'cli-web', version: '1.0.0', description: 'CLI test template',
    profile: 'cli-game', engine: 'web', targets: ['vk-games'], files: ['index.html', 'src/main.js'],
  }));
  fs.writeFileSync(path.join(templateDir, 'index.html'), '<main>v1</main>\n');
  fs.writeFileSync(path.join(templateDir, 'src', 'main.js'), 'export const v = 1;\n');
  const created = cli('create', '--project', project, '--id', 'cli-test', '--title', 'CLI test',
    '--lang', 'en', '--profile', 'cli-game', '--template', 'cli-web', '--targets', 'vk-games',
    '--catalog', catalog, '--apply', '--json');
  assert.equal(created.status, 0, created.stderr);
  const upgrade = () => {
    const data = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    data.version = '1.1.0';
    fs.writeFileSync(descriptor, JSON.stringify(data));
    fs.writeFileSync(path.join(templateDir, 'src', 'main.js'), 'export const v = 2;\n');
  };
  return { root, project, catalog, descriptor, upgrade };
}

test('components status and update preview are read-only, apply is explicit and preserves owner data', t => {
  const f = componentFixture(t);
  const args = ['components', 'update', '--project', f.project, '--catalog', f.catalog, '--json'];
  assert.equal(JSON.parse(cli('components', 'status', '--project', f.project, '--catalog', f.catalog, '--json').stdout).status, 'IN_SYNC');
  fs.writeFileSync(path.join(f.project, 'my-assets.txt'), 'author data');
  f.upgrade();
  const before = fs.readFileSync(path.join(f.project, 'src/main.js'), 'utf8');
  const preview = cli(...args);
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(JSON.parse(preview.stdout).writes, ['src/main.js', 'ludory.components.json']);
  assert.equal(JSON.parse(preview.stdout).status, 'READY');
  assert.equal(fs.readFileSync(path.join(f.project, 'src/main.js'), 'utf8'), before);
  const applied = cli(...args, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.status, 'APPLIED');
  assert.equal(fs.readFileSync(path.join(f.project, 'src/main.js'), 'utf8'), 'export const v = 2;\n');
  assert.equal(fs.readFileSync(path.join(f.project, 'my-assets.txt'), 'utf8'), 'author data');
  assert.ok(result.backupDirectory?.startsWith(fs.realpathSync.native(f.project)));
  assert.equal(JSON.parse(cli(...args).stdout).status, 'IN_SYNC');
});

test('components refuse modified files, historical games, and unapproved/invalid flags', t => {
  const f = componentFixture(t);
  f.upgrade();
  fs.writeFileSync(path.join(f.project, 'index.html'), 'editor customisation\n');
  const conflict = cli('components', 'update', '--project', f.project, '--catalog', f.catalog, '--apply', '--json');
  assert.equal(conflict.status, 2, conflict.stderr);
  assert.equal(JSON.parse(conflict.stdout).status, 'CONFLICT');
  assert.equal(fs.readFileSync(path.join(f.project, 'index.html'), 'utf8'), 'editor customisation\n');
  const historical = path.join(f.root, 'historical');
  fs.mkdirSync(historical);
  fs.writeFileSync(path.join(historical, 'ludory.studio.json'), '{}\n');
  assert.equal(JSON.parse(cli('components', 'status', '--project', historical, '--json').stdout).status, 'BLOCKED');
  assert.equal(cli('components', 'update', '--project', historical, '--apply').status, 2);
  assert.equal(cli('components', 'status', '--project', f.project, '--apply').status, 1);
  assert.equal(cli('components', 'update', '--project', f.project, '--force').status, 1);
  assert.equal(cli('components', 'update', '--project', f.project, '--project', f.project).status, 1);
});

test('components operational errors preserve JSON FAILED status and avoid implicit apply', t => {
  const f = componentFixture(t);
  const failed = cli('components', 'update', '--project', path.join(f.root, 'missing'), '--json');
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).status, 'FAILED');
  assert.equal(cli('components', 'unknown', '--project', f.project).status, 1);
});

test('components trust requires an explicit SHA-256 after a host transfer', t => {
  const f = componentFixture(t);
  const originalTrust = process.env.LUDORY_STUDIO_TRUST_DIR;
  process.env.LUDORY_STUDIO_TRUST_DIR = path.join(f.root, 'transferred-host');
  t.after(() => {
    if (originalTrust === undefined) delete process.env.LUDORY_STUDIO_TRUST_DIR;
    else process.env.LUDORY_STUDIO_TRUST_DIR = originalTrust;
  });
  const args = ['components', 'trust', '--project', f.project, '--json'];
  const preview = cli(...args);
  assert.equal(preview.status, 2, preview.stderr);
  const inspected = JSON.parse(preview.stdout);
  assert.equal(inspected.status, 'NEEDS_USER_ACTION');
  assert.deepEqual(inspected.managedPaths, ['index.html', 'src/main.js']);
  const plain = cli('components', 'trust', '--project', f.project);
  assert.match(plain.stdout, /src\/main\.js/);
  assert.match(plain.stdout, new RegExp(inspected.stateSha256));
  assert.match(plain.stdout, /review|inspect|проверь/i);
  assert.equal(cli(...args, '--apply').status, 1);
  assert.equal(cli(...args, '--accept-state-sha256', '0'.repeat(64), '--apply').status, 1);
  const applied = cli(...args, '--accept-state-sha256', inspected.stateSha256, '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).status, 'TRUSTED');
  assert.equal(JSON.parse(cli('components', 'status', '--project', f.project, '--catalog', f.catalog, '--json').stdout).status, 'IN_SYNC');
  assert.equal(JSON.parse(cli(...args).stdout).status, 'IN_SYNC');
});
