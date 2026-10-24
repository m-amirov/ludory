import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planProfileApply, planProfileUpdate, profileStatus, applyProfilePlan } from '../src/profile-management.mjs';

function temporary(t, prefix = 'ludory-existing-profile-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function existingGame(t, overrides = {}) {
  const project = temporary(t);
  const manifest = {
    schemaVersion: 1,
    id: 'existing-game',
    version: '1.0.0',
    title: { ru: 'Существующая игра' },
    engine: 'web',
    targets: ['yandex-games'],
    ...overrides,
  };
  fs.writeFileSync(path.join(project, 'ludory.project.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(project, 'game-spec.yaml'), 'important legacy rules\n');
  fs.writeFileSync(path.join(project, 'AGENTS.md'), 'project-owned instructions\n');
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'user-authored code\n');
  return project;
}

function customCatalog(t, version = '1.0.0', description = 'External profile') {
  const dir = temporary(t, 'ludory-existing-profile-catalog-');
  fs.mkdirSync(path.join(dir, 'profiles'));
  fs.mkdirSync(path.join(dir, 'templates', 'custom-basic'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'profiles', 'custom-game.json'), JSON.stringify({
    schemaVersion: 1, id: 'custom-game', version, description,
    engine: 'web', targets: ['yandex-games'], templates: ['custom-basic'],
  }));
  fs.writeFileSync(path.join(dir, 'templates', 'custom-basic', 'template.json'), JSON.stringify({
    schemaVersion: 1, id: 'custom-basic', version: '1.0.0', description: 'Custom',
    profile: 'custom-game', engine: 'web', targets: ['yandex-games'], files: ['index.html'],
  }));
  fs.writeFileSync(path.join(dir, 'templates', 'custom-basic', 'index.html'), '<h1>not used</h1>');
  return dir;
}

function changeProfile(catalog, patch) {
  const file = path.join(catalog, 'profiles', 'custom-game.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...patch }));
}

const preservedNames = ['ludory.project.json', 'game-spec.yaml', 'AGENTS.md', 'src/main.js'];
const preserved = root => preservedNames.map(name => fs.readFileSync(path.join(root, name), 'utf8'));

test('read-only apply preview supports nonempty games and never changes product files', t => {
  const root = existingGame(t);
  const before = preserved(root);
  const plan = planProfileApply(root, { name: 'web-game' });
  assert.equal(plan.status, 'READY', JSON.stringify(plan.conflicts));
  assert.equal(plan.profile.id, 'web-game');
  assert.deepEqual(preserved(root), before);
  assert.equal(fs.existsSync(path.join(root, '.ludory')), false);
});

test('unsupported engine, targets and missing canonical manifest block adoption', t => {
  const wrongEngine = existingGame(t, { engine: 'phaser' });
  const wrongTargets = existingGame(t, { targets: ['unlisted-platform'] });
  const missing = temporary(t);
  assert.equal(planProfileApply(wrongEngine, { name: 'web-game' }).status, 'BLOCKED');
  assert.equal(planProfileApply(wrongTargets, { name: 'web-game' }).status, 'BLOCKED');
  assert.equal(planProfileApply(missing, { name: 'web-game' }).status, 'BLOCKED');
});

test('foreign Studio profile state is never adopted as Ludory-owned', t => {
  const root = existingGame(t);
  fs.mkdirSync(path.join(root, '.ludory', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ludory', 'profiles', 'foreign.txt'), 'owner bytes');
  const plan = planProfileApply(root, { name: 'web-game' });
  assert.equal(plan.status, 'CONFLICT');
  assert.equal(fs.readFileSync(path.join(root, '.ludory', 'profiles', 'foreign.txt'), 'utf8'), 'owner bytes');
});

test('first upgrade refuses foreign history and revision directories without adopting them', t => {
  for (const directoryName of ['history', 'revisions']) {
    const root = existingGame(t);
    const catalog = customCatalog(t);
    assert.equal(applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog })).status, 'APPLIED');
    const foreign = path.join(root, '.ludory', 'profiles', directoryName);
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'foreign.txt'), 'OWNER-BYTES\n');
    changeProfile(catalog, { version: '1.0.1' });
    assert.equal(planProfileUpdate(root, { catalog }).status, 'CONFLICT', directoryName);
    assert.equal(fs.readFileSync(path.join(foreign, 'foreign.txt'), 'utf8'), 'OWNER-BYTES\n');
    assert.equal(fs.existsSync(path.join(root, '.ludory', 'profiles', 'revisions', '00000001.json')), false);
  }
});

