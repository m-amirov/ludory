import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { planComponentUpdate, componentStatus, applyComponentPlan,
  previewComponentTrust, acceptComponentTrust, previewComponentGitRecovery,
  acceptComponentGitRecovery } from '../src/component-updates.mjs';
import { registerComponentTrust, readComponentRecoveryCheckpoint } from '../src/component-trust.mjs';
import { projectRoot } from '../src/projects.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-git-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initialTrustDir = process.env.LUDORY_STUDIO_TRUST_DIR;
  process.env.LUDORY_STUDIO_TRUST_DIR = path.join(root, 'first-host');
  t.after(() => {
    if (initialTrustDir === undefined) delete process.env.LUDORY_STUDIO_TRUST_DIR;
    else process.env.LUDORY_STUDIO_TRUST_DIR = initialTrustDir;
  });
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  const catalog = path.join(root, 'catalog');
  const template = path.join(catalog, 'templates', 'owned-web');
  fs.mkdirSync(path.join(template, 'src'), { recursive: true });
  fs.mkdirSync(path.join(template, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(catalog, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(catalog, 'profiles', 'owned-game.json'), JSON.stringify({
    schemaVersion: 1, id: 'owned-game', version: '1.0.0', description: 'fixture',
    engine: 'web', targets: ['vk-games'], templates: ['owned-web'],
  }));
  const descriptor = path.join(template, 'template.json');
  const writeDescriptor = version => fs.writeFileSync(descriptor, JSON.stringify({
    schemaVersion: 1, id: 'owned-web', version, description: 'fixture',
    profile: 'owned-game', engine: 'web', targets: ['vk-games'],
    files: ['index.html', 'src/main.js', 'src/story.js', 'narrative-assets.json', 'assets/vis-seed.webp'],
    authorFiles: ['src/story.js', 'narrative-assets.json', 'assets/vis-seed.webp'],
  }));
  writeDescriptor('1.2.3');
  fs.writeFileSync(path.join(template, 'index.html'), '<main>Studio</main>\n');
  fs.writeFileSync(path.join(template, 'src/main.js'), 'export const version = 123;\n');
  const authored = Buffer.from('export const story = { scenes: [] };\n');
  const image = Buffer.from('RIFF0000WEBPVP8 seed');
  fs.writeFileSync(path.join(template, 'assets/vis-seed.webp'), image);
  fs.writeFileSync(path.join(template, 'src/story.js'), authored);
  fs.writeFileSync(path.join(template, 'narrative-assets.json'), JSON.stringify({
    schemaVersion: 1, storySha256: hash(authored),
    assets: { 'vis-seed': { path: 'assets/vis-seed.webp', sha256: hash(image) } },
  }) + '\n');
  const project = path.join(root, 'game-studio');
  fs.mkdirSync(project);
  assert.equal(applyCreatePlan(planCreate(project, { id: 'fixture-game', title: 'Fixture',
    lang: 'ru', profile: 'owned-game', template: 'owned-web', targets: ['vk-games'], catalog })).status, 'APPLIED');
  git(root, 'add', 'game-studio');
  git(root, 'commit', '-qm', 'Studio create 1.2.3');
  const fromCommit = git(root, 'rev-parse', 'HEAD');
  const story = path.join(project, 'src/story.js');
  const authorBefore = fs.readFileSync(story);
  writeDescriptor('1.2.4');
  fs.writeFileSync(path.join(template, 'src/main.js'), 'export const version = 124;\n');
  const upgrade = planComponentUpdate(project, { catalog });
  assert.equal(upgrade.status, 'READY', JSON.stringify(upgrade));
  assert.equal(applyComponentPlan(upgrade).status, 'APPLIED');
  git(root, 'add', 'game-studio/index.html', 'game-studio/src/main.js', 'game-studio/ludory.components.json');
  git(root, 'commit', '-qm', 'Studio native update 1.2.4');
  const toCommit = git(root, 'rev-parse', 'HEAD');
  const archives = fs.readdirSync(project).filter(name => name.startsWith('.ludory-components-backup-'));
  assert.equal(archives.length, 1);
  for (const name of archives) fs.rmSync(path.join(project, name), { recursive: true });
  // The original host's real transaction archives are absent after transfer.
  process.env.LUDORY_STUDIO_TRUST_DIR = path.join(root, 'new-host');
  return { root, project, catalog, template, descriptor, writeDescriptor,
    fromCommit, toCommit, story, authorBefore };
}

test('native lost-archive upgrade recovers only with Git evidence, owner consent and separate trust', t => {
  const f = fixture(t);
  assert.equal(previewComponentTrust(f.project).status, 'CONFLICT');
  const beforeManaged = fs.readFileSync(path.join(f.project, 'src/main.js'));
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  assert.equal(preview.transitions.length, 1);
  assert.equal(preview.transitions[0].toVersion, '1.2.4');
  assert.match(preview.recoverySha256, /^[a-f0-9]{64}$/);
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
  assert.throws(() => acceptComponentGitRecovery(preview, '0'.repeat(64)), /confirmation|sha/i);
  assert.equal(acceptComponentGitRecovery(preview, preview.recoverySha256).status, 'RECOVERED');
  assert.deepEqual(fs.readFileSync(path.join(f.project, 'src/main.js')), beforeManaged);
  assert.deepEqual(fs.readFileSync(f.story), f.authorBefore);
  const trust = previewComponentTrust(f.project, { catalog: f.catalog });
  assert.equal(trust.status, 'NEEDS_USER_ACTION', JSON.stringify(trust));
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'BLOCKED');
  assert.equal(acceptComponentTrust(trust, trust.stateSha256).status, 'TRUSTED');
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'IN_SYNC');
  if (process.platform === 'win32') return; // Windows native apply has a separately built guard.
  f.writeDescriptor('1.2.5');
  fs.writeFileSync(path.join(f.template, 'src/main.js'), 'export const version = 125;\n');
  const next = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(next.status, 'READY', JSON.stringify(next));
  assert.equal(applyComponentPlan(next).status, 'APPLIED');
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'IN_SYNC');
});

