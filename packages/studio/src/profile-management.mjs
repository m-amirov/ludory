import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defineGame } from '@ludory/core';
import { loadCatalog } from './catalog.mjs';
import { readSourceFile } from './legacy.mjs';
import { projectRoot, directoryIdentity, isOriginalDirectory } from './projects.mjs';
import { readProfileState, readRegular, profileSnapshot, sha256, encode, ACTIVE_PROFILE } from './profile-state.mjs';

function semverOrder(a, b) {
  function parse(version) {
    const withoutBuild = version.split('+')[0];
    const dash = withoutBuild.indexOf('-');
    const base = dash < 0 ? withoutBuild : withoutBuild.slice(0, dash);
    const prerelease = dash < 0 ? undefined : withoutBuild.slice(dash + 1);
    const parts = base.split('.').map(v => BigInt(v));
    return { parts, prerelease: prerelease?.split('.') ?? [] };
  }
  const left = parse(a), right = parse(b);
  for (let index = 0; index < 3; index++) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1;
  }
  if (!left.prerelease.length && right.prerelease.length) return 1;
  if (left.prerelease.length && !right.prerelease.length) return -1;
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const l = left.prerelease[i], r = right.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return BigInt(l) > BigInt(r) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

function gameManifest(project) {
  const { text, source } = readSourceFile(project, 'ludory.project.json');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Existing Ludory manifest is invalid JSON'); }
  return { manifest: defineGame(data), sha256: source.sha256 };
}

function result(mode, project, status, conflicts = [], other = {}) {
  return { mode, project, status, writes: [], conflicts, ...other };
}

function profileCompatibility(profile, manifest) {
  const problems = [];
  if (profile.engine !== manifest.engine) problems.push(`Profile engine ${profile.engine} differs from game engine ${manifest.engine}`);
  const unsupported = manifest.targets.filter(target => !profile.targets.includes(target));
  if (unsupported.length) problems.push(`Profile does not support game targets: ${unsupported.join(', ')}`);
  return problems;
}

function prepared(mode, project, manifestData, profile, state, options) {
  const bytes = profileSnapshot(profile);
  const snapshotSha256 = sha256(bytes);
  const revision = { id: profile.id, version: profile.version, sourceSha256: profile.sourceSha256, snapshotSha256 };
  const prior = state.installed ? state.value : null;
  const generation = prior ? prior.generation + 1 : 0;
  const active = { schemaVersion: 1, generation, profile: revision, history: prior ? [prior.profile, ...prior.history] : [] };
  const activeBytes = encode(active);
  const nextPointer = generation === 0 ? ACTIVE_PROFILE : `.ludory/profiles/revisions/${String(generation).padStart(8, '0')}.json`;
  const writes = [`${'.ludory/profiles/snapshots'}/${snapshotSha256}.json`, nextPointer];
  const plan = result(mode, project, 'READY', [], {
    profile: { id: profile.id, version: profile.version },
    snapshotSha256, writes, generation,
    rootIdentity: directoryIdentity(project),
    manifestSha256: manifestData.sha256,
    expectedStateSha256: state.installed ? state.sha256 : null,
    options,
  });
  plan.fingerprint = sha256(encode({ mode, project, snapshotSha256, writes,
    rootIdentity: plan.rootIdentity, manifestSha256: plan.manifestSha256,
    expectedStateSha256: plan.expectedStateSha256, activeSha256: sha256(activeBytes), generation, options }));
  Object.defineProperty(plan, '_snapshot', { value: { bytes, activeBytes, revision }, enumerable: false });
  return plan;
}

function loadGame(project) {
  try { return { value: gameManifest(project) }; }
  catch (error) { return { error: error.message }; }
}

function loadState(project) {
  try { return { value: readProfileState(project) }; }
  catch (error) { return { error: error.message }; }
}

