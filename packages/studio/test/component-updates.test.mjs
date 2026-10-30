import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { planComponentUpdate, componentStatus, applyComponentPlan,
  previewComponentTrust, acceptComponentTrust } from '../src/component-updates.mjs';
import { loadCatalog } from '../src/catalog.mjs';

const physicalPath = value => {
  const raw = String(value);
  const match = /^\/proc\/self\/fd\/(\d+)(\/.*)?$/.exec(raw);
  return match ? `${fs.readlinkSync(`/proc/self/fd/${match[1]}`)}${match[2] || ''}` : raw;
};
const transactionPath = value => /\.ludory-components-(?:update|backup)-/.test(physicalPath(value));
const anchoredBasename = (value, name) => String(value) === name || /[\\/]([^\\/]+)$/.exec(String(value))?.[1] === name;

function fixture(t, { initialVersion = '1.0.0', availableTargets = ['vk-games'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-components-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previousTrustRoot = process.env.LUDORY_STUDIO_TRUST_DIR;
  const trustRoot = path.join(root, 'host-trust');
  process.env.LUDORY_STUDIO_TRUST_DIR = trustRoot;
  t.after(() => {
    if (previousTrustRoot === undefined) delete process.env.LUDORY_STUDIO_TRUST_DIR;
    else process.env.LUDORY_STUDIO_TRUST_DIR = previousTrustRoot;
  });
  const project = path.join(root, 'game');
  const catalog = path.join(root, 'catalog');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(catalog, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(catalog, 'templates', 'owned-web', 'src'), { recursive: true });
  fs.writeFileSync(path.join(catalog, 'profiles', 'owned-game.json'), JSON.stringify({
    schemaVersion: 1, id: 'owned-game', version: '1.0.0', description: 'test profile',
    engine: 'web', targets: availableTargets, templates: ['owned-web'],
  }));
  const descriptor = path.join(catalog, 'templates', 'owned-web', 'template.json');
  const app = path.join(catalog, 'templates', 'owned-web', 'src', 'main.js');
  const html = path.join(catalog, 'templates', 'owned-web', 'index.html');
  fs.writeFileSync(descriptor, JSON.stringify({
    schemaVersion: 1, id: 'owned-web', version: initialVersion, description: 'test template',
    profile: 'owned-game', engine: 'web', targets: availableTargets, files: ['index.html', 'src/main.js'],
  }));
  fs.writeFileSync(app, 'export const version = 1;\n');
  fs.writeFileSync(html, '<main>v1</main>\n');
  applyCreatePlan(planCreate(project, {
    id: 'owned-game', title: 'Owned', lang: 'en', profile: 'owned-game',
    template: 'owned-web', targets: ['vk-games'], catalog,
  }));
  return { root, trustRoot, project, catalog, descriptor, app, html,
    gameApp: path.join(project, 'src', 'main.js'),
    gameHtml: path.join(project, 'index.html'),
    state: path.join(project, 'ludory.components.json'),
  };
}

test('the host registry is created with Studio ownership, outside the game', t => {
  const f = fixture(t);
  assert.equal(fs.existsSync(f.trustRoot), true);
  const pins = fs.readdirSync(f.trustRoot).filter(file => file.endsWith('.json'));
  assert.equal(pins.length, 1);
  const pin = JSON.parse(fs.readFileSync(path.join(f.trustRoot, pins[0]), 'utf8'));
  assert.equal(pin.stateSha256, crypto.createHash('sha256').update(fs.readFileSync(f.state)).digest('hex'));
  // Windows resolves short 8.3 temp paths (RUNNER~1) to their physical long spelling.
  assert.equal(pin.project, fs.realpathSync.native(f.project));
  assert.equal(previewComponentTrust(f.project).status, 'IN_SYNC');
});

test('Windows-style directory and read-only descriptor fsync errors do not prevent a managed update', t => {
  const f = fixture(t);
  version2(f);
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalOpen = fs.openSync;
  const originalFsync = fs.fsyncSync;
  const opened = new Map();
  fs.openSync = function (filename, flags) {
    const fd = originalOpen.apply(this, arguments);
    opened.set(fd, flags);
    return fd;
  };
  fs.fsyncSync = function (fd) {
    if (fs.fstatSync(fd).isDirectory() ||
        (opened.has(fd) && (opened.get(fd) & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0)) {
      const error = new Error('simulated Windows unsupported fsync descriptor');
      error.code = 'EPERM';
      throw error;
    }
    return originalFsync.apply(this, arguments);
  };
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
  try {
    const applied = applyComponentPlan(planComponentUpdate(f.project, { catalog: f.catalog }));
    assert.equal(applied.status, 'APPLIED');
    assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 2;\n');
    assert.equal(previewComponentTrust(f.project).status, 'IN_SYNC');
    const archive = applied.backupDirectory;
    assert.equal(fs.readdirSync(archive).some(name => ['new', 'backup', 'quarantine'].includes(name)), false);
    const index = JSON.parse(fs.readFileSync(path.join(archive, 'backup-index.json'), 'utf8'));
    assert.ok(index.entries.some(entry => /^backup-[0-9]+$/.test(entry.backup ?? '')));
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    fs.openSync = originalOpen;
    fs.fsyncSync = originalFsync;
  }
});

test('a forged additional archive and ownership state cannot authorize overwriting an author file', t => {
  const f = fixture(t);
  const originalBytes = fs.readFileSync(f.state);
  const authorFile = path.join(f.project, 'src/author.js');
  fs.writeFileSync(authorFile, 'const AUTHOR = true;\n');
  version2(f, { version: '1.2.0' });
  const descriptor = JSON.parse(fs.readFileSync(f.descriptor, 'utf8'));
  descriptor.files.push('src/author.js');
  fs.writeFileSync(f.descriptor, JSON.stringify(descriptor));
  fs.writeFileSync(path.join(f.catalog, 'templates/owned-web/src/author.js'), 'const AUTHOR = false;\n');
  const original = JSON.parse(originalBytes.toString('utf8'));
  const forged = structuredClone(original);
  forged.template.version = '1.1.0';
  forged.template.sourceSha256 = loadCatalog(f.catalog).templates.get('owned-web').sourceSha256;
  forged.files['src/author.js'] = crypto.createHash('sha256').update(fs.readFileSync(authorFile)).digest('hex');
  const forgedBytes = Buffer.from(`${JSON.stringify(forged, null, 2)}\n`);
  fs.writeFileSync(f.state, forgedBytes);
  const archive = path.join(f.project, '.ludory-components-backup-forged');
  fs.mkdirSync(path.join(archive, 'backup'), { recursive: true });
  fs.writeFileSync(path.join(archive, 'backup/0'), originalBytes);
  fs.writeFileSync(path.join(archive, 'component-transition.json'), `${JSON.stringify({
    schemaVersion: 1,
    beforeSha256: crypto.createHash('sha256').update(originalBytes).digest('hex'),
    afterSha256: crypto.createHash('sha256').update(forgedBytes).digest('hex'),
    backupSlot: 'backup/0',
  }, null, 2)}\n`);
  const preview = componentStatus(f.project, { catalog: f.catalog });
  assert.equal(preview.status, 'CONFLICT', JSON.stringify(preview));
  assert.match(preview.conflicts.join(' '), /host|trust|pin/i);
  assert.equal(fs.readFileSync(authorFile, 'utf8'), 'const AUTHOR = true;\n');
});

test('deleting or tampering with the host trust pin blocks component updates', t => {
  const f = fixture(t);
  version2(f);
  const [record] = fs.readdirSync(f.trustRoot).filter(file => file.endsWith('.json'));
  const recordFile = path.join(f.trustRoot, record);
  const original = fs.readFileSync(recordFile);
  fs.unlinkSync(recordFile);
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'BLOCKED');
  fs.writeFileSync(recordFile, original);
  const mutated = JSON.parse(original);
  mutated.stateSha256 = 'f'.repeat(64);
  fs.writeFileSync(recordFile, `${JSON.stringify(mutated, null, 2)}\n`);
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'CONFLICT');
});

test('an explicitly confirmed state SHA transfers authority to a new host without game writes', t => {
  const f = fixture(t);
  version2(f);
  const oldTrustRoot = process.env.LUDORY_STUDIO_TRUST_DIR;
  process.env.LUDORY_STUDIO_TRUST_DIR = path.join(f.root, 'different-host');
  t.after(() => { process.env.LUDORY_STUDIO_TRUST_DIR = oldTrustRoot; });
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'BLOCKED');
  const preview = previewComponentTrust(f.project);
  assert.equal(preview.status, 'NEEDS_USER_ACTION');
  assert.deepEqual(preview.managedPaths, ['index.html', 'src/main.js']);
  assert.equal(preview.writes.length, 0);
  assert.throws(() => acceptComponentTrust(preview, '0'.repeat(64)), /confirmation|SHA/i);
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'BLOCKED');
  const applied = acceptComponentTrust(preview, preview.stateSha256);
  assert.equal(applied.status, 'TRUSTED');
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'READY');
  assert.equal(previewComponentTrust(f.project).status, 'IN_SYNC');
  assert.throws(() => acceptComponentTrust(preview, preview.stateSha256), /existing|stale|pin/i);
});

