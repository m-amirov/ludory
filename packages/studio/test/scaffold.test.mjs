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

test('replacing a nested output directory cannot redirect file creation outside project', t => {
  const project = empty(t);
  const outside = empty(t);
  const plan = planCreate(project, { ...params, profile: 'web-game', template: 'web-basic' });
  const originalOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function (filename, flags, ...args) {
    if (!swapped && typeof filename === 'string' && filename.endsWith('main.js') && (flags & fs.constants.O_CREAT)) {
      fs.renameSync(path.join(project, 'src'), path.join(project, 'src-original'));
      fs.symlinkSync(outside, path.join(project, 'src'), 'dir');
      swapped = true;
    }
    return originalOpen.call(this, filename, flags, ...args);
  };
  try { assert.throws(() => applyCreatePlan(plan), /changed|moved|directory|stale|unsafe|incomplete/i); }
  finally { fs.openSync = originalOpen; }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(path.join(outside, 'main.js')), false);
});

test('valid filename __proto__ is included in creation receipt', t => {
  const project = empty(t);
  const catalog = custom(t);
  const descriptorPath = path.join(catalog, 'templates', 'custom-basic', 'template.json');
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath));
  descriptor.files = ['__proto__'];
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor));
  fs.writeFileSync(path.join(catalog, 'templates', 'custom-basic', '__proto__'), 'safe filename');
  const plan = planCreate(project, { ...params, profile: 'custom-game', template: 'custom-basic', targets: ['vk-games'], catalog });
  assert.equal(plan.status, 'READY');
  applyCreatePlan(plan);
  const receipt = JSON.parse(fs.readFileSync(path.join(project, 'ludory.studio.json')));
  assert.equal(Object.hasOwn(receipt.files, '__proto__'), true);
  assert.equal(receipt.files.__proto__, hash(fs.readFileSync(path.join(project, '__proto__'))));
});

test('rollback retains previously completed files modified by a user after creation', t => {
  const project = empty(t);
  const plan = planCreate(project, params);
  const originalOpen = fs.openSync;
  let modified = false;
  fs.openSync = function (filename, flags, ...args) {
    if (!modified && filename === 'index.html' && (flags & fs.constants.O_CREAT)) {
      modified = true;
      fs.truncateSync(path.join(project, 'ludory.project.json'), 5);
      throw new Error('injected later failure');
    }
    return originalOpen.call(this, filename, flags, ...args);
  };
  try { assert.throws(() => applyCreatePlan(plan), /incomplete rollback|modified output retained/i); }
  finally { fs.openSync = originalOpen; }
  assert.equal(modified, true);
  assert.equal(fs.readFileSync(path.join(project, 'ludory.project.json')).length, 5);
});

test('two-level output parent substitution cannot escape through an unverified ancestor', t => {
  const project = empty(t);
  const outside = empty(t);
  const catalog = custom(t);
  const templateRoot = path.join(catalog, 'templates', 'custom-basic');
  fs.mkdirSync(path.join(templateRoot, 'src', 'nested'));
  fs.writeFileSync(path.join(templateRoot, 'src', 'nested', 'main.js'), 'safe bytes');
  const descriptorFile = path.join(templateRoot, 'template.json');
  const descriptor = JSON.parse(fs.readFileSync(descriptorFile));
  descriptor.files = ['src/nested/main.js'];
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  fs.mkdirSync(path.join(outside, 'nested'));
  const plan = planCreate(project, { ...params, profile: 'custom-game', template: 'custom-basic', catalog, targets: ['vk-games'] });
  const originalLstat = fs.lstatSync;
  let changed = false;
  fs.lstatSync = function (filename, ...args) {
    if (!changed && filename === 'src/nested') {
      fs.renameSync(path.join(project, 'src'), path.join(project, 'src-original'));
      fs.symlinkSync(outside, path.join(project, 'src'), 'dir');
      changed = true;
    }
    return originalLstat.call(this, filename, ...args);
  };
  try { assert.throws(() => applyCreatePlan(plan), /directory|moved|unsafe|changed|incomplete/i); }
  finally { fs.lstatSync = originalLstat; }
  assert.equal(changed, true);
  assert.equal(fs.existsSync(path.join(outside, 'nested', 'main.js')), false);
});

