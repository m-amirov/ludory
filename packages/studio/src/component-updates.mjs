import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defineGame } from '@ludory/core';
import { loadCatalog, isStudioComponentPath } from './catalog.mjs';
import { projectRoot, directoryIdentity, isOriginalDirectory } from './projects.mjs';

const stateName = 'ludory.components.json';
const lockName = '.ludory-components.lock';
const stagingPrefix = '.ludory-components-update-';
const backupPrefix = '.ludory-components-backup-';
const hashPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.+-]+)?$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const result = (project, status, conflicts = [], more = {}) => ({
  mode: 'component-update', project, status, writes: [], conflicts, ...more,
});

function exact(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} fields`);
  }
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') ||
      value.includes('\0') || value.startsWith('/') || value.split('/').some(part =>
        !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error(`Unsafe managed path: ${String(value)}`);
  }
  if (!isStudioComponentPath(value)) throw new Error(`Protected managed path: ${value}`);
  return value;
}

function secureFile(filename, label, maxSize = 2 * 1024 * 1024) {
  const stat = fs.lstatSync(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(maxSize)) {
    throw new Error(`Unsafe ${label}: symbolic, hardlinked or oversized file`);
  }
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || !opened.isFile() || opened.nlink !== 1n) {
      throw new Error(`Changed ${label} identity while reading`);
    }
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function checkedFile(project, name) {
  const parts = safeRelative(name).split('/');
  checkedParent(project, name);
  return secureFile(path.join(project, ...parts), `managed file ${name}`);
}

function checkedParent(project, name) {
  const parts = safeRelative(name).split('/');
  let current = project;
  for (const segment of parts.slice(0, -1)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    const canonical = fs.realpathSync.native(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        (process.platform === 'win32' ? canonical.toLowerCase() !== current.toLowerCase() : canonical !== current)) {
      throw new Error(`Unsafe managed directory: ${name}`);
    }
  }
  return path.join(project, ...parts);
}

function checkedNewFile(project, name) {
  const destination = checkedParent(project, name);
  try { fs.lstatSync(destination); throw new Error(`New component collides with existing file: ${name}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function readState(project) {
  const filename = path.join(project, stateName);
  const bytes = secureFile(filename, 'component ownership state');
  let state;
  try { state = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Invalid component state JSON'); }
  exact(state, ['schemaVersion', 'template', 'files'], 'component state');
  exact(state.template, ['id', 'version', 'profile', 'origin', 'sourceSha256'], 'component template');
  if (state.schemaVersion !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.template.id) ||
      !versionPattern.test(state.template.version) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.template.profile) ||
      !['builtin', 'local'].includes(state.template.origin) ||
      !hashPattern.test(state.template.sourceSha256) ||
      state.files === null || typeof state.files !== 'object' || Array.isArray(state.files)) {
    throw new Error('Invalid component ownership state');
  }
  const entries = Object.entries(state.files);
  if (!entries.length || entries.length > 256) throw new Error('Invalid managed component file count');
  for (const [name, expected] of entries) {
    safeRelative(name);
    if (!hashPattern.test(expected)) throw new Error(`Invalid managed hash: ${name}`);
  }
  if (!encode(state).equals(bytes)) throw new Error('Component state is not canonical');
  return { state, bytes, sha256: hash(bytes) };
}

function versionCompare(a, b) {
  const split = version => {
    const withoutBuild = version.split('+')[0];
    const separator = withoutBuild.indexOf('-');
    const base = separator < 0 ? withoutBuild : withoutBuild.slice(0, separator);
    const [major, minor, patch] = base.split('.');
    const prerelease = separator < 0 ? undefined : withoutBuild.slice(separator + 1);
    return { parts: [BigInt(major), BigInt(minor), BigInt(patch)], pre: prerelease?.split('.') ?? [] };
  };
  const left = split(a), right = split(b);
  for (let i = 0; i < 3; i++) if (left.parts[i] !== right.parts[i]) return left.parts[i] > right.parts[i] ? 1 : -1;
  if (!left.pre.length || !right.pre.length) return left.pre.length ? -1 : right.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i], r = right.pre[i];
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