test('successful apply only writes Ludory state and is idempotent', t => {
  const root = existingGame(t);
  const before = preserved(root);
  const plan = planProfileApply(root, { name: 'web-game' });
  assert.equal(applyProfilePlan(plan).status, 'APPLIED');
  assert.deepEqual(preserved(root), before);
  const active = JSON.parse(fs.readFileSync(path.join(root, '.ludory', 'profiles', 'active.json')));
  assert.equal(active.profile.id, 'web-game');
  assert.equal(active.profile.version, '1.0.0');
  assert.equal(profileStatus(root).status, 'IN_SYNC');
  assert.equal(planProfileApply(root, { name: 'web-game' }).status, 'IN_SYNC');
  assert.equal(planProfileUpdate(root).status, 'IN_SYNC');
});

test('update applies only higher version, retains snapshots, rejects downgrade and same-version drift', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  assert.equal(applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog })).status, 'APPLIED');
  const snapshots = path.join(root, '.ludory', 'profiles', 'snapshots');
  assert.equal(fs.readdirSync(snapshots).length, 1);
  changeProfile(catalog, { version: '1.0.1' });
  const upgrade = planProfileUpdate(root, { catalog });
  assert.equal(upgrade.status, 'READY', JSON.stringify(upgrade.conflicts));
  assert.equal(applyProfilePlan(upgrade).status, 'APPLIED');
  assert.equal(profileStatus(root, { catalog }).profile.version, '1.0.1');
  assert.equal(fs.readdirSync(snapshots).length, 2);
  changeProfile(catalog, { version: '1.0.0' });
  assert.equal(planProfileUpdate(root, { catalog }).status, 'CONFLICT');
  changeProfile(catalog, { version: '1.0.1', description: 'Mutated under same version' });
  assert.equal(planProfileUpdate(root, { catalog }).status, 'CONFLICT');
});

test('modified active pointer and immutable snapshot block status and upgrades', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog }));
  const activeFile = path.join(root, '.ludory', 'profiles', 'active.json');
  const active = fs.readFileSync(activeFile, 'utf8');
  fs.writeFileSync(activeFile, 'USER-CHANGED\n');
  assert.equal(profileStatus(root, { catalog }).status, 'CONFLICT');
  assert.equal(planProfileUpdate(root, { catalog }).status, 'CONFLICT');
  assert.equal(fs.readFileSync(activeFile, 'utf8'), 'USER-CHANGED\n');
  fs.writeFileSync(activeFile, active);
  const snapshots = path.join(root, '.ludory', 'profiles', 'snapshots');
  const snapshot = path.join(snapshots, fs.readdirSync(snapshots)[0]);
  fs.writeFileSync(snapshot, 'USER-SNAPSHOT\n');
  assert.equal(profileStatus(root, { catalog }).status, 'CONFLICT');
  assert.equal(fs.readFileSync(snapshot, 'utf8'), 'USER-SNAPSHOT\n');
});

test('tampering with older profile revision history is rejected before a later upgrade', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  assert.equal(applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog })).status, 'APPLIED');
  changeProfile(catalog, { version: '1.0.1' });
  assert.equal(applyProfilePlan(planProfileUpdate(root, { catalog })).status, 'APPLIED');

  const genesisFile = path.join(root, '.ludory', 'profiles', 'active.json');
  const genesis = JSON.parse(fs.readFileSync(genesisFile, 'utf8'));
  genesis.history = [{ ...genesis.profile }];
  const tampered = `${JSON.stringify(genesis)}\n`;
  fs.writeFileSync(genesisFile, tampered);

  changeProfile(catalog, { version: '1.0.2' });
  assert.equal(profileStatus(root, { catalog }).status, 'CONFLICT');
  assert.equal(planProfileUpdate(root, { catalog }).status, 'CONFLICT');
  assert.equal(fs.readFileSync(genesisFile, 'utf8'), tampered);
  assert.equal(fs.existsSync(path.join(root, '.ludory', 'profiles', 'revisions', '00000002.json')), false);
});

