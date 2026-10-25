import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { planComponentUpdate, componentStatus, applyComponentPlan } from '../src/component-updates.mjs';

const transactionPath = value => /\.ludory-components-(?:update|backup)-/.test(String(value));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-components-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'game');
  const catalog = path.join(root, 'catalog');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(catalog, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(catalog, 'templates', 'owned-web', 'src'), { recursive: true });
  fs.writeFileSync(path.join(catalog, 'profiles', 'owned-game.json'), JSON.stringify({
    schemaVersion: 1, id: 'owned-game', version: '1.0.0', description: 'test profile',
    engine: 'web', targets: ['vk-games'], templates: ['owned-web'],
  }));
  const descriptor = path.join(catalog, 'templates', 'owned-web', 'template.json');
  const app = path.join(catalog, 'templates', 'owned-web', 'src', 'main.js');
  const html = path.join(catalog, 'templates', 'owned-web', 'index.html');
  fs.writeFileSync(descriptor, JSON.stringify({
    schemaVersion: 1, id: 'owned-web', version: '1.0.0', description: 'test template',
    profile: 'owned-game', engine: 'web', targets: ['vk-games'], files: ['index.html', 'src/main.js'],
  }));
  fs.writeFileSync(app, 'export const version = 1;\n');
  fs.writeFileSync(html, '<main>v1</main>\n');
  applyCreatePlan(planCreate(project, {
    id: 'owned-game', title: 'Owned', lang: 'en', profile: 'owned-game',
    template: 'owned-web', targets: ['vk-games'], catalog,
  }));
  return { root, project, catalog, descriptor, app, html,
    gameApp: path.join(project, 'src', 'main.js'),
    gameHtml: path.join(project, 'index.html'),
    state: path.join(project, 'ludory.components.json'),
  };
}

function version2(files, { version = '1.1.0', code = 'export const version = 2;\n', extra = false } = {}) {
  const data = JSON.parse(fs.readFileSync(files.descriptor));
  data.version = version;
  if (extra) {
    data.files.push('src/extra.js');
    fs.writeFileSync(path.join(files.catalog, 'templates', 'owned-web', 'src', 'extra.js'), 'export const extra = true;\n');
  }
  fs.writeFileSync(files.descriptor, JSON.stringify(data));
  fs.writeFileSync(files.app, code);
}

test('clean newer catalog previews an entire update without any game writes', t => {
  const f = fixture(t);
  const original = fs.readFileSync(f.gameApp);
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'IN_SYNC');
  version2(f);
  const result = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(result.status, 'READY', result.conflicts?.join(' '));
  assert.deepEqual(result.writes, ['src/main.js', 'ludory.components.json']);
  assert.deepEqual(fs.readFileSync(f.gameApp), original);
  assert.equal(JSON.parse(fs.readFileSync(f.state)).template.version, '1.0.0');
  assert.deepEqual(fs.readdirSync(f.project).sort(), ['index.html', 'ludory.components.json', 'ludory.project.json', 'ludory.studio.json', 'src']);
});

test('any edited or missing managed file blocks the whole update, including otherwise unchanged files', t => {
  const f = fixture(t);
  fs.writeFileSync(f.gameHtml, 'user custom HTML\n');
  version2(f);
  const preview = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(preview.status, 'CONFLICT');
  assert.match(preview.conflicts.join(' '), /index\.html|changed|modified/i);
  assert.deepEqual(preview.writes, []);
  assert.deepEqual(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
  assert.equal(JSON.parse(fs.readFileSync(f.state)).template.version, '1.0.0');

  fs.unlinkSync(f.gameApp);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
});

test('historical receipt is not update authority and corrupted state fails closed', t => {
  const f = fixture(t);
  fs.unlinkSync(f.state);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'BLOCKED');
  fs.writeFileSync(f.state, '{"schemaVersion":1,"files":{"../escape":"x"}}');
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
});

test('same-version drift, downgrades, removed assets and changed game engine block', t => {
  const f = fixture(t);
  version2(f, { version: '1.0.0' });
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  version2(f, { version: '0.9.0' });
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  version2(f);
  const descriptor = JSON.parse(fs.readFileSync(f.descriptor));
  descriptor.files = ['src/main.js'];
  fs.writeFileSync(f.descriptor, JSON.stringify(descriptor));
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  descriptor.files = ['index.html', 'src/main.js'];
  fs.writeFileSync(f.descriptor, JSON.stringify(descriptor));
  const manifest = path.join(f.project, 'ludory.project.json');
  const data = JSON.parse(fs.readFileSync(manifest));
  data.engine = 'phaser';
  fs.writeFileSync(manifest, JSON.stringify(data));
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'BLOCKED');
});