test('recovers neither incomplete history nor any intermediate managed-content tampering', t => {
  const f = fixture(t);
  const invalid = previewComponentGitRecovery(f.project, {
    fromCommit: f.toCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(invalid.status, 'CONFLICT');
  // A different commit with unchanged component state but changed managed bytes.
  fs.writeFileSync(path.join(f.project, 'src/main.js'), 'export const tampered = true;\n');
  git(f.root, 'add', 'game-studio/src/main.js');
  git(f.root, 'commit', '-qm', 'unauthorized managed drift');
  const intermediateCommit = git(f.root, 'rev-parse', 'HEAD');
  // Restore the legitimate destination: the current working tree is now sound,
  // so only checking actual *intermediate history* can catch the attack.
  fs.writeFileSync(path.join(f.project, 'src/main.js'), 'export const version = 124;\n');
  git(f.root, 'add', 'game-studio/src/main.js');
  git(f.root, 'commit', '-qm', 'restore managed bytes without touching state');
  const restoredCommit = git(f.root, 'rev-parse', 'HEAD');
  const result = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: restoredCommit, catalog: f.catalog,
  });
  assert.equal(result.status, 'CONFLICT');
  assert.match(result.conflicts.join(' '), /managed|hash|modified/i);

  // Legacy Git grafts rewrite the apparent ancestry without changing raw
  // commit objects. They must not hide the malicious intermediate snapshot.
  fs.writeFileSync(path.join(f.root, '.git', 'info', 'grafts'),
    `${restoredCommit} ${f.toCommit}\n`);
  assert.equal(git(f.root, 'rev-list', '--first-parent', restoredCommit).includes(intermediateCommit), false,
    'fixture graft must actually hide the intermediate commit from rev-list');
  const grafted = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: restoredCommit, catalog: f.catalog,
  });
  assert.equal(grafted.status, 'CONFLICT', JSON.stringify(grafted));
});