test('host trust replacement and symlinks fail closed', t => {
  const f = fixture(t);
  version2(f);
  const [record] = fs.readdirSync(f.trustRoot).filter(file => file.endsWith('.json'));
  const filename = path.join(f.trustRoot, record);
  const original = fs.readFileSync(filename);
  fs.unlinkSync(filename);
  fs.writeFileSync(path.join(f.root, 'other-file.json'), original);
  fs.symlinkSync(path.join(f.root, 'other-file.json'), filename);
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'CONFLICT');
});

test('group- or world-writable host trust pins cannot authorize an update', t => {
  if (process.platform === 'win32') return t.skip('POSIX record permissions only');
  const f = fixture(t);
  version2(f);
  const [record] = fs.readdirSync(f.trustRoot).filter(file => file.endsWith('.json'));
  fs.chmodSync(path.join(f.trustRoot, record), 0o666);
  const preview = componentStatus(f.project, { catalog: f.catalog });
  assert.equal(preview.status, 'CONFLICT');
  assert.match(preview.conflicts.join(' '), /trust|unsafe|permission/i);
});

test('host directory sync failure after pin publication fails closed and retains rollback bytes', t => {
  if (process.platform !== 'linux') return t.skip('Linux directory fsync injection');
  const f = fixture(t);
  version2(f);
  const originalRename = fs.renameSync;
  const originalFsync = fs.fsyncSync;
  let trustPublished = false;
  let injected = false;
  fs.renameSync = function (source, destination) {
    const result = originalRename.apply(this, arguments);
    if (path.dirname(String(source)) === f.trustRoot && String(source).endsWith('.tmp')) trustPublished = true;
    return result;
  };
  fs.fsyncSync = function (descriptor) {
    if (trustPublished && !injected && fs.readlinkSync(`/proc/self/fd/${descriptor}`) === f.trustRoot) {
      injected = true;
      throw new Error('simulated host directory durability failure');
    }
    return originalFsync.apply(this, arguments);
  };
  try {
    assert.throws(() => applyComponentPlan(planComponentUpdate(f.project, { catalog: f.catalog })), /simulated host directory durability failure/);
  } finally { fs.renameSync = originalRename; fs.fsyncSync = originalFsync; }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
  assert.equal(JSON.parse(fs.readFileSync(f.state, 'utf8')).template.version, '1.0.0');
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  assert.ok(fs.readdirSync(f.project).some(name => name.startsWith('.ludory-components-backup-')));
});