test('rollback rechecks root inode after chdir to avoid deleting a matching outside hardlink', t => {
  const project = empty(t);
  const parked = `${project}-parked`;
  const outside = empty(t);
  t.after(() => {
    if (fs.existsSync(project) && fs.lstatSync(project).isSymbolicLink()) fs.unlinkSync(project);
    fs.rmSync(parked, { recursive: true, force: true });
  });
  const plan = planCreate(project, params);
  const originalOpen = fs.openSync;
  const originalChdir = process.chdir;
  let failWrite = false;
  let swapped = false;
  fs.openSync = function (filename, flags, ...args) {
    if (!failWrite && filename === 'index.html' && (flags & fs.constants.O_CREAT)) {
      failWrite = true;
      throw new Error('simulate apply failure');
    }
    return originalOpen.call(this, filename, flags, ...args);
  };
  process.chdir = function (target) {
    if (failWrite && !swapped && target === project) {
      fs.renameSync(project, parked);
      fs.symlinkSync(outside, project, 'dir');
      fs.linkSync(path.join(parked, 'ludory.project.json'), path.join(outside, 'ludory.project.json'));
      swapped = true;
    }
    return originalChdir.call(process, target);
  };
  try { assert.throws(() => applyCreatePlan(plan), /failure|moved|directory/i); }
  finally { fs.openSync = originalOpen; process.chdir = originalChdir; }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(path.join(outside, 'ludory.project.json')), true);
});

test('nested mkdir remains anchored when earlier output directory is swapped for a symlink', t => {
  const project = empty(t);
  const outside = empty(t);
  const catalog = custom(t);
  const templateRoot = path.join(catalog, 'templates', 'custom-basic');
  fs.mkdirSync(path.join(templateRoot, 'src', 'nested'));
  fs.writeFileSync(path.join(templateRoot, 'src', 'nested', 'main.js'), 'safe bytes');
  const descriptorFile = path.join(templateRoot, 'template.json');
  const descriptor = JSON.parse(fs.readFileSync(descriptorFile));
  descriptor.files = ['src/nested/main.js'];
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  const plan = planCreate(project, { ...params, profile: 'custom-game', template: 'custom-basic', targets: ['vk-games'], catalog });
  const originalMkdir = fs.mkdirSync;
  let swapped = false;
  let createdOutside = false;
  fs.mkdirSync = function (filename, ...args) {
    if (!swapped && (filename === 'src/nested' || filename === 'nested')) {
      fs.renameSync(path.join(project, 'src'), path.join(project, 'src-original'));
      fs.symlinkSync(outside, path.join(project, 'src'), 'dir');
      swapped = true;
    }
    const result = originalMkdir.call(this, filename, ...args);
    if (swapped) createdOutside ||= fs.existsSync(path.join(outside, 'nested'));
    return result;
  };
  try { assert.throws(() => applyCreatePlan(plan), /directory|changed|incomplete|moved/i); }
  finally { fs.mkdirSync = originalMkdir; }
  assert.equal(swapped, true);
  assert.equal(createdOutside, false, 'directory must never be created outside the validated root, even transiently');
  assert.equal(fs.existsSync(path.join(outside, 'nested')), false);
});

test('rollback removes nested directories from their pinned parent, not a replaced ancestor path', t => {
  const project = empty(t);
  const outside = empty(t);
  const catalog = custom(t);
  const templateRoot = path.join(catalog, 'templates', 'custom-basic');
  fs.mkdirSync(path.join(templateRoot, 'src', 'nested'));
  fs.writeFileSync(path.join(templateRoot, 'src', 'nested', 'main.js'), 'safe bytes');
  const descriptorFile = path.join(templateRoot, 'template.json');
  const descriptor = JSON.parse(fs.readFileSync(descriptorFile));
  descriptor.files = ['src/nested/main.js'];
  fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
  fs.mkdirSync(path.join(outside, 'nested'));
  const plan = planCreate(project, { ...params, profile: 'custom-game', template: 'custom-basic', targets: ['vk-games'], catalog });
  const originalOpen = fs.openSync;
  const originalRmdir = fs.rmdirSync;
  let swapped = false;
  fs.openSync = function (filename, flags, ...args) {
    if (filename === 'ludory.studio.json' && (flags & fs.constants.O_CREAT)) throw new Error('simulated receipt failure');
    return originalOpen.call(this, filename, flags, ...args);
  };
  fs.rmdirSync = function (filename, ...args) {
    if (!swapped && (filename === 'src/nested' || filename === 'nested')) {
      fs.renameSync(path.join(project, 'src'), path.join(project, 'src-original'));
      fs.symlinkSync(outside, path.join(project, 'src'), 'dir');
      swapped = true;
    }
    return originalRmdir.call(this, filename, ...args);
  };
  try { assert.throws(() => applyCreatePlan(plan), /receipt failure|rollback|directory/i); }
  finally { fs.openSync = originalOpen; fs.rmdirSync = originalRmdir; }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(path.join(outside, 'nested')), true);
});