/** Pure preview. Only files recorded by a new Studio create are updateable. */
export function planComponentUpdate(projectDir, { catalog } = {}) {
  const project = projectRoot(projectDir);
  const catalogPath = catalog === undefined ? undefined : path.resolve(catalog);
  const options = { catalog: catalogPath };
  const projectEntries = fs.readdirSync(project);
  if (projectEntries.includes(lockName) || projectEntries.some(entry => entry.startsWith(stagingPrefix))) {
    return result(project, 'CONFLICT', ['Unfinished component update transaction: inspect lock and retained backups before retry']);
  }
  let installed;
  try { installed = readState(project); }
  catch (error) {
    return result(project, error.code === 'ENOENT' ? 'BLOCKED' : 'CONFLICT', [
      error.code === 'ENOENT' ? 'No explicit Studio component ownership; historical receipts cannot authorize updates' : error.message,
    ]);
  }
  let manifest;
  let manifestSha256;
  try {
    const bytes = secureFile(path.join(project, 'ludory.project.json'), 'game manifest');
    manifest = defineGame(JSON.parse(bytes.toString('utf8')));
    manifestSha256 = hash(bytes);
  } catch (error) { return result(project, 'BLOCKED', [`Game manifest invalid: ${error.message}`]); }
  const conflicts = [];
  for (const [name, sha256] of Object.entries(installed.state.files)) {
    try {
      if (hash(checkedFile(project, name)) !== sha256) conflicts.push(`Managed file modified: ${name}`);
    } catch (error) { conflicts.push(`Managed file unavailable/unsafe: ${name}: ${error.message}`); }
  }
  if (conflicts.length) return result(project, 'CONFLICT', conflicts);

  let template, profile;
  try {
    const loaded = loadCatalog(catalogPath);
    template = loaded.templates.get(installed.state.template.id);
    if (template) profile = loaded.profiles.get(template.profile);
  } catch (error) { return result(project, 'BLOCKED', [error.message]); }
  if (!template || !profile || template.origin !== installed.state.template.origin) {
    return result(project, 'BLOCKED', ['Installed template is unavailable in the selected catalog']);
  }
  if (template.profile !== installed.state.template.profile) {
    return result(project, 'CONFLICT', ['Template profile identity changed; automatic profile switching is forbidden']);
  }
  if (manifest.engine !== template.engine || template.engine !== profile.engine ||
      manifest.targets.some(target => !template.targets.includes(target) || !profile.targets.includes(target))) {
    return result(project, 'BLOCKED', ['Updated template/profile incompatible with game engine or targets']);
  }
  const old = installed.state.template;
  const order = versionCompare(template.version, old.version);
  if (order < 0) return result(project, 'CONFLICT', ['Template downgrade is not allowed']);
  const previousNames = Object.keys(installed.state.files);
  const newNames = template.files.filter(isStudioComponentPath);
  if (previousNames.some(name => !newNames.includes(name))) {
    return result(project, 'CONFLICT', ['Template removes managed file paths; manual upgrade required']);
  }
  const nextFiles = Object.create(null);
  for (const name of newNames) {
    nextFiles[name] = template.assets.get(name).sha256;
    if (!Object.hasOwn(installed.state.files, name)) {
      try { checkedNewFile(project, name); }
      catch (error) { conflicts.push(error.message); }
    }
  }
  if (conflicts.length) return result(project, 'CONFLICT', conflicts);
  if (order === 0) {
    if (old.version !== template.version || old.sourceSha256 !== template.sourceSha256 ||
        newNames.length !== previousNames.length ||
        previousNames.some(name => nextFiles[name] !== installed.state.files[name])) {
      return result(project, 'CONFLICT', ['Template source/assets changed without an increased SemVer version']);
    }
    return result(project, 'IN_SYNC', [], { template: { id: old.id, version: old.version } });
  }

  const next = { schemaVersion: 1,
    template: { id: template.id, version: template.version, profile: template.profile,
      origin: template.origin, sourceSha256: template.sourceSha256 },
    files: nextFiles };
  const changed = newNames.filter(name => installed.state.files[name] !== nextFiles[name]);
  const writes = [...changed, stateName];
  const rootIdentity = directoryIdentity(project);
  const fingerprint = hash(encode({ project, rootIdentity, manifestSha256, oldStateSha256: installed.sha256,
    nextStateSha256: hash(encode(next)), changes: changed.map(name => [name, nextFiles[name]]), catalogPath }));
  const plan = result(project, 'READY', [], {
    writes, template: { id: template.id, fromVersion: old.version, version: template.version },
    options, rootIdentity, manifestSha256, oldStateSha256: installed.sha256, fingerprint,
  });
  Object.defineProperty(plan, '_snapshot', { value: { changed, nextStateBytes: encode(next),
    newFiles: new Set(newNames.filter(name => !Object.hasOwn(installed.state.files, name))),
    assets: new Map(changed.map(name => [name, template.assets.get(name).bytes])),
  }, enumerable: false });
  return plan;
}