test('failure to advance a host trust pin rolls component bytes back', t => {
  const f = fixture(t);
  version2(f);
  const originalRename = fs.renameSync;
  let injected = false;
  fs.renameSync = function (source, dest) {
    if (!injected && path.dirname(String(source)) === f.trustRoot && String(source).endsWith('.tmp')) {
      injected = true;
      throw new Error('simulated trust publish failure');
    }
    return originalRename.apply(this, arguments);
  };
  try {
    assert.throws(() => applyComponentPlan(planComponentUpdate(f.project, { catalog: f.catalog })), /simulated trust publish failure/);
  } finally { fs.renameSync = originalRename; }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
  assert.equal(JSON.parse(fs.readFileSync(f.state, 'utf8')).template.version, '1.0.0');
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'READY');
});

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

test('duplicate JSON keys and injected protected ownership cannot authorize any update', t => {
  const f = fixture(t);
  const clean = fs.readFileSync(f.state, 'utf8');
  const state = JSON.parse(clean);
  state.files['package.json'] = 'a'.repeat(64);
  fs.writeFileSync(f.state, `${JSON.stringify(state, null, 2)}\n`);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');

  fs.writeFileSync(f.state, clean.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,'));
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
});

test('canonical forged state cannot claim a user file that a later template introduces', t => {
  const f = fixture(t);
  const authorFile = path.join(f.project, 'src', 'extra.js');
  fs.writeFileSync(authorFile, 'author code, not Studio-owned\n');
  version2(f, { extra: true });
  const forged = JSON.parse(fs.readFileSync(f.state, 'utf8'));
  forged.files['src/extra.js'] = crypto.createHash('sha256').update(fs.readFileSync(authorFile)).digest('hex');
  fs.writeFileSync(f.state, `${JSON.stringify(forged, null, 2)}\n`);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(plan.status, 'CONFLICT', JSON.stringify(plan));
  assert.deepEqual(plan.writes, []);
  assert.equal(fs.readFileSync(authorFile, 'utf8'), 'author code, not Studio-owned\n');
});

test('hardlinks of owned files and symbolic ancestor directories are never previewed as safe', t => {
  const f = fixture(t);
  version2(f);
  const original = fs.readFileSync(f.gameApp, 'utf8');
  fs.linkSync(f.gameApp, path.join(f.project, 'hardlinked.js'));
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  fs.unlinkSync(path.join(f.project, 'hardlinked.js'));
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'READY');
  const ownedDir = path.join(f.project, 'src');
  fs.renameSync(ownedDir, path.join(f.project, 'moved-src'));
  fs.symlinkSync(path.join(f.project, 'moved-src'), ownedDir, 'dir');
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  assert.equal(fs.readFileSync(path.join(f.project, 'moved-src/main.js'), 'utf8'), original);
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
  // The original manifest is host-pinned, so even a schema-valid edit is a conflict.
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
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

test('updated template cannot silently change the compatible catalog profile', t => {
  const f = fixture(t);
  version2(f);
  const profile = path.join(f.catalog, 'profiles', 'owned-game.json');
  const descriptor = JSON.parse(fs.readFileSync(profile, 'utf8'));
  descriptor.version = '1.1.0';
  descriptor.description = 'changed compatibility metadata';
  fs.writeFileSync(profile, JSON.stringify(descriptor));
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
});

test('hyphens inside SemVer prerelease identifiers compare as full prerelease tokens', t => {
  const f = fixture(t, { initialVersion: '1.0.0-alpha-1' });
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

test('successful upgrades prove subsequent ownership of legitimately introduced files', t => {
  const f = fixture(t);
  version2(f, { extra: true });
  const first = applyComponentPlan(planComponentUpdate(f.project, { catalog: f.catalog }));
  assert.equal(first.status, 'APPLIED');
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'IN_SYNC');
  const descriptor = JSON.parse(fs.readFileSync(f.descriptor, 'utf8'));
  descriptor.version = '1.2.0';
  fs.writeFileSync(f.descriptor, JSON.stringify(descriptor));
  fs.writeFileSync(path.join(f.catalog, 'templates', 'owned-web', 'src', 'extra.js'), 'export const extra = 3;\n');
  const second = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(second.status, 'READY', JSON.stringify(second));
  assert.equal(applyComponentPlan(second).status, 'APPLIED');
  assert.equal(fs.readFileSync(path.join(f.project, 'src/extra.js'), 'utf8'), 'export const extra = 3;\n');
});

test('a newer template containing 257 managed files remains readable after upgrading', t => {
  const f = fixture(t);
  const descriptor = JSON.parse(fs.readFileSync(f.descriptor, 'utf8'));
  descriptor.version = '1.1.0';
  for (let i = 0; i < 255; i++) {
    const filename = `src/generated${i}.js`;
    descriptor.files.push(filename);
    fs.writeFileSync(path.join(f.catalog, 'templates', 'owned-web', filename), `// generated ${i}\n`);
  }
  fs.writeFileSync(f.descriptor, JSON.stringify(descriptor));
  const before = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(before.status, 'READY', JSON.stringify(before.conflicts));
  assert.equal(applyComponentPlan(before).status, 'APPLIED');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(f.state)).files).length, 257);
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'IN_SYNC');
});

