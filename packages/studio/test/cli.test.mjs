import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../src/cli.mjs';

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