test('recovery approval cannot be replayed into a different host registry', t => {
  const f = fixture(t);
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  const initiallySelectedHost = process.env.LUDORY_STUDIO_TRUST_DIR;
  process.env.LUDORY_STUDIO_TRUST_DIR = path.join(f.root, 'different-host');
  assert.throws(() => acceptComponentGitRecovery(preview, preview.recoverySha256),
    /stale|host|registry|conflict/i);
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
  process.env.LUDORY_STUDIO_TRUST_DIR = initiallySelectedHost;
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
});

test('recovery approval rejects replacement of the existing host registry directory', t => {
  const f = fixture(t);
  const selectedHost = process.env.LUDORY_STUDIO_TRUST_DIR;
  fs.mkdirSync(selectedHost, { recursive: true, mode: 0o700 });
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  fs.rmdirSync(selectedHost);
  fs.mkdirSync(selectedHost, { mode: 0o700 });
  assert.throws(() => acceptComponentGitRecovery(preview, preview.recoverySha256),
    /stale|host|registry|conflict/i);
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
});

test('recovery refuses registry switch between preview checks and the record lock', t => {
  if (process.platform === 'win32') return t.skip('Linux pathname lock interception; Windows uses native RootDirectory and its own tests');
  const f = fixture(t);
  const selectedHost = process.env.LUDORY_STUDIO_TRUST_DIR;
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  const originalOpen = fs.openSync;
  let switched = false;
  fs.openSync = function openWithRegistrySwitch(filename, ...args) {
    if (!switched && String(filename).endsWith('.json.lock')) {
      switched = true;
      process.env.LUDORY_STUDIO_TRUST_DIR = path.join(f.root, 'switched-during-lock');
    }
    return originalOpen.call(this, filename, ...args);
  };
  try {
    assert.throws(() => acceptComponentGitRecovery(preview, preview.recoverySha256),
      /registry|host|changed/i);
    assert.equal(switched, true);
  } finally {
    fs.openSync = originalOpen;
    process.env.LUDORY_STUDIO_TRUST_DIR = selectedHost;
  }
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
});

test('recovery refuses physical registry substitution during checkpoint locking', t => {
  if (process.platform === 'win32') return t.skip('Linux pathname lock interception; Windows uses native RootDirectory and its own tests');
  const f = fixture(t);
  const selectedHost = process.env.LUDORY_STUDIO_TRUST_DIR;
  fs.mkdirSync(selectedHost, { recursive: true, mode: 0o700 });
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  const originalOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function openWithRegistrySubstitution(filename, ...args) {
    if (!swapped && String(filename).endsWith('.json.lock')) {
      swapped = true;
      fs.rmdirSync(selectedHost);
      fs.mkdirSync(selectedHost, { mode: 0o700 });
    }
    return originalOpen.call(this, filename, ...args);
  };
  try {
    assert.throws(() => acceptComponentGitRecovery(preview, preview.recoverySha256),
      /registry|host|identity|changed/i);
    assert.equal(swapped, true);
  } finally { fs.openSync = originalOpen; }
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
});

test('recovery refuses a just-created registry replaced before lock acquisition', t => {
  if (process.platform === 'win32') return t.skip('Linux pathname lock interception; Windows uses native RootDirectory and its own tests');
  const f = fixture(t);
  const selectedHost = process.env.LUDORY_STUDIO_TRUST_DIR;
  assert.equal(fs.existsSync(selectedHost), false, 'host registry must not exist at preview time');
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  const originalOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function openWithNewRegistrySwap(filename, ...args) {
    if (!swapped && String(filename).endsWith('.json.lock')) {
      swapped = true;
      fs.renameSync(selectedHost, `${selectedHost}-original`);
      fs.mkdirSync(selectedHost, { mode: 0o700 });
    }
    return originalOpen.call(this, filename, ...args);
  };
  try {
    assert.throws(() => acceptComponentGitRecovery(preview, preview.recoverySha256),
      /registry|host|identity|changed/i);
    assert.equal(swapped, true);
  } finally { fs.openSync = originalOpen; }
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
});