test('a forged post-upgrade ownership file is rejected even if new hashes match authored bytes', t => {
  const f = fixture(t);
  version2(f, { extra: true });
  assert.equal(applyComponentPlan(planComponentUpdate(f.project, { catalog: f.catalog })).status, 'APPLIED');
  const authorFile = path.join(f.project, 'src', 'extra.js');
  fs.writeFileSync(authorFile, 'author-edited content\n');
  const forged = JSON.parse(fs.readFileSync(f.state, 'utf8'));
  forged.files['src/extra.js'] = crypto.createHash('sha256').update(fs.readFileSync(authorFile)).digest('hex');
  fs.writeFileSync(f.state, `${JSON.stringify(forged, null, 2)}\n`);
  const descriptor = JSON.parse(fs.readFileSync(f.descriptor, 'utf8'));
  descriptor.version = '1.2.0';
  fs.writeFileSync(f.descriptor, JSON.stringify(descriptor));
  fs.writeFileSync(path.join(f.catalog, 'templates', 'owned-web', 'src', 'extra.js'), 'export const extra = 3;\n');
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  assert.equal(fs.readFileSync(authorFile, 'utf8'), 'author-edited content\n');
});

test('invalid prerelease versions in an otherwise canonical ownership state are rejected', t => {
  const f = fixture(t);
  for (const version of ['1.0.0-01', '1.0.0-foo..bar']) {
    const state = JSON.parse(fs.readFileSync(f.state));
    state.template.version = version;
    fs.writeFileSync(f.state, `${JSON.stringify(state, null, 2)}\n`);
    const result = planComponentUpdate(f.project, { catalog: f.catalog });
    assert.equal(result.status, 'CONFLICT', version);
    assert.match(result.conflicts.join(' '), /invalid component ownership state/i, version);
  }
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
    if (!injected && anchoredBasename(filename, '.ludory-components.lock')) {
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

test('an existing transaction lock prevents a second apply without touching managed files', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const lock = path.join(f.project, '.ludory-components.lock');
  fs.writeFileSync(lock, 'operator lock\n');
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
  assert.throws(() => applyComponentPlan(plan), /stale|conflict|lock/i);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'operator lock\n');
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
});

test('filesystem without hardlink publish fails visibly and keeps prior managed bytes', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalLink = fs.linkSync;
  fs.linkSync = function (src, dst, ...args) {
    if (transactionPath(src)) {
      const error = new Error('hardlink unsupported by filesystem');
      error.code = 'ENOTSUP';
      throw error;
    }
    return originalLink.call(this, src, dst, ...args);
  };
  try { assert.throws(() => applyComponentPlan(plan), /hardlink unsupported/i); }
  finally { fs.linkSync = originalLink; }
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
  assert.equal(JSON.parse(fs.readFileSync(f.state)).template.version, '1.0.0');
  assert.ok(fs.readdirSync(f.project).some(name => name.startsWith('.ludory-components-backup-')));
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

test('backup fsync failure after a successful move restores managed original and locks on failure', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalRename = fs.renameSync;
  const originalSync = fs.fsyncSync;
  let movedOriginal = false;
  let fired = false;
  fs.renameSync = function (src, dst, ...args) {
    const result = originalRename.call(this, src, dst, ...args);
    if (anchoredBasename(src, 'main.js') && physicalPath(dst).includes(`${path.sep}backup${path.sep}`)) movedOriginal = true;
    return result;
  };
  fs.fsyncSync = function (fd) {
    if (movedOriginal && !fired) { fired = true; throw new Error('injected post-rename fsync error'); }
    return originalSync.call(this, fd);
  };
  try { assert.throws(() => applyComponentPlan(plan), /post-rename fsync/); }
  finally { fs.renameSync = originalRename; fs.fsyncSync = originalSync; }
  assert.equal(fired, true);
  const originalPresent = fs.existsSync(f.gameApp) && fs.readFileSync(f.gameApp, 'utf8') === 'export const version = 1;\n';
  const locked = fs.existsSync(path.join(f.project, '.ludory-components.lock'));
  assert.ok(originalPresent || locked, 'An incomplete restore must retain the lock, never silently lose the original');
});

test('safe rollback followed by successful retry retains an unambiguous provenance chain', t => {
  const f = fixture(t);
  version2(f);
  const firstPlan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalLink = fs.linkSync;
  let once = false;
  fs.linkSync = function (source, destination, ...args) {
    if (!once && transactionPath(source)) { once = true; throw new Error('first attempt fails'); }
    return originalLink.call(this, source, destination, ...args);
  };
  try { assert.throws(() => applyComponentPlan(firstPlan), /first attempt fails/); }
  finally { fs.linkSync = originalLink; }
  assert.equal(once, true);
  const secondPlan = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(secondPlan.status, 'READY');
  assert.equal(applyComponentPlan(secondPlan).status, 'APPLIED');
  assert.equal(componentStatus(f.project, { catalog: f.catalog }).status, 'IN_SYNC');
});

test('archive capacity blocks before an update can make future status unreadable', t => {
  const f = fixture(t);
  version2(f);
  for (let i = 0; i < 128; i++) fs.mkdirSync(path.join(f.project, `.ludory-components-backup-retained${i}`));
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  assert.equal(plan.status, 'BLOCKED');
  assert.match(plan.conflicts.join(' '), /archive limit/i);
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
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
    if (!failed && transactionPath(src) && anchoredBasename(dst, 'main.js')) {
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
    if (transactionPath(src) && anchoredBasename(dst, 'main.js')) {
      throw new Error('simulated publish failure');
    }
    return originalLink.call(this, src, dst, ...args);
  };
  fs.unlinkSync = function (filename, ...args) {
    if (anchoredBasename(filename, '.ludory-components.lock')) {
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
  const originalOpen = fs.openSync;
  fs.linkSync = function (src, dst, ...args) {
    if (transactionPath(src) && anchoredBasename(dst, 'ludory.components.json')) {
      throw new Error('simulated state publish failure');
    }
    return originalLink.call(this, src, dst, ...args);
  };
  fs.openSync = function (filename, flags, ...args) {
    if (anchoredBasename(filename, 'main.js') && (flags & fs.constants.O_CREAT) &&
        (flags & fs.constants.O_EXCL)) {
      throw new Error('simulated restore failure');
    }
    return originalOpen.call(this, filename, flags, ...args);
  };
  try { assert.throws(() => applyComponentPlan(plan), /simulated state publish failure; incomplete component rollback:.*simulated restore failure/i); }
  finally { fs.linkSync = originalLink; fs.openSync = originalOpen; }
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

test('swapped backup archive cannot move an original into an external directory', t => {
  const f = fixture(t);
  version2(f);
  const outside = path.join(f.root, 'outside-archive');
  fs.mkdirSync(path.join(outside, 'backup'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'backup', '0'), 'external owner content\n');
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalRename = fs.renameSync;
  let swapped = false;
  fs.renameSync = function (source, destination, ...args) {
    if (!swapped && (physicalPath(destination).includes(`${path.sep}backup${path.sep}0`) ||
        /[\\/]backup-0$/.test(physicalPath(destination)))) {
      swapped = true;
      const destinationPath = physicalPath(destination);
      const stage = /[\\/]backup-0$/.test(destinationPath)
        ? path.dirname(destinationPath) : path.dirname(path.dirname(destinationPath));
      originalRename.call(this, stage, `${stage}-held`);
      fs.symlinkSync(outside, stage, 'dir');
    }
    return originalRename.call(this, source, destination, ...args);
  };
  try { assert.throws(() => applyComponentPlan(plan), /changed|unsafe|rollback|conflict|exists|EEXIST|ELOOP|ENOENT|EPERM|finalization/i); }
  finally { fs.renameSync = originalRename; }
  assert.equal(swapped, true);
  assert.equal(fs.readFileSync(path.join(outside, 'backup', '0'), 'utf8'), 'external owner content\n');
  assert.equal(fs.existsSync(path.join(outside, 'backup', '1')), false);
});

test('swapped project root during lock creation never creates a lock in the replacement', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const moved = path.join(f.root, 'game-original');
  const originalOpen = fs.openSync;
  let replaced = false;
  let replacementEverLocked = false;
  fs.openSync = function (filename, flags, ...args) {
    if (!replaced && String(filename).endsWith('.ludory-components.lock')) {
      replaced = true;
      fs.renameSync(f.project, moved);
      fs.mkdirSync(f.project);
    }
    const descriptor = originalOpen.call(this, filename, flags, ...args);
    if (replaced && fs.existsSync(path.join(f.project, '.ludory-components.lock'))) replacementEverLocked = true;
    return descriptor;
  };
  try { assert.throws(() => applyComponentPlan(plan), process.platform === 'win32'
    ? /changed|stale|identity|root|ENOENT|EPERM|EBUSY/i : /changed|stale|identity|root|ENOENT/i); }
  finally { fs.openSync = originalOpen; }
  assert.equal(replaced, true);
  assert.equal(replacementEverLocked, false);
  assert.equal(fs.existsSync(path.join(f.project, '.ludory-components.lock')), false);
  // Windows may refuse to rename the CWD-held original rather than allow a
  // substitution; both a refusal and an aborted changed-root operation are safe.
  const originalLocation = fs.existsSync(moved) ? moved : f.project;
  assert.equal(fs.readFileSync(path.join(originalLocation, 'src', 'main.js'), 'utf8'), 'export const version = 1;\n');
});

test('Windows-style root substitution during lock acquisition never writes a lock into the replacement', t => {
  if (process.platform === 'win32') return t.skip('Linux-only simulation of Windows pathname anchoring');
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const moved = path.join(f.root, 'moved-game');
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalOpen = fs.openSync;
  let swapped = false;
  let replacementEverLocked = false;
  fs.openSync = function (filename, flags, ...args) {
    if (!swapped && anchoredBasename(filename, '.ludory-components.lock')) {
      swapped = true;
      fs.renameSync(f.project, moved);
      fs.mkdirSync(f.project);
    }
    const fd = originalOpen.call(this, filename, flags, ...args);
    if (swapped && fs.existsSync(path.join(f.project, '.ludory-components.lock'))) replacementEverLocked = true;
    return fd;
  };
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
  try { assert.throws(() => applyComponentPlan(plan), /changed|root|stale|identity|ENOENT/i); }
  finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    fs.openSync = originalOpen;
  }
  assert.equal(swapped, true);
  assert.equal(replacementEverLocked, false);
  assert.equal(fs.existsSync(path.join(f.project, '.ludory-components.lock')), false);
  assert.equal(fs.readFileSync(path.join(moved, 'src', 'main.js'), 'utf8'), 'export const version = 1;\n');
});

test('Windows-style root substitution before staging cannot create an archive in the replacement', t => {
  if (process.platform === 'win32') return t.skip('Linux-only simulation of Windows pathname anchoring');
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const moved = path.join(f.root, 'original-stage-root');
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalMkdtemp = fs.mkdtempSync;
  let swapped = false;
  let replacementEverStaged = false;
  fs.mkdtempSync = function (prefix, ...args) {
    if (!swapped && String(prefix).includes('.ludory-components-backup-')) {
      swapped = true;
      fs.renameSync(f.project, moved);
      fs.mkdirSync(f.project);
    }
    const result = originalMkdtemp.call(this, prefix, ...args);
    if (swapped && fs.readdirSync(f.project).some(name => name.startsWith('.ludory-components-backup-'))) {
      replacementEverStaged = true;
    }
    return result;
  };
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
  try { assert.throws(() => applyComponentPlan(plan), /changed|root|stale|identity|ENOENT/i); }
  finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    fs.mkdtempSync = originalMkdtemp;
  }
  assert.equal(swapped, true);
  assert.equal(replacementEverStaged, false);
  assert.equal(fs.readFileSync(path.join(moved, 'src', 'main.js'), 'utf8'), 'export const version = 1;\n');
});

test('Windows-style replacement after creating the stage cannot receive archive bytes', t => {
  if (process.platform === 'win32') return t.skip('Linux-only simulation of Windows pathname anchoring');
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const moved = path.join(f.root, 'moved-staged-game');
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalLstat = fs.lstatSync;
  let swapped = false;
  let stagedName;
  fs.lstatSync = function (filename, ...args) {
    const pathValue = String(filename);
    if (!swapped && /(?:^|[\\/])\.ludory-components-backup-[^\\/]+$/.test(pathValue)) {
      swapped = true;
      stagedName = path.basename(pathValue);
      fs.renameSync(f.project, moved);
      fs.mkdirSync(f.project);
      fs.mkdirSync(path.join(f.project, stagedName));
    }
    return originalLstat.call(this, filename, ...args);
  };
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
  try { assert.throws(() => applyComponentPlan(plan), /changed|root|stale|identity|ENOENT/i); }
  finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    fs.lstatSync = originalLstat;
  }
  assert.equal(swapped, true);
  const replacementArchive = path.join(f.project, stagedName);
  assert.deepEqual(fs.readdirSync(replacementArchive), []);
  assert.equal(fs.readFileSync(path.join(moved, 'src', 'main.js'), 'utf8'), 'export const version = 1;\n');
});

test('Windows-held flat archive and project root must prevent rename while publication paths rely on them', t => {
  if (process.platform !== 'win32') return t.skip('Windows filesystem semantics only');
  const f = fixture(t);
  const archive = fs.mkdtempSync(path.join(f.project, '.ludory-components-backup-'));
  const heldFd = fs.openSync(archive, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
  try {
    for (const target of [archive, f.project]) {
      const renamed = `${target}-renamed`;
      let moved = false;
      let error;
      try { fs.renameSync(target, renamed); moved = true; }
      catch (cause) { error = cause; }
      finally { if (moved) fs.renameSync(renamed, target); }
      assert.equal(moved, false, `A held flat archive must reject Windows rename: ${target}`);
      assert.match(error?.code ?? '', /^(?:EPERM|EACCES|EBUSY)$/,
        `Unexpected filesystem error while checking Windows pin: ${target}`);
    }
  } finally {
    fs.closeSync(heldFd);
  }
});

test('Windows-style flat staged file swap with identical bytes cannot publish an external hardlink', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const outside = path.join(f.root, 'outside-identical.js');
  fs.writeFileSync(outside, 'export const version = 2;\n');
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const simulateWindows = process.platform !== 'win32';
  const originalLink = fs.linkSync;
  let swapped = false;
  fs.linkSync = function (source, destination, ...args) {
    if (!swapped && /[\\/]new-0$/.test(String(source))) {
      swapped = true;
      fs.renameSync(source, `${source}-held`);
      originalLink.call(this, outside, source);
    }
    return originalLink.call(this, source, destination, ...args);
  };
  if (simulateWindows) Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
  try { assert.throws(() => applyComponentPlan(plan), /staged|identity|hardlink|rollback|changed|EPERM|EBUSY/i); }
  finally {
    if (simulateWindows) Object.defineProperty(process, 'platform', originalPlatform);
    fs.linkSync = originalLink;
  }
  assert.equal(swapped, true);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'export const version = 2;\n');
  assert.equal(fs.existsSync(f.gameApp) && fs.statSync(f.gameApp).ino === fs.statSync(outside).ino, false);
});