export function componentStatus(projectDir, options = {}) {
  return { ...planComponentUpdate(projectDir, options), mode: 'component-status' };
}

function stagedFile(stage, relative, bytes, mode = 0o600) {
  const filename = path.join(stage, 'new', relative);
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0), mode);
  try { fs.writeFileSync(fd, bytes); }
  finally { fs.closeSync(fd); }
  return filename;
}

function assertManifestUnchanged(project, expectedSha256) {
  if (hash(secureFile(path.join(project, 'ludory.project.json'), 'game manifest')) !== expectedSha256) {
    throw new Error('Game manifest changed during component update');
  }
}

// Operate on a basename relative to a directory inode verified on entry.
// Linux resolves /proc/self/fd/<directory-fd>/name through the held directory
// descriptor, even when an attacker replaces its visible project pathname.
// Windows prevents that directory replacement while it is our CWD, so retain
// the CWD fallback there rather than weakening its existing fail-closed path.
function withAnchoredParent(project, name, rootIdentity, operation) {
  const previous = process.cwd();
  let parentFd = null;
  try {
    process.chdir(project);
    if (directoryIdentity('.') !== rootIdentity) throw new Error('Project root changed during component transaction');
    const parts = name.split('/');
    const basename = parts.pop();
    for (const component of parts) {
      const stat = fs.lstatSync(component, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe component directory: ${name}`);
      process.chdir(component);
      if (directoryIdentity('.') !== `${stat.dev}:${stat.ino}`) throw new Error(`Changed component directory: ${name}`);
    }
    if (process.platform === 'linux') {
      parentFd = fs.openSync('.', fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | (fs.constants.O_NOFOLLOW || 0));
      if (directoryIdentity(`/proc/self/fd/${parentFd}`) !== directoryIdentity('.')) {
        throw new Error(`Changed component directory: ${name}`);
      }
    }
    const anchoredName = parentFd === null ? basename : `/proc/self/fd/${parentFd}/${basename}`;
    const output = operation(anchoredName);
    // The anchored old directory remains safe, but a new link replacing its
    // pathname makes the published game path unsafe and must block success.
    if (name === stateName) {
      if (directoryIdentity(project) !== rootIdentity) throw new Error('Project root moved during state publish');
    } else checkedParent(project, name);
    return output;
  } finally {
    if (parentFd !== null) fs.closeSync(parentFd);
    process.chdir(previous);
  }
}

/** Guarded synchronous multi-file update. The backup survives any failed rollback. */
export function applyComponentPlan(plan) {
  if (!plan || plan.mode !== 'component-update' || plan.status !== 'READY') {
    throw new Error('Only a READY component update plan may be applied');
  }
  const fresh = planComponentUpdate(plan.project, plan.options);
  if (fresh.status !== 'READY' || fresh.fingerprint !== plan.fingerprint ||
      fresh.rootIdentity !== plan.rootIdentity || !isOriginalDirectory(plan.project, plan.rootIdentity)) {
    throw new Error(`Stale component plan or conflict: ${fresh.conflicts.join('; ') || fresh.status}`);
  }

  const project = fresh.project;
  const lockPath = path.join(project, lockName);
  const lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  const lockStat = fs.fstatSync(lockFd, { bigint: true });
  fs.closeSync(lockFd);
  let stage = null;
  let stageIdentity = null;
  let rollbackComplete = true;
  let retainedBackup = null;
  let outcomeError = null;
  const operations = [];
  try {
    // Revalidate every game byte after the exclusive transaction lock is held.
    if (!isOriginalDirectory(project, plan.rootIdentity)) throw new Error('Project directory changed before locked apply');
    assertManifestUnchanged(project, plan.manifestSha256);
    const installed = readState(project);
    if (installed.sha256 !== plan.oldStateSha256) throw new Error('Component state changed after preview');
    const changes = fresh._snapshot.changed;
    for (const name of changes) {
      if (fresh._snapshot.newFiles.has(name)) checkedNewFile(project, name);
      else {
        const expected = installed.state.files[name];
        if (hash(checkedFile(project, name)) !== expected) throw new Error(`Managed file changed after preview: ${name}`);
      }
    }
    // All other managed files must also stay untouched, even if this revision
    // did not change their catalog bytes.
    for (const [name, expected] of Object.entries(installed.state.files)) {
      if (hash(checkedFile(project, name)) !== expected) throw new Error(`Managed file changed after preview: ${name}`);
    }
    // The archive must already have its final name. Windows may reject
    // renaming a directory that contains a moved original still referenced
    // by an editor handle, even though the file itself was safely moved.
    stage = fs.mkdtempSync(path.join(project, backupPrefix));
    stageIdentity = directoryIdentity(stage);
    retainedBackup = stage;
    fs.mkdirSync(path.join(stage, 'new'));
    fs.mkdirSync(path.join(stage, 'backup'));
    fs.mkdirSync(path.join(stage, 'quarantine'));
    const staged = [];
    for (const [i, name] of [...changes, stateName].entries()) {
      const isState = name === stateName;
      const bytes = isState ? fresh._snapshot.nextStateBytes : fresh._snapshot.assets.get(name);
      const newFile = fresh._snapshot.newFiles.has(name);
      const old = !newFile;
      const dest = isState ? path.join(project, stateName) : checkedParent(project, name);
      const stat = old ? fs.lstatSync(dest) : null;
      const filename = stagedFile(stage, String(i), bytes, stat ? Number(stat.mode & 0o777) : 0o600);
      staged.push({ name, isState, newFile, dest, bytes, staged: filename,
        backup: path.join(stage, 'backup', String(i)), oldExpected: isState ? installed.sha256 : installed.state.files[name] });
    }

    // Keep a human-readable map before publishing anything, so an interrupted
    // operation can be inspected without guessing which numeric slot is which.
    fs.writeFileSync(path.join(stage, 'backup-index.json'), `${JSON.stringify({
      schemaVersion: 1,
      entries: staged.map((item, index) => ({
        path: item.name,
        backup: item.newFile ? null : `backup/${index}`,
        previousSha256: item.newFile ? null : item.oldExpected,
      })),
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

    for (const [index, item] of staged.entries()) {
      if (!isOriginalDirectory(project, plan.rootIdentity) || directoryIdentity(stage) !== stageIdentity) {
        throw new Error('Component transaction directory changed during apply');
      }
      assertManifestUnchanged(project, plan.manifestSha256);
      withAnchoredParent(project, item.name, plan.rootIdentity, basename => {
        if (item.newFile) {
          try { fs.lstatSync(basename); throw new Error(`New component collision: ${item.name}`); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        } else if (hash(secureFile(basename, `managed component ${item.name}`)) !== item.oldExpected) {
          throw new Error(`Managed file changed during apply: ${item.name}`);
        }
        // Move original bytes to same-filesystem backup before publishing.
        // This path is anchored to the validated parent, not re-resolved
        // through an attacker-swapped project-relative directory.
        if (!item.newFile) fs.renameSync(basename, item.backup);
        const operation = { ...item, exposed: false,
          quarantine: path.join(stage, 'quarantine', String(index)) };
        operations.push(operation);
        if (!item.newFile && hash(fs.readFileSync(item.backup)) !== item.oldExpected) {
          throw new Error(`Managed file changed during replace: ${item.name}`);
        }
        fs.linkSync(item.staged, basename);
        const published = fs.lstatSync(basename, { bigint: true });
        operation.publishedIdentity = { dev: published.dev, ino: published.ino };
        operation.exposed = true;
      });
    }

    // Original inodes may still be open in another editor. Check for writes
    // after moving them; if a concurrent edit already arrived, roll back.
    // Even after this check we RETAIN backups, because an open descriptor can
    // continue receiving writes at any time. Never unlink an original inode.
    for (const item of operations) {
      if (!item.newFile && hash(fs.readFileSync(item.backup)) !== item.oldExpected) {
        throw new Error(`Concurrent original edit retained in backup: ${item.name}`);
      }
    }
    // Drop our link to each newly published inode only after proving the
    // game still holds that same inode. This lets subsequent updates require
    // nlink=1, while ORIGINAL inodes remain in durable backups.
    for (const item of operations) {
      withAnchoredParent(project, item.name, plan.rootIdentity, basename => {
        const published = fs.lstatSync(basename, { bigint: true });
        if (!published.isFile() || published.isSymbolicLink() ||
            published.dev !== item.publishedIdentity.dev || published.ino !== item.publishedIdentity.ino ||
            hash(fs.readFileSync(basename)) !== hash(item.bytes)) {
          throw new Error(`Published component changed before commit: ${item.name}`);
        }
        fs.unlinkSync(item.staged);
      });
    }
    return { ...fresh, status: 'APPLIED', applied: true, backupDirectory: retainedBackup };
  } catch (error) {
    const problems = [];
    for (const op of operations.reverse()) {
      try {
        withAnchoredParent(project, op.name, plan.rootIdentity, basename => {
          if (op.exposed) {
            const st = fs.lstatSync(basename, { bigint: true });
            if (!st.isFile() || st.isSymbolicLink() || st.dev !== op.publishedIdentity.dev || st.ino !== op.publishedIdentity.ino ||
                hash(fs.readFileSync(basename)) !== hash(op.bytes)) {
              throw new Error(`Modified replacement retained: ${op.name}`);
            }
            // Quarantine before checking again: a save that races our first
            // check is preserved, never silently unlinked. The quarantine
            // and original backup remain on disk for owner inspection.
            fs.renameSync(basename, op.quarantine);
            const moved = fs.lstatSync(op.quarantine, { bigint: true });
            if (!moved.isFile() || moved.isSymbolicLink() || moved.dev !== op.publishedIdentity.dev || moved.ino !== op.publishedIdentity.ino ||
                hash(fs.readFileSync(op.quarantine)) !== hash(op.bytes)) {
              try { fs.linkSync(op.quarantine, basename); }
              catch { /* Retained in quarantine even when a new entry collides. */ }
              throw new Error(`Modified replacement retained for recovery: ${op.name}`);
            }
          } else if (fs.existsSync(basename)) {
            throw new Error(`Concurrent replacement retained: ${op.name}`);
          }
          if (!op.newFile) {
            // Restore exclusively into a DIFFERENT inode. Keep the original
            // backup forever: a concurrent editor may keep writing through
            // its old handle even after a successful rollback.
            fs.copyFileSync(op.backup, basename, fs.constants.COPYFILE_EXCL);
          }
        });
      } catch (restoreError) { problems.push(`${op.name}: ${restoreError.message}`); }
    }
    rollbackComplete = problems.length === 0;
    if (problems.length) {
      outcomeError = new Error(`${error.message}; incomplete component rollback: ${problems.join('; ')}; recover from ${stage}`,
        { cause: error });
      throw outcomeError;
    }
    outcomeError = error;
    throw error;
  } finally {
    if (rollbackComplete) {
      try {
        // Never delete a moved original inode: an editor may still have its
        // handle open and write AFTER our final hash check. The archive was
        // created under its durable non-active name before publication, so no
        // directory rename can invalidate Windows open handles here.
        if (stage && directoryIdentity(stage) !== stageIdentity) {
          throw new Error('Component backup archive changed before completion');
        }
        const currentLock = fs.lstatSync(lockPath, { bigint: true });
        if (currentLock.dev === lockStat.dev && currentLock.ino === lockStat.ino) fs.unlinkSync(lockPath);
      } catch (finalizationError) {
        // A finalization failure must keep the lock for recovery. If the
        // operation already failed, preserve that causal error rather than
        // allowing cleanup to replace it.
        if (outcomeError) {
          outcomeError.message += `; finalization blocked (lock retained): ${finalizationError.message}`;
        } else throw finalizationError;
      }
    }
  }
}
