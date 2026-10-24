import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planMigration, planInit, applyPlan } from '../src/projects.mjs';

const spec = `schemaVersion: 2
project:
  slug: winter-story
  title:
    ru: Зимняя история
  platform: yandex-games
  engine: phaser
game:
  genre: narrative
`;

function command(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
}

function fixture(t, { git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-migrate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'game-spec.yaml'), spec);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"winter-story","version":"1.2.3"}\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'main.js'), 'game code must be preserved\n');
  if (git) {
    command(dir, 'init', '-b', 'main');
    command(dir, 'config', 'user.name', 'Studio Test');
    command(dir, 'config', 'user.email', 'studio@example.invalid');
    command(dir, 'add', '.');
    command(dir, 'commit', '-m', 'fixture baseline');
  }
  return dir;
}

test('migration preview is read-only, apply creates one file and repeated plan is in sync', t => {
  const dir = fixture(t);
  const callerCwd = process.cwd();
  const originals = ['game-spec.yaml', 'package.json', 'src/main.js'].map(f => fs.readFileSync(path.join(dir, f)));
  const plan = planMigration(dir);
  assert.equal(plan.status, 'READY');
  assert.deepEqual(plan.writes, ['ludory.project.json']);
  assert.equal(fs.existsSync(path.join(dir, 'ludory.project.json')), false);
  assert.equal(applyPlan(plan).status, 'APPLIED');
  assert.equal(process.cwd(), callerCwd);
  const actual = JSON.parse(fs.readFileSync(path.join(dir, 'ludory.project.json'), 'utf8'));
  assert.equal(actual.id, 'winter-story');
  assert.deepEqual(actual.targets, ['yandex-games']);
  assert.equal(planMigration(dir).status, 'IN_SYNC');
  ['game-spec.yaml', 'package.json', 'src/main.js'].forEach((f, i) => assert.deepEqual(fs.readFileSync(path.join(dir, f)), originals[i]));
});

test('dirty and non-Git mature projects stay blocked with zero writes', t => {
  const dir = fixture(t);
  fs.appendFileSync(path.join(dir, 'src/main.js'), 'dirty user work\n');
  const dirty = planMigration(dir);
  assert.equal(dirty.status, 'BLOCKED');
  assert.match(dirty.conflicts.join(' '), /dirty/i);
  assert.equal(fs.existsSync(path.join(dir, 'ludory.project.json')), false);
  const noGit = fixture(t, { git: false });
  assert.equal(planMigration(noGit).status, 'BLOCKED');
  assert.equal(fs.existsSync(path.join(noGit, 'ludory.project.json')), false);
});

test('ignored untracked legacy metadata cannot be adopted even when Git status is clean', t => {
  const dir = fixture(t, { git: false });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'game-spec.yaml\npackage.json\n');
  command(dir, 'init', '-b', 'main');
  command(dir, 'config', 'user.name', 'Studio Test');
  command(dir, 'config', 'user.email', 'studio@example.invalid');
  command(dir, 'add', '.');
  command(dir, 'commit', '-m', 'metadata intentionally ignored');
  const plan = planMigration(dir);
  assert.equal(plan.status, 'BLOCKED');
  assert.match(plan.conflicts.join(' '), /tracked|Git|source/i);
  assert.equal(fs.existsSync(path.join(dir, 'ludory.project.json')), false);
});

test('a manifest ignored by Git cannot be adopted as versioned project metadata', t => {
  const dir = fixture(t, { git: false });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ludory.project.json\n');
  command(dir, 'init', '-b', 'main');
  command(dir, 'config', 'user.name', 'Studio Test');
  command(dir, 'config', 'user.email', 'studio@example.invalid');
  command(dir, 'add', '.');
  command(dir, 'commit', '-m', 'baseline with ignored output');
  const plan = planMigration(dir);
  assert.equal(plan.status, 'BLOCKED');
  assert.match(plan.conflicts.join(' '), /ignore|manifest/i);
  assert.equal(fs.existsSync(path.join(dir, 'ludory.project.json')), false);
});