/** Preview assigning a profile without assuming ownership of existing project files. */
export function planProfileApply(projectDir, { name, catalog } = {}) {
  const project = projectRoot(projectDir);
  const absoluteCatalog = catalog === undefined ? undefined : path.resolve(catalog);
  if (typeof name !== 'string' || !name) return result('profile-apply', project, 'BLOCKED', ['Explicit profile --name required']);
  const game = loadGame(project);
  if (game.error) return result('profile-apply', project, 'BLOCKED', [game.error]);
  const profile = loadCatalog(absoluteCatalog).profiles.get(name);
  if (!profile) return result('profile-apply', project, 'BLOCKED', [`Unknown profile: ${name}`]);
  const problems = profileCompatibility(profile, game.value.manifest);
  if (problems.length) return result('profile-apply', project, 'BLOCKED', problems);
  const current = loadState(project);
  if (current.error) return result('profile-apply', project, 'CONFLICT', [current.error]);
  if (current.value.installed) {
    const installed = current.value.value.profile;
    if (installed.id !== name) return result('profile-apply', project, 'CONFLICT', ['Another profile is already active; switching is not supported']);
    if (installed.version !== profile.version || installed.sourceSha256 !== profile.sourceSha256) {
      return result('profile-apply', project, 'CONFLICT', ['Existing profile differs: use profiles update after reviewing changes']);
    }
    return result('profile-apply', project, 'IN_SYNC', [], { profile: { id: name, version: profile.version } });
  }
  return prepared('profile-apply', project, game.value, profile, current.value, { name, catalog: absoluteCatalog });
}

/** Preview upgrading an already installed profile; never infer identity from source code or a template receipt. */
export function planProfileUpdate(projectDir, { catalog } = {}) {
  const project = projectRoot(projectDir);
  const absoluteCatalog = catalog === undefined ? undefined : path.resolve(catalog);
  const game = loadGame(project);
  if (game.error) return result('profile-update', project, 'BLOCKED', [game.error]);
  const current = loadState(project);
  if (current.error) return result('profile-update', project, 'CONFLICT', [current.error]);
  if (!current.value.installed) return result('profile-update', project, 'BLOCKED', ['No managed Ludory profile is installed']);
  const installed = current.value.value.profile;
  const profile = loadCatalog(absoluteCatalog).profiles.get(installed.id);
  if (!profile) return result('profile-update', project, 'BLOCKED', [`Missing profile from catalog: ${installed.id}`]);
  const problems = profileCompatibility(profile, game.value.manifest);
  if (problems.length) return result('profile-update', project, 'BLOCKED', problems);
  const order = semverOrder(profile.version, installed.version);
  if (order < 0) return result('profile-update', project, 'CONFLICT', ['Catalog profile version is older than the installed version']);
  if (order === 0) {
    if (profile.version !== installed.version || profile.sourceSha256 !== installed.sourceSha256) {
      return result('profile-update', project, 'CONFLICT', ['Profile source changed without increasing its SemVer version']);
    }
    return result('profile-update', project, 'IN_SYNC', [], { profile: { id: installed.id, version: installed.version } });
  }
  if (current.value.value.history.length >= 256 || current.value.value.generation >= 256) {
    return result('profile-update', project, 'CONFLICT', ['Profile revision history limit reached; archive/owner migration required']);
  }
  return prepared('profile-update', project, game.value, profile, current.value, { catalog: absoluteCatalog });
}

/** Report exact installed metadata, source availability and local checksum drift without mutations. */
export function profileStatus(projectDir, { catalog } = {}) {
  const project = projectRoot(projectDir);
  const current = loadState(project);
  if (current.error) return result('profile-status', project, 'CONFLICT', [current.error]);
  if (!current.value.installed) return result('profile-status', project, 'BLOCKED', ['No managed Ludory profile is installed']);
  const proposed = planProfileUpdate(project, { catalog });
  return result('profile-status', project, proposed.status, proposed.conflicts, {
    profile: { id: current.value.value.profile.id, version: current.value.value.profile.version },
    available: proposed.status === 'READY' ? proposed.profile : null,
    currentSourceSha256: current.value.value.profile.sourceSha256,
    stateSha256: current.value.sha256,
  });
}

