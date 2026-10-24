import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';

const params = {
  id: 'my-story', title: '<script>alert("x")</script> Зима', lang: 'ru',
  version: '1.2.3', profile: 'narrative-game', template: 'narrative-basic', targets: ['yandex-games', 'vk-games'],
};
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

function empty(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-create-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function custom(t) {
  const root = empty(t);
  fs.mkdirSync(path.join(root, 'profiles'));
  fs.mkdirSync(path.join(root, 'templates', 'custom-basic'), { recursive: true });
  fs.mkdirSync(path.join(root, 'templates', 'custom-basic', 'src'));
  fs.writeFileSync(path.join(root, 'profiles', 'custom-game.json'), JSON.stringify({
    schemaVersion: 1, id: 'custom-game', version: '0.1.0', description: 'Custom',
    engine: 'web', targets: ['vk-games'], templates: ['custom-basic'],
  }));
  fs.writeFileSync(path.join(root, 'templates', 'custom-basic', 'template.json'), JSON.stringify({
    schemaVersion: 1, id: 'custom-basic', version: '0.1.0', description: 'Custom',
    profile: 'custom-game', engine: 'web', targets: ['vk-games'], files: ['index.html', 'src/main.js'],
  }));
  fs.writeFileSync(path.join(root, 'templates', 'custom-basic', 'index.html'), '<h1>Custom</h1>');
  fs.writeFileSync(path.join(root, 'templates', 'custom-basic', 'src', 'main.js'), 'console.log("custom");');
  return root;
}

test('creation preview never writes and explicit apply creates runnable files and hash receipt', t => {
  const root = empty(t);
  const cwd = process.cwd();
  const plan = planCreate(root, params);
  assert.equal(plan.status, 'READY', plan.conflicts.join(' '));
  assert.deepEqual(plan.writes, ['ludory.project.json', 'index.html', 'src/main.js', 'ludory.studio.json']);
  assert.deepEqual(fs.readdirSync(root), []);
  const outcome = applyCreatePlan(plan);
  assert.equal(outcome.status, 'APPLIED');
  assert.equal(process.cwd(), cwd);
  assert.equal(fs.readFileSync(path.join(root, 'ludory.project.json'), 'utf8').includes('<script>'), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ludory.project.json')));
  assert.equal(manifest.title.ru, params.title);
  assert.equal(manifest.engine, 'web');
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'ludory.studio.json')));
  assert.deepEqual(receipt.profile, { id: 'narrative-game', version: '1.0.0' });
  assert.deepEqual(receipt.template, { id: 'narrative-basic', version: '1.0.0' });
  assert.deepEqual(Object.keys(receipt.files), ['ludory.project.json', 'index.html', 'src/main.js']);
  for (const [name, sha] of Object.entries(receipt.files)) {
    assert.equal(hash(fs.readFileSync(path.join(root, name))), sha);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'), /<script>/);
});

test('nonempty and nonexistent project roots are never overwritten', t => {
  const root = empty(t);
  fs.writeFileSync(path.join(root, 'owner.txt'), 'owner');
  const plan = planCreate(root, params);
  assert.equal(plan.status, 'BLOCKED');
  assert.deepEqual(fs.readdirSync(root), ['owner.txt']);
  assert.throws(() => applyCreatePlan(plan), /READY/i);
  assert.throws(() => planCreate(path.join(root, 'missing'), params), /directory|ENOENT/i);
});

test('wrong profile/template or targets block before a file is written', t => {
  const root = empty(t);
  const wrong = planCreate(root, { ...params, profile: 'web-game' });
  assert.equal(wrong.status, 'BLOCKED');
  assert.match(wrong.conflicts.join(' '), /profile|template|compatible/i);
  const target = planCreate(root, { ...params, targets: ['unsupported-platform'] });
  assert.equal(target.status, 'BLOCKED');
  assert.deepEqual(fs.readdirSync(root), []);
});

test('external catalog changes after preview block apply', t => {
  const project = empty(t);
  const catalog = custom(t);
  const options = { ...params, profile: 'custom-game', template: 'custom-basic', targets: ['vk-games'], catalog };
  const plan = planCreate(project, options);
  assert.equal(plan.status, 'READY');
  fs.writeFileSync(path.join(catalog, 'templates', 'custom-basic', 'index.html'), '<h1>Injected</h1>');
  assert.throws(() => applyCreatePlan(plan), /stale|changed|hash/i);
  assert.deepEqual(fs.readdirSync(project), []);
});

test('exclusive create conflict and mid-apply failure rollback only owned files', t => {
  const project = empty(t);
  const plan = planCreate(project, params);
  const originalOpen = fs.openSync;
  let writes = 0;
  fs.openSync = function (file, flags, ...rest) {
    if (typeof flags === 'number' && (flags & fs.constants.O_CREAT)) {
      if (++writes === 3) throw Object.assign(new Error('simulated disk write error'), { code: 'EIO' });
    }
    return originalOpen.call(this, file, flags, ...rest);
  };
  try { assert.throws(() => applyCreatePlan(plan), /simulated disk write error/); }
  finally { fs.openSync = originalOpen; }
  assert.equal(writes, 3);
  assert.deepEqual(fs.readdirSync(project), []);
  const racePlan = planCreate(project, params);
  fs.writeFileSync(path.join(project, 'index.html'), 'owned');
  assert.throws(() => applyCreatePlan(racePlan), /stale|conflict|empty/i);
  assert.equal(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), 'owned');
});

test('project root inode and symlink substitution are validated before apply', t => {
  const project = empty(t);
  const plan = planCreate(project, params);
  const moved = `${project}-old`;
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  fs.renameSync(project, moved);
  fs.mkdirSync(project);
  assert.throws(() => applyCreatePlan(plan), /stale|identity|changed/i);
  assert.deepEqual(fs.readdirSync(project), []);
});

test('concurrent user directory creation is not adopted as a Studio-owned output directory', t => {
  const project = empty(t);
  const plan = planCreate(project, params);
  const originalOpen = fs.openSync;
  let intercepted = false;
  fs.openSync = function (filename, flags, ...rest) {
    const handle = originalOpen.call(this, filename, flags, ...rest);
    if (!intercepted && filename === 'ludory.project.json' && (flags & fs.constants.O_CREAT)) {
      intercepted = true;
      fs.mkdirSync('src');
      fs.writeFileSync('src/user.txt', 'owner');
    }
    return handle;
  };
  try { assert.throws(() => applyCreatePlan(plan), /existing|conflict|output directory|unsafe/i); }
  finally { fs.openSync = originalOpen; }
  assert.equal(fs.readFileSync(path.join(project, 'src', 'user.txt'), 'utf8'), 'owner');
  assert.equal(fs.existsSync(path.join(project, 'ludory.project.json')), false);
});

test('partial write failure cleans up its incomplete owned file', t => {
  const project = empty(t);
  const plan = planCreate(project, params);
  const originalWrite = fs.writeFileSync;
  let once = false;
  fs.writeFileSync = function (target, data, ...args) {
    if (!once && typeof target === 'number') {
      once = true;
      originalWrite.call(this, target, data.subarray(0, 5), ...args);
      throw new Error('injected partial write');
    }
    return originalWrite.call(this, target, data, ...args);
  };
  try { assert.throws(() => applyCreatePlan(plan), /injected partial write/); }
  finally { fs.writeFileSync = originalWrite; }
  assert.equal(once, true);
  assert.deepEqual(fs.readdirSync(project), []);
});