for (const initiallyExisting of [false, true]) {
  test(`recovery never publishes into a swapped registry at checkpoint open (root initially ${initiallyExisting ? 'present' : 'absent'})`, t => {
    if (process.platform !== 'linux') return t.skip('Linux descriptor-relative host publication');
    const f = fixture(t);
    const selectedHost = process.env.LUDORY_STUDIO_TRUST_DIR;
    if (initiallyExisting) fs.mkdirSync(selectedHost, { recursive: true, mode: 0o700 });
    const preview = previewComponentGitRecovery(f.project, {
      fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
    });
    assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
    const beforeGame = fs.readFileSync(path.join(f.project, 'src/main.js'));
    const oldOpen = fs.openSync;
    let swapped = false;
    fs.openSync = function swapJustBeforeCheckpointCreate(filename, ...args) {
      if (!swapped && String(filename).endsWith('.recovery.json') &&
          (args[0] & fs.constants.O_CREAT)) {
        swapped = true;
        fs.renameSync(selectedHost, `${selectedHost}-original`);
        fs.mkdirSync(selectedHost, { mode: 0o700 });
      }
      return oldOpen.call(this, filename, ...args);
    };
    try {
      assert.throws(() => acceptComponentGitRecovery(preview, preview.recoverySha256),
        /host|registry|changed|ENOENT|identity|conflict/i);
    } finally { fs.openSync = oldOpen; }
    assert.equal(swapped, true, 'attack must intercept the actual checkpoint create');
    assert.equal(readComponentRecoveryCheckpoint(f.project), null,
      'substituted registry must contain no usable recovery authority');
    assert.deepEqual(fs.readFileSync(path.join(f.project, 'src/main.js')), beforeGame);
  });
}