test('modified recovery archive prevents further profile updates without repairing user bytes', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog }));
  changeProfile(catalog, { version: '1.0.1' });
  applyProfilePlan(planProfileUpdate(root, { catalog }));
  const archiveDir = path.join(root, '.ludory', 'profiles', 'history');
  const archiveName = fs.readdirSync(archiveDir)[0];
  const archiveFile = path.join(archiveDir, archiveName);
  fs.writeFileSync(archiveFile, 'user-altered-recovery-archive\n');
  changeProfile(catalog, { version: '1.0.2' });
  assert.equal(profileStatus(root, { catalog }).status, 'CONFLICT');
  assert.equal(planProfileUpdate(root, { catalog }).status, 'CONFLICT');
  assert.equal(fs.readFileSync(archiveFile, 'utf8'), 'user-altered-recovery-archive\n');
});

test('apply rechecks manifest and catalog after preview', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  const plan = planProfileApply(root, { name: 'custom-game', catalog });
  changeProfile(catalog, { description: 'changed after preview' });
  assert.throws(() => applyProfilePlan(plan), /stale|changed/i);
  assert.equal(fs.existsSync(path.join(root, '.ludory')), false);
  const newPlan = planProfileApply(root, { name: 'custom-game', catalog });
  const original = fs.readFileSync(path.join(root, 'ludory.project.json'), 'utf8');
  fs.writeFileSync(path.join(root, 'ludory.project.json'), original.replace('1.0.0', '1.0.1'));
  assert.throws(() => applyProfilePlan(newPlan), /stale|changed/i);
  assert.equal(fs.existsSync(path.join(root, '.ludory')), false);
});

test('foreign symlinked profile directory and snapshot cannot redirect writes outside the project', t => {
  const root = existingGame(t);
  const outside = temporary(t);
  fs.mkdirSync(path.join(root, '.ludory'));
  fs.symlinkSync(outside, path.join(root, '.ludory', 'profiles'), 'dir');
  assert.equal(planProfileApply(root, { name: 'web-game' }).status, 'CONFLICT');
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(root, '.ludory', 'profiles'));
  const catalog = customCatalog(t);
  applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog }));
  changeProfile(catalog, { version: '1.0.1' });
  const plan = planProfileUpdate(root, { catalog });
  const malicious = path.join(root, '.ludory', 'profiles', 'snapshots', `${plan.snapshotSha256}.json`);
  fs.symlinkSync(path.join(outside, 'foreign.json'), malicious);
  assert.throws(() => applyProfilePlan(plan), /unsafe|symbolic|snapshot/i);
  assert.equal(fs.existsSync(path.join(outside, 'foreign.json')), false);
  assert.equal(profileStatus(root, { catalog }).status, 'READY');
});

test('failed operation removes only its own unchanged files and restores working directory', t => {
  const root = existingGame(t);
  const before = preserved(root);
  const plan = planProfileApply(root, { name: 'web-game' });
  const current = process.cwd();
  const original = fs.openSync;
  let intercepted = false;
  fs.openSync = function (file, flags, ...args) {
    if (!intercepted && typeof file === 'string' && file.startsWith('.pending-') && (flags & fs.constants.O_CREAT)) {
      intercepted = true;
      throw new Error('simulated disk full');
    }
    return original.call(this, file, flags, ...args);
  };
  try { assert.throws(() => applyProfilePlan(plan), /simulated disk full/); }
  finally { fs.openSync = original; }
  assert.equal(intercepted, true);
  assert.equal(process.cwd(), current);
  assert.deepEqual(preserved(root), before);
  assert.equal(fs.existsSync(path.join(root, '.ludory')), false);
});

test('parent replacement during apply blocks publication and never follows redirection', t => {
  const root = existingGame(t);
  const outside = temporary(t);
  const moved = path.join(root, '.ludory-parked');
  const plan = planProfileApply(root, { name: 'web-game' });
  const original = fs.openSync;
  let switched = false;
  fs.openSync = function (name, flags, ...args) {
    if (!switched && typeof name === 'string' && name.startsWith('.pending-') && (flags & fs.constants.O_CREAT)) {
      switched = true;
      process.chdir(root);
      fs.renameSync(path.join(root, '.ludory'), moved);
      fs.symlinkSync(outside, path.join(root, '.ludory'), 'dir');
      process.chdir(path.join(moved, 'profiles'));
    }
    return original.call(this, name, flags, ...args);
  };
  try { assert.throws(() => applyProfilePlan(plan), /changed|moved|unsafe|rollback|stale/i); }
  finally { fs.openSync = original; }
  assert.equal(switched, true);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(moved, 'profiles', 'active.json')), false);
});