test('Windows-style swapped backup slot cannot restore unrelated bytes during rollback', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const outside = path.join(f.root, 'external-backup.js');
  fs.writeFileSync(outside, 'EXTERNAL USER CONTENT\n');
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const simulateWindows = process.platform !== 'win32';
  const originalLink = fs.linkSync;
  let swapped = false;
  fs.linkSync = function (source, destination, ...args) {
    if (!swapped && transactionPath(source) && anchoredBasename(destination, 'ludory.components.json')) {
      swapped = true;
      const archive = fs.readdirSync(f.project).find(name => name.startsWith('.ludory-components-backup-'));
      const backupFile = path.join(f.project, archive, 'backup-0');
      fs.renameSync(backupFile, `${backupFile}-original`);
      originalLink.call(this, outside, backupFile);
      throw new Error('forced state publish failure');
    }
    return originalLink.call(this, source, destination, ...args);
  };
  if (simulateWindows) Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
  try { assert.throws(() => applyComponentPlan(plan), /forced state publish failure|EPERM|EBUSY/i); }
  finally {
    if (simulateWindows) Object.defineProperty(process, 'platform', originalPlatform);
    fs.linkSync = originalLink;
  }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(f.gameApp) && fs.readFileSync(f.gameApp, 'utf8') === 'EXTERNAL USER CONTENT\n', false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'EXTERNAL USER CONTENT\n');
  assert.equal(fs.existsSync(path.join(f.project, '.ludory-components.lock')), true);
});