test('recovery interrupted after record bytes were written cannot expose usable authority', t => {
  if (process.platform !== 'linux') return t.skip('Linux rooted store interruption');
  const f = fixture(t);
  const selectedHost = process.env.LUDORY_STUDIO_TRUST_DIR;
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  const oldFsync = fs.fsyncSync;
  let switched = false;
  fs.fsyncSync = function swapAfterCheckpointWrite(fd) {
    let target = '';
    try { target = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { /* Closed or anonymous handle. */ }
    if (!switched && target.endsWith('.recovery.json')) {
      switched = true;
      fs.renameSync(selectedHost, `${selectedHost}-original`);
      fs.mkdirSync(selectedHost, { mode: 0o700 });
    }
    return oldFsync.call(this, fd);
  };
  try {
    assert.throws(() => acceptComponentGitRecovery(preview, preview.recoverySha256),
      /host|registry|changed|ENOENT|identity|conflict/i);
  } finally { fs.fsyncSync = oldFsync; }
  assert.equal(switched, true, 'attack must occur after checkpoint bytes were written');
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
  process.env.LUDORY_STUDIO_TRUST_DIR = `${selectedHost}-original`;
  try {
    assert.equal(readComponentRecoveryCheckpoint(f.project), null,
      'a clean rollback must remove the incomplete checkpoint');
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.match(error.message, /lock|unfinished|blocked|conflict/i,
      'a retained lock must prevent adoption of an interrupted checkpoint');
  }
});

test('failed rollback retains the physical registry lock and blocks checkpoint readers', t => {
  if (process.platform !== 'linux') return t.skip('Linux pinned rollback');
  const f = fixture(t);
  const selectedHost = process.env.LUDORY_STUDIO_TRUST_DIR;
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  const originalOpen = fs.openSync;
  const originalUnlink = fs.unlinkSync;
  let swapped = false;
  let rollbackDenied = false;
  fs.openSync = function swapAfterRecordOpen(filename, ...args) {
    if (!swapped && String(filename).endsWith('.recovery.json') &&
        (args[0] & fs.constants.O_CREAT)) {
      swapped = true;
      fs.renameSync(selectedHost, `${selectedHost}-original`);
      fs.mkdirSync(selectedHost, { mode: 0o700 });
    }
    return originalOpen.call(this, filename, ...args);
  };
  fs.unlinkSync = function denyRollback(filename, ...args) {
    if (swapped && String(filename).endsWith('.recovery.json')) {
      rollbackDenied = true;
      throw Object.assign(new Error('injected rollback EACCES'), { code: 'EACCES' });
    }
    return originalUnlink.call(this, filename, ...args);
  };
  try {
    assert.throws(() => acceptComponentGitRecovery(preview, preview.recoverySha256), /registry|host|identity|changed/i);
  } finally {
    fs.openSync = originalOpen;
    fs.unlinkSync = originalUnlink;
  }
  assert.equal(swapped, true);
  assert.equal(rollbackDenied, true);
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
  process.env.LUDORY_STUDIO_TRUST_DIR = `${selectedHost}-original`;
  assert.throws(() => readComponentRecoveryCheckpoint(f.project), /lock|unfinished|blocked/i);
});

test('Linux lock unlink remains a successful publication even if its subsequent fsync fails', t => {
  if (process.platform !== 'linux') return t.skip('Linux directory fsync fault injection');
  const f = fixture(t);
  const registry = process.env.LUDORY_STUDIO_TRUST_DIR;
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION');
  const originalFsync = fs.fsyncSync;
  let injected = false;
  fs.fsyncSync = function afterUnlinkSync(fd) {
    let target = '';
    try { target = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { /* Other file descriptor. */ }
    if (!injected && target === registry &&
        fs.readdirSync(registry).some(name => name.endsWith('.recovery.json')) &&
        !fs.readdirSync(registry).some(name => name.endsWith('.json.lock'))) {
      injected = true;
      throw Object.assign(new Error('injected post-unlink fsync failure'), { code: 'EIO' });
    }
    return originalFsync.call(this, fd);
  };
  let result;
  try { result = acceptComponentGitRecovery(preview, preview.recoverySha256); }
  finally { fs.fsyncSync = originalFsync; }
  assert.equal(injected, true);
  assert.equal(result.status, 'RECOVERED');
  assert.equal(readComponentRecoveryCheckpoint(f.project)?.recoverySha256, preview.recoverySha256);
});

test('a canonical checkpoint is not trusted while its stable publication lock exists', t => {
  const f = fixture(t);
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  assert.equal(acceptComponentGitRecovery(preview, preview.recoverySha256).status, 'RECOVERED');
  const registry = process.env.LUDORY_STUDIO_TRUST_DIR;
  const checkpoints = fs.readdirSync(registry).filter(name => name.endsWith('.recovery.json'));
  assert.equal(checkpoints.length, 1);
  const lock = path.join(registry, checkpoints[0].replace('.recovery.json', '.json.lock'));
  fs.writeFileSync(lock, 'interrupted\n', { flag: 'wx', mode: 0o600 });
  assert.throws(() => readComponentRecoveryCheckpoint(f.project), /lock|unfinished|blocked|conflict/i);
  assert.equal(previewComponentTrust(f.project).status, 'CONFLICT');
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'BLOCKED');
});

test('stale author proof cannot be silently accepted after preview', t => {
  const f = fixture(t);
  const preview = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(preview.status, 'NEEDS_USER_ACTION', JSON.stringify(preview));
  fs.appendFileSync(f.story, '\n// new owner edit\n');
  assert.throws(() => acceptComponentGitRecovery(preview, preview.recoverySha256), /stale|changed|proof|conflict/i);
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
});

test('existing contradictory host pin cannot be overridden by Git recovery', t => {
  const f = fixture(t);
  const receipt = fs.readFileSync(path.join(f.project, 'ludory.studio.json'));
  const manifest = fs.readFileSync(path.join(f.project, 'ludory.project.json'));
  registerComponentTrust(projectRoot(f.project), { rootIdentity: '0:0',
    receiptSha256: hash(receipt), manifestSha256: hash(manifest), stateSha256: 'f'.repeat(64) });
  const result = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(result.status, 'CONFLICT');
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
});

test('an existing damaged native archive must be inspected, never bypassed by Git evidence', t => {
  const f = fixture(t);
  const damaged = path.join(f.project, '.ludory-components-backup-manual');
  fs.mkdirSync(damaged);
  fs.writeFileSync(path.join(damaged, 'component-transition.json'), '{"corrupted":true}\n');
  const result = previewComponentGitRecovery(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit, catalog: f.catalog,
  });
  assert.equal(result.status, 'CONFLICT');
  assert.match(result.conflicts.join(' '), /native.*archive/i);
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
});