test('status reports a concurrent profile update as conflict until its commit completes', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog }));
  changeProfile(catalog, { version: '1.0.1' });
  const original = fs.openSync;
  let during = null;
  fs.openSync = function (filename, flags, ...args) {
    if (during === null && typeof filename === 'string' && filename.startsWith('.pending-') && (flags & fs.constants.O_CREAT)) {
      during = profileStatus(root, { catalog }).status;
    }
    return original.call(this, filename, flags, ...args);
  };
  try { assert.equal(applyProfilePlan(planProfileUpdate(root, { catalog })).status, 'APPLIED'); }
  finally { fs.openSync = original; }
  assert.equal(during, 'CONFLICT');
  assert.equal(profileStatus(root, { catalog }).status, 'IN_SYNC');
});

test('failed upgrade retains previous active bytes, prior snapshots, and user files', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog }));
  changeProfile(catalog, { version: '1.0.1' });
  const active = path.join(root, '.ludory', 'profiles', 'active.json');
  const before = fs.readFileSync(active);
  const userFiles = preserved(root);
  const original = fs.linkSync;
  let failed = false;
  fs.linkSync = function (source, destination, ...args) {
    if (!failed && String(destination) === '00000001.json') {
      failed = true;
      throw new Error('injected pointer publication failure');
    }
    return original.call(this, source, destination, ...args);
  };
  try { assert.throws(() => applyProfilePlan(planProfileUpdate(root, { catalog })), /pointer publication failure/); }
  finally { fs.linkSync = original; }
  assert.equal(failed, true);
  assert.deepEqual(fs.readFileSync(active), before);
  assert.deepEqual(preserved(root), userFiles);
  assert.equal(profileStatus(root, { catalog }).status, 'READY');
});

test('SemVer prerelease identifiers containing hyphens cannot be parsed as an upgrade', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t, '1.0.0-alpha-beta.1');
  applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog }));
  changeProfile(catalog, { version: '1.0.0-alpha.1' });
  assert.equal(planProfileUpdate(root, { catalog }).status, 'CONFLICT');
});

test('relative external catalog remains anchored during apply and upgrade', t => {
  const root = existingGame(t);
  const external = customCatalog(t);
  const before = process.cwd();
  process.chdir(path.dirname(external));
  try {
    const relative = `./${path.basename(external)}`;
    assert.equal(applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog: relative })).status, 'APPLIED');
    changeProfile(external, { version: '1.0.1' });
    assert.equal(applyProfilePlan(planProfileUpdate(root, { catalog: relative })).status, 'APPLIED');
    assert.equal(profileStatus(root, { catalog: relative }).profile.version, '1.0.1');
  } finally { process.chdir(before); }
});

test('modifying the verified snapshot before publication blocks the update', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog }));
  changeProfile(catalog, { version: '1.0.1' });
  const active = path.join(root, '.ludory', 'profiles', 'active.json');
  const originalPointer = fs.readFileSync(active);
  const existingSnapshot = path.join(root, '.ludory', 'profiles', 'snapshots',
    `${JSON.parse(originalPointer).profile.snapshotSha256}.json`);
  const open = fs.openSync;
  let modified = false;
  fs.openSync = function (filename, flags, ...args) {
    if (!modified && typeof filename === 'string' && filename.startsWith('.pending-') && (flags & fs.constants.O_CREAT)) {
      modified = true;
      fs.writeFileSync(existingSnapshot, 'user edited snapshot');
    }
    return open.call(this, filename, flags, ...args);
  };
  try { assert.throws(() => applyProfilePlan(planProfileUpdate(root, { catalog })), /snapshot|changed|drift|conflict/i); }
  finally { fs.openSync = open; }
  assert.equal(modified, true);
  assert.deepEqual(fs.readFileSync(active), originalPointer);
  assert.equal(fs.readFileSync(existingSnapshot, 'utf8'), 'user edited snapshot');
});