test('Windows-style swapped quarantine slot cannot relink an external inode into the game', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const outside = path.join(f.root, 'external-quarantine.js');
  fs.writeFileSync(outside, 'export const version = 2;\n');
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const simulateWindows = process.platform !== 'win32';
  const originalLink = fs.linkSync;
  const originalRename = fs.renameSync;
  let swapped = false;
  fs.linkSync = function (source, destination, ...args) {
    if (transactionPath(source) && anchoredBasename(destination, 'ludory.components.json')) {
      throw new Error('forced rollback after first component publish');
    }
    return originalLink.call(this, source, destination, ...args);
  };
  fs.renameSync = function (source, destination, ...args) {
    const result = originalRename.call(this, source, destination, ...args);
    if (!swapped && /[\\/]quarantine-0$/.test(String(destination))) {
      swapped = true;
      originalRename.call(this, destination, `${destination}-original`);
      originalLink.call(this, outside, destination);
    }
    return result;
  };
  if (simulateWindows) Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });
  try { assert.throws(() => applyComponentPlan(plan), /rollback|quarantine|modified|recovery|EPERM|EBUSY/i); }
  finally {
    if (simulateWindows) Object.defineProperty(process, 'platform', originalPlatform);
    fs.linkSync = originalLink;
    fs.renameSync = originalRename;
  }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(f.gameApp) && fs.statSync(f.gameApp).ino === fs.statSync(outside).ino, false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'export const version = 2;\n');
});