test('catalog cannot silently switch an installed template to another game profile', t => {
  const f = fixture(t);
  version2(f);
  const priorProfile = path.join(f.catalog, 'profiles', 'owned-game.json');
  const moved = JSON.parse(fs.readFileSync(priorProfile));
  moved.id = 'other-game';
  fs.unlinkSync(priorProfile);
  fs.writeFileSync(path.join(f.catalog, 'profiles', 'other-game.json'), JSON.stringify(moved));
  const descriptor = JSON.parse(fs.readFileSync(f.descriptor));
  descriptor.profile = 'other-game';
  fs.writeFileSync(f.descriptor, JSON.stringify(descriptor));
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(plan.status, 'CONFLICT');
  assert.deepEqual(plan.writes, []);
});

test('hyphens inside SemVer prerelease identifiers compare as full prerelease tokens', t => {
  const f = fixture(t);
  const original = JSON.parse(fs.readFileSync(f.state));
  // This test creates a valid, canonical managed state at an existing
  // prerelease version, without changing managed file hashes.
  original.template.version = '1.0.0-alpha-1';
  fs.writeFileSync(f.state, `${JSON.stringify(original, null, 2)}\n`);
  version2(f, { version: '1.0.0-alpha.1' });
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  version2(f, { version: '1.0.0-alpha-2' });
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'READY');
});

test('colliding additions and symbolic managed paths fail without writes', t => {
  const f = fixture(t);
  version2(f, { extra: true });
  const collision = path.join(f.project, 'src', 'extra.js');
  fs.writeFileSync(collision, 'user owned\n');
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  assert.equal(fs.readFileSync(collision, 'utf8'), 'user owned\n');
  fs.unlinkSync(collision);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'READY');
  fs.unlinkSync(f.gameApp);
  fs.symlinkSync(f.gameHtml, f.gameApp);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
});

test('apply updates clean managed files and state, not unrelated owner files', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, 'user.txt'), 'keep me');
  version2(f, { extra: true });
  const planned = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(planned.status, 'READY');
  const applied = applyComponentPlan(planned);
  assert.equal(applied.status, 'APPLIED');
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 2;\n');
  assert.equal(fs.readFileSync(path.join(f.project, 'src/extra.js'), 'utf8'), 'export const extra = true;\n');
  assert.equal(fs.readFileSync(path.join(f.project, 'user.txt'), 'utf8'), 'keep me');
  assert.equal(JSON.parse(fs.readFileSync(f.state)).template.version, '1.1.0');
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'IN_SYNC');
});

test('stale plans cannot overwrite game or catalog changes after preview', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  fs.writeFileSync(f.gameApp, '// user touched\n');
  assert.throws(() => applyComponentPlan(plan), /stale|changed|conflict/i);
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), '// user touched\n');
  fs.writeFileSync(f.gameApp, 'export const version = 1;\n');
  const second = planComponentUpdate(f.project, { catalog: f.catalog });
  fs.writeFileSync(f.app, 'export const version = 3;\n');
  assert.throws(() => applyComponentPlan(second), /stale|changed|conflict/i);
  assert.equal(JSON.parse(fs.readFileSync(f.state)).template.version, '1.0.0');
});

test('manifest mutation immediately after locking aborts before any managed writes', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalOpen = fs.openSync;
  const manifest = path.join(f.project, 'ludory.project.json');
  let injected = false;
  fs.openSync = function (filename, flags, ...args) {
    const fd = originalOpen.call(this, filename, flags, ...args);
    if (!injected && filename === path.join(f.project, '.ludory-components.lock')) {
      injected = true;
      const modified = JSON.parse(fs.readFileSync(manifest));
      modified.version = '9.9.9';
      fs.writeFileSync(manifest, JSON.stringify(modified));
    }
    return fd;
  };
  try { assert.throws(() => applyComponentPlan(plan), /manifest|changed|stale/i); }
  finally { fs.openSync = originalOpen; }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
  assert.equal(JSON.parse(fs.readFileSync(f.state)).template.version, '1.0.0');
});

test('incomplete transaction markers block both status and update preview', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.project, '.ludory-components-update-manual'));
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
});

test('failed second managed replacement rolls back first and retains user data', t => {
  const f = fixture(t);
  version2(f);
  fs.writeFileSync(f.html, '<main>v2</main>\n');
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalLink = fs.linkSync;
  let count = 0;
  fs.linkSync = function (src, dst, ...args) {
    if (transactionPath(src) && ++count === 2) {
      throw new Error('injected second link failure');
    }
    return originalLink.call(this, src, dst, ...args);
  };
  try { assert.throws(() => applyComponentPlan(plan), /injected second link failure/); }
  finally { fs.linkSync = originalLink; }
  assert.equal(fs.readFileSync(f.gameHtml, 'utf8'), '<main>v1</main>\n');
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
  assert.equal(JSON.parse(fs.readFileSync(f.state)).template.version, '1.0.0');
});