test('publication never overwrites an active pointer replaced by another writer', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog }));
  changeProfile(catalog, { version: '1.0.1' });
  const active = path.join(root, '.ludory', 'profiles', 'active.json');
  const originalRename = fs.renameSync;
  const originalLink = fs.linkSync;
  let injected = false;
  const inject = () => {
    injected = true;
    fs.writeFileSync(active, 'concurrent user content\n');
  };
  fs.renameSync = function (source, destination, ...args) {
    if (!injected && destination === 'active.json') inject();
    return originalRename.call(this, source, destination, ...args);
  };
  fs.linkSync = function (source, destination, ...args) {
    if (!injected && String(destination).match(/00000001\.json$/)) inject();
    return originalLink.call(this, source, destination, ...args);
  };
  try { assert.throws(() => applyProfilePlan(planProfileUpdate(root, { catalog })), /changed|drift|conflict|snapshot|replaced|published|invalid JSON/i); }
  finally { fs.renameSync = originalRename; fs.linkSync = originalLink; }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(active, 'utf8'), 'concurrent user content\n');
});

test('failure after initial link commit retains a valid active profile and its snapshot', t => {
  const root = existingGame(t);
  const original = fs.unlinkSync;
  let intercepted = false;
  fs.unlinkSync = function (filename, ...args) {
    if (!intercepted && String(filename).startsWith('.ludory-rollback-')) {
      intercepted = true;
      throw new Error('injected staged unlink failure after commit');
    }
    return original.call(this, filename, ...args);
  };
  try { assert.throws(() => applyProfilePlan(planProfileApply(root, { name: 'web-game' })), /unlink|cleanup|commit|publication/i); }
  finally { fs.unlinkSync = original; }
  assert.equal(intercepted, true);
  const active = JSON.parse(fs.readFileSync(path.join(root, '.ludory', 'profiles', 'active.json')));
  const snapshot = path.join(root, '.ludory', 'profiles', 'snapshots', `${active.profile.snapshotSha256}.json`);
  assert.equal(fs.existsSync(snapshot), true, 'committed dependencies must not be rolled back');
});

test('foreign profile namespace appearing between preview and mkdir cannot be claimed', t => {
  const root = existingGame(t);
  const plan = planProfileApply(root, { name: 'web-game' });
  const original = fs.mkdirSync;
  let injected = false;
  fs.mkdirSync = function (directory, ...args) {
    if (!injected && directory === 'profiles') {
      injected = true;
      original.call(this, directory, ...args);
      fs.writeFileSync('profiles/foreign.txt', 'DO NOT TOUCH');
    }
    return original.call(this, directory, ...args);
  };
  try { assert.throws(() => applyProfilePlan(plan), /foreign|owned|collision|conflict|stale|exists/i); }
  finally { fs.mkdirSync = original; }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(path.join(root, '.ludory', 'profiles', 'foreign.txt'), 'utf8'), 'DO NOT TOUCH');
  assert.equal(fs.existsSync(path.join(root, '.ludory', 'profiles', 'active.json')), false);
});

test('maximal stored profile history does not allow publishing an unreadable next state', t => {
  const root = existingGame(t);
  const catalog = customCatalog(t);
  applyProfilePlan(planProfileApply(root, { name: 'custom-game', catalog }));
  const pointer = path.join(root, '.ludory', 'profiles', 'active.json');
  const active = JSON.parse(fs.readFileSync(pointer, 'utf8'));
  active.history = Array.from({ length: 256 }, () => ({ ...active.profile }));
  fs.writeFileSync(pointer, `${JSON.stringify(active)}\n`);
  changeProfile(catalog, { version: '1.0.1' });
  assert.equal(planProfileUpdate(root, { catalog }).status, 'CONFLICT');
});

test('dangling symlinks in managed namespace fail closed during planning', t => {
  const root = existingGame(t);
  fs.symlinkSync(path.join(root, 'missing-target'), path.join(root, '.ludory'), 'dir');
  assert.equal(planProfileApply(root, { name: 'web-game' }).status, 'CONFLICT');
  fs.unlinkSync(path.join(root, '.ludory'));
  applyProfilePlan(planProfileApply(root, { name: 'web-game' }));
  fs.symlinkSync(path.join(root, 'missing-revisions'), path.join(root, '.ludory', 'profiles', 'revisions'), 'dir');
  assert.equal(profileStatus(root).status, 'CONFLICT');
});