test('replacing a staged new-directory during publish blocks the transaction without external reads', t => {
  const f = fixture(t);
  version2(f);
  const outside = path.join(f.root, 'outside-staged');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, '0'), 'outside author bytes\n');
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalLink = fs.linkSync;
  let swapped = false;
  fs.linkSync = function (source, destination, ...args) {
    if (!swapped && transactionPath(source) && (physicalPath(source).includes(`${path.sep}new${path.sep}`) ||
        /[\\/]new-[0-9]+$/.test(physicalPath(source)))) {
      swapped = true;
      if (/[\\/]new-[0-9]+$/.test(physicalPath(source))) {
        const originalSource = physicalPath(source);
        fs.renameSync(originalSource, `${originalSource}-held`);
        fs.symlinkSync(path.join(outside, '0'), originalSource, 'file');
      } else {
        const newDir = path.dirname(physicalPath(source));
        fs.renameSync(newDir, `${newDir}-held`);
        fs.symlinkSync(outside, newDir, 'dir');
      }
    }
    return originalLink.call(this, source, destination, ...args);
  };
  try { assert.throws(() => applyComponentPlan(plan), /changed|unsafe|rollback|conflict|symbolic|EPERM|EACCES|EINVAL/i); }
  finally { fs.linkSync = originalLink; }
  assert.equal(swapped, true);
  assert.equal(fs.readFileSync(path.join(outside, '0'), 'utf8'), 'outside author bytes\n');
});