test('completed rollback retains the original inode for later edits through an open handle', t => {
  const f = fixture(t);
  version2(f);
  fs.writeFileSync(f.html, '<main>v2</main>\n');
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const fd = fs.openSync(f.gameHtml, 'r+');
  const originalLink = fs.linkSync;
  let failed = false;
  fs.linkSync = function (src, dst, ...args) {
    if (!failed && transactionPath(src) && dst === 'main.js') {
      failed = true;
      throw new Error('simulated publish failure');
    }
    return originalLink.call(this, src, dst, ...args);
  };
  try {
    assert.throws(() => applyComponentPlan(plan), /simulated publish failure/);
    const edit = Buffer.from('LATE HANDLE EDIT AFTER ROLLBACK\n');
    fs.writeSync(fd, edit, 0, edit.length, 0);
  } finally { fs.linkSync = originalLink; fs.closeSync(fd); }
  assert.equal(fs.readFileSync(f.gameHtml, 'utf8'), '<main>v1</main>\n');
  const archives = fs.readdirSync(f.project).filter(name => name.startsWith('.ludory-components-backup-'));
  assert.equal(archives.length, 1);
  const archive = path.join(f.project, archives[0]);
  const entries = JSON.parse(fs.readFileSync(path.join(archive, 'backup-index.json'), 'utf8')).entries;
  const original = entries.find(item => item.path === 'index.html');
  assert.match(fs.readFileSync(path.join(archive, original.backup), 'utf8'), /LATE HANDLE EDIT/);
  assert.equal(fs.existsSync(path.join(f.project, '.ludory-components.lock')), false);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'READY');
});

test('secondary finalization failure retains the original publish error and lock', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalLink = fs.linkSync;
  const originalUnlink = fs.unlinkSync;
  fs.linkSync = function (src, dst, ...args) {
    if (transactionPath(src) && dst === 'main.js') {
      throw new Error('simulated publish failure');
    }
    return originalLink.call(this, src, dst, ...args);
  };
  fs.unlinkSync = function (filename, ...args) {
    if (filename === path.join(f.project, '.ludory-components.lock')) {
      throw new Error('simulated final lock release failure');
    }
    return originalUnlink.call(this, filename, ...args);
  };
  let error;
  try { assert.throws(() => applyComponentPlan(plan), caught => (error = caught, /simulated publish failure/.test(caught.message))); }
  finally { fs.linkSync = originalLink; fs.unlinkSync = originalUnlink; }
  assert.match(error.message, /finalization blocked/i);
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
  assert.equal(JSON.parse(fs.readFileSync(f.state)).template.version, '1.0.0');
  assert.equal(fs.existsSync(path.join(f.project, '.ludory-components.lock')), true);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  assert.equal(fs.readdirSync(f.project).some(name => name.startsWith('.ludory-components-backup-')), true);
});

test('restore failure retains the original backup and lock for manual recovery', t => {
  const f = fixture(t);
  version2(f);
  fs.writeFileSync(path.join(f.project, 'user.txt'), 'owner data');
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalLink = fs.linkSync;
  const originalCopy = fs.copyFileSync;
  fs.linkSync = function (src, dst, ...args) {
    if (transactionPath(src) && dst === 'ludory.components.json') {
      throw new Error('simulated state publish failure');
    }
    return originalLink.call(this, src, dst, ...args);
  };
  fs.copyFileSync = function (source, destination, ...args) {
    if (String(source).includes(`${path.sep}backup${path.sep}`) && destination === 'main.js') {
      throw new Error('simulated restore failure');
    }
    return originalCopy.call(this, source, destination, ...args);
  };
  try { assert.throws(() => applyComponentPlan(plan), /simulated state publish failure; incomplete component rollback:.*simulated restore failure/i); }
  finally { fs.linkSync = originalLink; fs.copyFileSync = originalCopy; }
  const archive = fs.readdirSync(f.project).find(name => name.startsWith('.ludory-components-backup-'));
  assert.ok(archive);
  const index = JSON.parse(fs.readFileSync(path.join(f.project, archive, 'backup-index.json'), 'utf8'));
  const original = index.entries.find(item => item.path === 'src/main.js');
  assert.equal(fs.readFileSync(path.join(f.project, archive, original.backup), 'utf8'), 'export const version = 1;\n');
  assert.equal(fs.readFileSync(path.join(f.project, 'user.txt'), 'utf8'), 'owner data');
  assert.equal(fs.existsSync(path.join(f.project, '.ludory-components.lock')), true);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
});