test('skip-worktree cannot conceal local metadata divergence from committed HEAD', t => {
  const dir = fixture(t);
  command(dir, 'update-index', '--skip-worktree', 'game-spec.yaml');
  fs.writeFileSync(path.join(dir, 'game-spec.yaml'), spec.replace('winter-story', 'different-game'));
  const clean = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
  assert.equal(clean.stdout.trim(), '');
  const plan = planMigration(dir);
  assert.equal(plan.status, 'BLOCKED');
  assert.match(plan.conflicts.join(' '), /HEAD|source|diverg/i);
  assert.equal(fs.existsSync(path.join(dir, 'ludory.project.json')), false);
});

test('assume-unchanged cannot conceal local metadata edits', t => {
  const dir = fixture(t);
  command(dir, 'update-index', '--assume-unchanged', 'game-spec.yaml');
  fs.writeFileSync(path.join(dir, 'game-spec.yaml'), spec.replace('winter-story', 'different-game'));
  assert.equal(planMigration(dir).status, 'BLOCKED');
});

test('clean CRLF working files with LF Git blobs can be safely adopted', t => {
  const dir = fixture(t, { git: false });
  fs.writeFileSync(path.join(dir, '.gitattributes'), '* text eol=crlf\n');
  fs.writeFileSync(path.join(dir, 'game-spec.yaml'), spec.replace(/\n/g, '\r\n'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"1.2.3"}\r\n');
  command(dir, 'init', '-b', 'main');
  command(dir, 'config', 'user.name', 'Studio Test');
  command(dir, 'config', 'user.email', 'studio@example.invalid');
  command(dir, 'add', '.');
  command(dir, 'commit', '-m', 'CRLF checkout baseline');
  const plan = planMigration(dir);
  assert.equal(plan.status, 'READY', plan.conflicts.join('; '));
});

test('migration verifies exact HEAD paths for a game nested inside a larger Git repository', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-nested-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = path.join(parent, 'games', 'winter-story');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'game-spec.yaml'), spec);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"1.2.3"}\n');
  command(parent, 'init', '-b', 'main');
  command(parent, 'config', 'user.name', 'Studio Test');
  command(parent, 'config', 'user.email', 'studio@example.invalid');
  command(parent, 'add', '.');
  command(parent, 'commit', '-m', 'nested game baseline');
  const plan = planMigration(dir);
  assert.equal(plan.status, 'READY', plan.conflicts.join('; '));
  assert.equal(applyPlan(plan).status, 'APPLIED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'ludory.project.json'))).id, 'winter-story');
});

test('existing canonical conflict and symlink target cannot be overwritten', t => {
  const dir = fixture(t);
  const file = path.join(dir, 'ludory.project.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, id: 'different', version: '1.2.3', title: { en: 'Other' }, engine: 'phaser', targets: ['yandex-games'] }));
  const before = fs.readFileSync(file);
  assert.equal(planMigration(dir).status, 'CONFLICT');
  assert.deepEqual(fs.readFileSync(file), before);

  fs.unlinkSync(file);
  fs.symlinkSync(path.join(dir, 'package.json'), file);
  assert.equal(planMigration(dir).status, 'BLOCKED');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'package.json')), Buffer.from('{"name":"winter-story","version":"1.2.3"}\n'));
});

test('adopted metadata compares localized titles semantically regardless of JSON key order', t => {
  const dir = fixture(t, { git: false });
  fs.writeFileSync(path.join(dir, 'game-spec.yaml'), spec.replace('    ru: Зимняя история', '    ru: Зимняя история\n    en: Winter Story'));
  fs.writeFileSync(path.join(dir, 'ludory.project.json'), JSON.stringify({
    schemaVersion: 1, id: 'winter-story', version: '1.2.3',
    title: { en: 'Winter Story', ru: 'Зимняя история' },
    engine: 'phaser', targets: ['yandex-games'],
  }));
  assert.equal(planMigration(dir).status, 'IN_SYNC');
});