test('a metadata durability failure blocks apply before publishing any managed bytes', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const originalSync = fs.fsyncSync;
  let injected = false;
  fs.fsyncSync = function (fd) {
    if (!injected) { injected = true; throw new Error('injected fsync failure'); }
    return originalSync.call(this, fd);
  };
  try { assert.throws(() => applyComponentPlan(plan), /fsync failure/); }
  finally { fs.fsyncSync = originalSync; }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(f.gameApp, 'utf8'), 'export const version = 1;\n');
});

test('game manifest target drift invalidates component update compatibility', t => {
  const f = fixture(t, { availableTargets: ['vk-games', 'yandex-games'] });
  version2(f);
  const manifestPath = path.join(f.project, 'ludory.project.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.targets = ['yandex-games']; // valid in the current profile, but not the originally created game contract
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.notEqual(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'READY');
});

test('open editor descriptor modifying an original during apply cannot lose the edit', t => {
  const f = fixture(t);
  version2(f);
  const plan = planComponentUpdate(f.project, { catalog: f.catalog });
  const fd = fs.openSync(f.gameApp, 'r+');
  const originalLink = fs.linkSync;
  let wrote = false;
  fs.linkSync = function (source, dest, ...args) {
    if (!wrote && transactionPath(source) && anchoredBasename(dest, 'main.js')) {
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
    if (!rollback && transactionPath(source) && anchoredBasename(dest, 'ludory.components.json')) {
      rollback = true;
      throw new Error('simulated publish failure');
    }
    return originalLink.call(this, source, dest, ...args);
  };
  fs.readFileSync = function (filename, ...args) {
    const bytes = originalRead.call(this, filename, ...args);
    if (rollback && !userEdit && anchoredBasename(filename, 'main.js')) {
      userEdit = true;
      fs.writeFileSync(filename, 'USER EDIT DURING ROLLBACK\n');
    }
    return bytes;
  };
  try { assert.throws(() => applyComponentPlan(plan), /incomplete.*rollback|user edit|modified/i); }
  finally { fs.linkSync = originalLink; fs.readFileSync = originalRead; }
  assert.equal(userEdit, true);
  const archive = fs.readdirSync(f.project).find(name => name.startsWith('.ludory-components-backup-'));
  assert.ok(archive);
  // On a post-rename race, a safe rollback retains the modified inode in
  // quarantine instead of re-linking an untrusted pathname into the game.
  assert.match(fs.readFileSync(path.join(f.project, archive, 'quarantine', '0'), 'utf8'), /USER EDIT DURING ROLLBACK/);
  assert.equal(fs.existsSync(f.gameApp), false);
  assert.equal(fs.existsSync(path.join(f.project, '.ludory-components.lock')), true);
  assert.equal(planComponentUpdate(f.project, { catalog: f.catalog }).status, 'CONFLICT');
});