const exclusive = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);

function mkdirAndEnter(name, created, prefix, required = 'any') {
  let createdNow = false;
  try {
    if (required === 'existing') {
      fs.lstatSync(name);
    } else {
      fs.mkdirSync(name);
      createdNow = true;
    }
  } catch (error) {
    if (error.code !== 'EEXIST' || required === 'create') {
      throw new Error(`Profile directory collision or missing expected directory: ${prefix}${name}: ${error.message}`, { cause: error });
    }
  }
  if (required === 'create' && !createdNow) throw new Error(`Unowned profile directory appeared: ${prefix}${name}`);
  const stat = fs.lstatSync(name);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe profile directory: ${name}`);
  process.chdir(name);
  if (directoryIdentity('.') !== `${BigInt(stat.dev)}:${BigInt(stat.ino)}`) {
    throw new Error(`Profile directory was replaced while entering: ${name}`);
  }
  if (createdNow) created.push({ relative: `${prefix}${name}`, dev: stat.dev, ino: stat.ino });
}

function checkAndEnter(name) {
  const st = fs.lstatSync(name);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`Unsafe profile directory: ${name}`);
  process.chdir(name);
  if (directoryIdentity('.') !== `${BigInt(st.dev)}:${BigInt(st.ino)}`) throw new Error(`Profile directory was replaced: ${name}`);
}

function writtenFile(name, bytes, files, prefix = '.ludory/profiles/') {
  const fd = fs.openSync(name, exclusive, 0o600);
  const st = fs.fstatSync(fd);
  const record = { relative: `${prefix}${name}`, bytes, dev: st.dev, ino: st.ino };
  files.push(record);
  try { fs.writeFileSync(fd, bytes); }
  finally { fs.closeSync(fd); }
  return record;
}

function enteredDirectory(project, relative, rootIdentity) {
  process.chdir(project);
  if (directoryIdentity('.') !== rootIdentity) throw new Error('Project identity changed during rollback');
  const segments = relative.split('/');
  const basename = segments.pop();
  for (const segment of segments) checkAndEnter(segment);
  return basename;
}

function safeCleanupFile(project, rootIdentity, record) {
  try {
    const name = enteredDirectory(project, record.relative, rootIdentity);
    const stat = fs.lstatSync(name);
    const actual = stat.isFile() && !stat.isSymbolicLink() ? fs.readFileSync(name) : null;
    if (!actual || stat.ino !== record.ino || stat.dev !== record.dev ||
        // Failed writes may be a valid prefix; leave everything else alone.
        actual.length > record.bytes.length || !actual.equals(record.bytes.subarray(0, actual.length))) {
      return `modified or replaced file retained: ${record.relative}`;
    }
    const quarantine = `.ludory-rollback-${crypto.randomBytes(20).toString('hex')}`;
    fs.renameSync(name, quarantine);
    const moved = fs.lstatSync(quarantine);
    const movedBytes = moved.isFile() && !moved.isSymbolicLink() ? fs.readFileSync(quarantine) : null;
    if (!movedBytes || moved.ino !== record.ino || moved.dev !== record.dev ||
        movedBytes.length > record.bytes.length || !movedBytes.equals(record.bytes.subarray(0, movedBytes.length))) {
      try { fs.linkSync(quarantine, name); fs.unlinkSync(quarantine); }
      catch { return `concurrent replacement retained in ${quarantine}`; }
      return `concurrent replacement retained: ${record.relative}`;
    }
    fs.unlinkSync(quarantine);
    return null;
  } catch (error) { return `${record.relative}: ${error.message}`; }
}

function safeCleanupDirectory(project, rootIdentity, record) {
  try {
    const name = enteredDirectory(project, record.relative, rootIdentity);
    const stat = fs.lstatSync(name);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino !== record.ino || stat.dev !== record.dev) {
      return `moved directory retained: ${record.relative}`;
    }
    fs.rmdirSync(name);
    return null;
  } catch (error) { return `${record.relative}: ${error.message}`; }
}

function sourceStillValid(plan) {
  const current = gameManifest(plan.project);
  if (current.sha256 !== plan.manifestSha256) throw new Error('Stale plan: game manifest changed during apply');
  const catalog = loadCatalog(plan.options.catalog);
  const source = catalog.profiles.get(plan.profile.id);
  if (!source || source.version !== plan.profile.version ||
      sha256(profileSnapshot(source)) !== plan.snapshotSha256 ||
      profileCompatibility(source, current.manifest).length) {
    throw new Error('Stale plan: profile source or game compatibility changed during apply');
  }
}

function managedLocationIsOriginal(project, parentIdentity, profileIdentity) {
  try {
    const parent = path.join(project, '.ludory');
    const directory = path.join(parent, 'profiles');
    const realParent = fs.realpathSync.native(parent);
    const realDirectory = fs.realpathSync.native(directory);
    const same = (left, right) => process.platform === 'win32'
      ? left.toLowerCase() === right.toLowerCase() : left === right;
    return same(realParent, parent) && same(realDirectory, directory) &&
      directoryIdentity(parent) === parentIdentity && directoryIdentity(directory) === profileIdentity;
  } catch { return false; }
}

/** Exclusive-file transaction; a publish changes only the managed active pointer. */
export function applyProfilePlan(plan) {
  if (!plan || !['profile-apply', 'profile-update'].includes(plan.mode) || plan.status !== 'READY') {
    throw new Error('Only a READY profile apply/update plan may be applied');
  }
  const fresh = plan.mode === 'profile-apply' ? planProfileApply(plan.project, plan.options)
    : planProfileUpdate(plan.project, plan.options);
  if (fresh.status !== 'READY' || !plan.fingerprint || fresh.fingerprint !== plan.fingerprint ||
      fresh.rootIdentity !== plan.rootIdentity || !isOriginalDirectory(plan.project, plan.rootIdentity)) {
    throw new Error(`Stale profile plan or conflict: ${fresh.conflicts?.join('; ') || fresh.status}`);
  }
  const previousCwd = process.cwd();
  const createdFiles = [];
  const createdDirectories = [];
  let published = false;
  let ownedLock = null;
  const isUpdate = plan.mode === 'profile-update';
  try {
    process.chdir(plan.project);
    if (directoryIdentity('.') !== plan.rootIdentity) throw new Error('Project directory changed before apply');
    mkdirAndEnter('.ludory', createdDirectories, '');
    const parentIdentity = directoryIdentity('.');
    mkdirAndEnter('profiles', createdDirectories, '.ludory/', isUpdate ? 'existing' : 'create');
    // All output opens below are anchored to the verified profile directory
    // inode, including if its parent names are replaced after chdir.
    const profileIdentity = directoryIdentity('.');
    ownedLock = writtenFile('.lock', crypto.randomBytes(32), createdFiles);
    const snapshotName = `${plan.snapshotSha256}.json`;
    mkdirAndEnter('snapshots', createdDirectories, '.ludory/profiles/');
    try {
      try {
        const existing = readRegular(snapshotName, 'profile snapshot');
        if (sha256(existing) !== plan.snapshotSha256 || !existing.equals(fresh._snapshot.bytes)) {
          throw new Error('Conflicting immutable profile snapshot');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        writtenFile(snapshotName, fresh._snapshot.bytes, createdFiles, '.ludory/profiles/snapshots/');
      }
    } finally { process.chdir('..'); }
    if (directoryIdentity('.') !== profileIdentity) throw new Error('Profile directory moved during apply');

    const staging = `.pending-${crypto.randomBytes(18).toString('hex')}`;
    const staged = writtenFile(staging, fresh._snapshot.activeBytes, createdFiles);
    sourceStillValid(plan);
    if (!isOriginalDirectory(plan.project, plan.rootIdentity) || directoryIdentity('.') !== profileIdentity ||
        !managedLocationIsOriginal(plan.project, parentIdentity, profileIdentity)) {
      throw new Error('Project or profile directory moved during apply');
    }
    // Revalidate every recorded snapshot after staging. A concurrent writer
    // changing an old or incoming blob must stop this update before commit.
    let beforeCommit;
    if (isUpdate) {
      beforeCommit = readProfileState(plan.project, { transient: ['.lock', staging] });
      if (beforeCommit.sha256 !== plan.expectedStateSha256) throw new Error('Stale plan: managed profile state or snapshot changed');
    }
    checkAndEnter('snapshots');
    try {
      const verified = readRegular(snapshotName, 'incoming profile snapshot');
      if (sha256(verified) !== plan.snapshotSha256 || !verified.equals(fresh._snapshot.bytes)) {
        throw new Error('Incoming profile snapshot changed before publication');
      }
    } finally { process.chdir('..'); }
    if (directoryIdentity('.') !== profileIdentity) throw new Error('Profile directory changed during verification');
    const stagedBytes = readRegular(staging, 'staged profile state');
    if (!stagedBytes.equals(fresh._snapshot.activeBytes)) throw new Error('Staged profile state changed before publication');
    if (isUpdate) {
      // Neither directory exists at generation zero. Own it only by an
      // exclusive mkdir, after validation, not by adopting a foreign path.
      mkdirAndEnter('history', createdDirectories, '.ludory/profiles/', plan.generation === 1 ? 'create' : 'existing');
      try {
        const filename = `${plan.expectedStateSha256}.json`;
        try {
          const existing = readRegular(filename, 'profile history');
          if (!existing.equals(beforeCommit.bytes)) throw new Error('Conflicting profile history snapshot');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          writtenFile(filename, beforeCommit.bytes, createdFiles, '.ludory/profiles/history/');
        }
      } finally { process.chdir('..'); }
      mkdirAndEnter('revisions', createdDirectories, '.ludory/profiles/', plan.generation === 1 ? 'create' : 'existing');
      const commitName = `${String(plan.generation).padStart(8, '0')}.json`;
      try {
        // Link is atomic and EXCLUSIVE; concurrent user files are never
        // replaced. The newest valid consecutive revision is the pointer.
        fs.linkSync(`../${staging}`, commitName);
        published = true;
      } finally { process.chdir('..'); }
    } else {
      // An exclusive hard-link commit prevents overwriting a concurrently
      // created foreign active.json during first adoption.
      fs.linkSync(staging, 'active.json');
      published = true;
    }
    const stageProblem = safeCleanupFile(plan.project, plan.rootIdentity, staged);
    if (stageProblem) throw new Error(`Profile published, but pending staging could not be cleared: ${stageProblem}`);
    const committed = readProfileState(plan.project, { transient: ['.lock'] });
    if (committed.sha256 !== sha256(fresh._snapshot.activeBytes)) {
      throw new Error('Profile published but active state changed concurrently; investigate recovery snapshots');
    }
    const lockProblem = safeCleanupFile(plan.project, plan.rootIdentity, ownedLock);
    if (lockProblem) throw new Error(`Profile published, but its lock could not be cleared: ${lockProblem}`);
    return { ...fresh, status: 'APPLIED', applied: true };
  } catch (error) {
    const issues = [];
    if (!published && isOriginalDirectory(plan.project, plan.rootIdentity)) {
      for (const file of createdFiles.reverse()) {
        const issue = safeCleanupFile(plan.project, plan.rootIdentity, file);
        if (issue) issues.push(issue);
      }
      for (const dir of createdDirectories.reverse()) {
        const issue = safeCleanupDirectory(plan.project, plan.rootIdentity, dir);
        if (issue) issues.push(issue);
      }
    }
    if (issues.length) throw new Error(`${error.message}; incomplete rollback: ${issues.join('; ')}`, { cause: error });
    throw error;
  } finally {
    process.chdir(previousCwd);
  }
}