test('stale source changes or new Git commit after planning refuse apply', t => {
  const dir = fixture(t);
  const plan = planMigration(dir);
  fs.appendFileSync(path.join(dir, 'game-spec.yaml'), '\n# edited after preview\n');
  assert.throws(() => applyPlan(plan), /stale|changed|dirty/i);
  assert.equal(fs.existsSync(path.join(dir, 'ludory.project.json')), false);

  const second = fixture(t);
  const secondPlan = planMigration(second);
  command(second, 'commit', '--allow-empty', '-m', 'new head');
  assert.throws(() => applyPlan(secondPlan), /HEAD|stale|changed/i);
  assert.equal(fs.existsSync(path.join(second, 'ludory.project.json')), false);
});

test('new-project init only targets an empty existing directory', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-init-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = { schemaVersion: 1, id: 'new-game', version: '0.1.0', title: { ru: 'Новая игра' }, engine: 'phaser', targets: ['yandex-games', 'vk-games'] };
  const plan = planInit(dir, input);
  assert.equal(plan.status, 'READY');
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(applyPlan(plan).status, 'APPLIED');
  assert.deepEqual(fs.readdirSync(dir), ['ludory.project.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'ludory.project.json'))), input);
  assert.equal(planInit(dir, input).status, 'BLOCKED');
});

test('race-created manifest between preview and apply remains untouched', t => {
  const dir = fixture(t);
  const plan = planMigration(dir);
  const file = path.join(dir, 'ludory.project.json');
  fs.writeFileSync(file, '{"user":"owns this file"}\n');
  assert.throws(() => applyPlan(plan), /stale|conflict|existing/i);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"user":"owns this file"}\n');
});

test('directory symlink substitution at write boundary cannot redirect manifest creation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-dir-race-'));
  const parked = `${dir}-parked`;
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-redirect-'));
  t.after(() => {
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) fs.unlinkSync(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(parked, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  });
  const definition = { schemaVersion: 1, id: 'race-game', version: '0.1.0', title: { en: 'Race Game' }, engine: 'phaser', targets: ['vk-games'] };
  const plan = planInit(dir, definition);
  const callerCwd = process.cwd();
  assert.equal(plan.status, 'READY');
  const originalWrite = fs.writeFileSync;
  let swapped = false;
  fs.writeFileSync = function (file, ...args) {
    if (!swapped && String(file).endsWith('ludory.project.json')) {
      process.chdir(path.dirname(dir));
      fs.renameSync(dir, parked);
      fs.symlinkSync(other, dir, 'dir');
      process.chdir(parked);
      swapped = true;
    }
    return originalWrite.call(this, file, ...args);
  };
  try {
    assert.throws(() => applyPlan(plan), /moved|stale|directory|symlink|conflict/i);
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(swapped, true);
  assert.equal(process.cwd(), callerCwd);
  assert.equal(fs.existsSync(path.join(other, 'ludory.project.json')), false);
});

test('directory replacement before chdir is detected without off-target writes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-chdir-race-'));
  const parked = `${dir}-parked`;
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-other-'));
  t.after(() => {
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) fs.unlinkSync(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(parked, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  });
  const definition = { schemaVersion: 1, id: 'race-2', version: '0.1.0', title: { en: 'Race' }, engine: 'phaser', targets: ['vk-games'] };
  const plan = planInit(dir, definition);
  const callerCwd = process.cwd();
  const originalChdir = process.chdir;
  let swapped = false;
  process.chdir = function (target) {
    if (!swapped && target === dir) {
      fs.renameSync(dir, parked);
      fs.symlinkSync(other, dir, 'dir');
      swapped = true;
    }
    return originalChdir.call(process, target);
  };
  try {
    assert.throws(() => applyPlan(plan), /changed|stale|directory/i);
  } finally {
    process.chdir = originalChdir;
  }
  assert.equal(swapped, true);
  assert.equal(process.cwd(), callerCwd);
  assert.equal(fs.existsSync(path.join(other, 'ludory.project.json')), false);
});
