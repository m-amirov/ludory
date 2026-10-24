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