test('swapped nested directory cannot redirect a managed replacement outside the game', t => {
  const f = fixture(t);
  version2(f);
  const outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'main.js'), 'outside user code\n');
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalRename = fs.renameSync;
  let swapped = false;
  let outsideTemporarilyMoved = false;
  fs.renameSync = function (source, destination, ...args) {
    if (!swapped && (String(source).endsWith(path.join('src', 'main.js')) || /[\\/]main\.js$/.test(String(source)) || source === 'main.js')) {
      swapped = true;
      originalRename.call(this, path.join(f.project, 'src'), path.join(f.project, 'src-saved'));
      fs.symlinkSync(outside, path.join(f.project, 'src'), 'dir');
    }
    const output = originalRename.call(this, source, destination, ...args);
    if (swapped && !fs.existsSync(path.join(outside, 'main.js'))) outsideTemporarilyMoved = true;
    return output;
  };
  try { assert.throws(() => applyComponentPlan(plan), /changed|unsafe|rollback|conflict|symbolic|resource busy|EBUSY|EPERM/i); }
  finally { fs.renameSync = originalRename; }
  assert.equal(swapped, true);
  assert.equal(outsideTemporarilyMoved, false, 'No external file may be temporarily moved, even when rollback restores it');
  assert.equal(fs.readFileSync(path.join(outside, 'main.js'), 'utf8'), 'outside user code\n');
  assert.equal(JSON.parse(fs.readFileSync(f.state)).template.version, '1.0.0');
  const substitutionApplied = fs.lstatSync(path.join(f.project, 'src')).isSymbolicLink();
  // Windows can refuse the directory rename before the substitution exists.
  // Once a symlink exists, recovery cannot safely republish the retained
  // original, so the lock must prevent a second update from claiming success.
  assert.equal(fs.existsSync(path.join(f.project, '.ludory-components.lock')), substitutionApplied);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, substitutionApplied ? 'CONFLICT' : 'READY');
});

test('open editor descriptor modifying an original during apply cannot lose the edit', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const fd = fs.openSync(f.gameApp, 'r+');
  const originalLink = fs.linkSync;
  let wrote = false;
  fs.linkSync = function (source, dest, ...args) {
    if (!wrote && transactionPath(source) && dest === 'main.js') {
      wrote = true;
      const edit = Buffer.from('USER WRITING THROUGH OLD HANDLE\n');
      fs.writeSync(fd, edit, 0, edit.length, 0);
    }
    return originalLink.call(this, source, dest, ...args);
  };
  try { assert.throws(() => applyComponentPlan(plan), /changed|rollback|concurrent|edited/i); }
  finally { fs.linkSync = originalLink; fs.closeSync(fd); }
  assert.equal(wrote, true);
  assert.match(fs.readFileSync(f.gameApp, 'utf8'), /USER WRITING THROUGH OLD HANDLE/);
});

test('successful updates preserve the original inode for edits arriving after commit', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const fd = fs.openSync(f.gameApp, 'r+');
  let applied;
  try {
    applied = applyComponentPlan(plan);
    assert.equal(applied.status, 'APPLIED');
    const edit = Buffer.from('LATE USER EDIT THROUGH OLD HANDLE\n');
    fs.writeSync(fd, edit, 0, edit.length, 0);
  } finally { fs.closeSync(fd); }
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 2;\n');
  assert.match(fs.readFileSync(path.join(applied.backupDirectory, 'backup', '0'), 'utf8'), /LATE USER EDIT/);
  const index = JSON.parse(fs.readFileSync(path.join(applied.backupDirectory, 'backup-index.json'), 'utf8'));
  assert.deepEqual(index.entries.map(({ path: name, backup }) => [name, backup]), [
    ['src/main.js', 'backup/0'],
    ['ludory.components.json', 'backup/1'],
  ]);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'IN_SYNC');
});

test('rollback must not delete user changes arriving between verification and removal', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalLink = fs.linkSync;
  const originalRead = fs.readFileSync;
  let rollback = false;
  let userEdit = false;
  fs.linkSync = function (source, dest, ...args) {
    if (!rollback && transactionPath(source) && dest === 'ludory.components.json') {
      rollback = true;
      throw new Error('simulated publish failure');
    }
    return originalLink.call(this, source, dest, ...args);
  };
  fs.readFileSync = function (filename, ...args) {
    const bytes = originalRead.call(this, filename, ...args);
    if (rollback && !userEdit && filename === 'main.js') {
      userEdit = true;
      fs.writeFileSync(filename, 'USER EDIT DURING ROLLBACK\n');
    }
    return bytes;
  };
  try { assert.throws(() => applyComponentPlan(plan), /incomplete.*rollback|user edit|modified/i); }
  finally { fs.linkSync = originalLink; fs.readFileSync = originalRead; }
  assert.equal(userEdit, true);
  assert.match(fs.readFileSync(f.gameApp, 'utf8'), /USER EDIT DURING ROLLBACK/);
  assert.equal(fs.existsSync(path.join(f.project, '.ludory-components.lock')), true);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
});
