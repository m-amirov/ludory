import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { canonicalPhysicalDirectory } from '@ludory/core';
import { openRecoveryStore } from './host-recovery-writer.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = /^[a-f0-9]{64}$/;
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function trustError(message, code = 'TRUST_CONFLICT') {
  return Object.assign(new Error(`Studio host trust: ${message}`), { code });
}

function inside(ancestor, child) {
  const relative = path.relative(ancestor, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function trustedRoot(project) {
  const configured = process.env.LUDORY_STUDIO_TRUST_DIR;
  if (configured !== undefined && (!configured || !path.isAbsolute(configured))) {
    throw trustError('LUDORY_STUDIO_TRUST_DIR must be a nonempty absolute path');
  }
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : (process.env.XDG_STATE_HOME && path.isAbsolute(process.env.XDG_STATE_HOME)
      ? process.env.XDG_STATE_HOME : path.join(os.homedir(), '.local', 'state'));
  const root = path.resolve(configured || path.join(base, 'ludory', 'studio', 'component-trust-v1'));
  if (inside(project, root) || inside(root, project)) {
    throw trustError('the host trust registry must be independent of the game directory');
  }
  return root;
}

function secureDirectory(directory, create = false) {
  const resolved = path.resolve(directory);
  const { root } = path.parse(resolved);
  let current = root;
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (create) {
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw trustError(`unsafe host trust directory: ${current}`);
  }
  const stat = fs.statSync(resolved);
  if (process.platform !== 'win32' &&
      (stat.mode & 0o022 || (process.getuid && stat.uid !== process.getuid()))) {
    throw trustError('host trust registry directory is not private to its owner');
  }
  return resolved;
}

function recordPath(project, { create = false } = {}) {
  const root = trustedRoot(project);
  try { secureDirectory(root, create); }
  catch (error) {
    if (error.code === 'ENOENT') throw trustError('trusted record directory does not exist', 'TRUST_MISSING');
    throw error;
  }
  if (inside(project, fs.realpathSync.native(root))) throw trustError('host trust registry resolves inside game directory');
  return { root, record: path.join(root, `${hash(Buffer.from(path.resolve(project)))}.json`) };
}

function readSecure(filename) {
  const st = fs.lstatSync(filename, { bigint: true });
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1n || st.size > 8192n) {
    throw trustError('unsafe host trust record');
  }
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.dev !== st.dev || opened.ino !== st.ino || !opened.isFile() || opened.nlink !== 1n) {
      throw trustError('host trust record changed while reading');
    }
    if (process.platform !== 'win32' &&
        (opened.mode & 0o022n || (process.getuid && opened.uid !== BigInt(process.getuid())))) {
      throw trustError('unsafe host trust record permissions or ownership');
    }
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function load(project, locations = recordPath(project)) {
  let bytes;
  try { bytes = readSecure(locations.record); }
  catch (error) {
    if (error.code === 'ENOENT') throw trustError('no registered Studio ownership for this game', 'TRUST_MISSING');
    throw error;
  }
  let pin;
  try { pin = JSON.parse(bytes.toString('utf8')); }
  catch { throw trustError('invalid host trust JSON'); }
  const keys = ['schemaVersion', 'project', 'rootIdentity', 'receiptSha256', 'manifestSha256', 'stateSha256'];
  if (!pin || typeof pin !== 'object' || Array.isArray(pin) ||
      Object.keys(pin).length !== keys.length || keys.some(key => !Object.hasOwn(pin, key)) ||
      pin.schemaVersion !== 1 || pin.project !== path.resolve(project) ||
      typeof pin.rootIdentity !== 'string' || !/^\d+:\d+$/.test(pin.rootIdentity) ||
      ![pin.receiptSha256, pin.manifestSha256, pin.stateSha256].every(value => typeof value === 'string' && digest.test(value)) ||
      !encode(pin).equals(bytes)) throw trustError('invalid or noncanonical host trust record');
  return { ...locations, pin };
}

function syncDir(directory) {
  if (process.platform === 'win32') return; // Windows directory handles cannot be fsynced through Node reliably.
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function withRecordLock(locations, operation) {
  const lock = `${locations.record}.lock`;
  let fd;
  try { fd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0), 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw trustError('host trust lock exists; inspect before retry');
    throw error;
  }
  try {
    fs.fsyncSync(fd);
    syncDir(locations.root);
    return operation();
  } finally {
    fs.closeSync(fd);
    const st = fs.lstatSync(lock);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw trustError('host trust lock was replaced');
    fs.unlinkSync(lock);
    syncDir(locations.root);
  }
}

export function assertComponentTrust(project, expected) {
  const { pin } = load(project);
  for (const field of ['rootIdentity', 'receiptSha256', 'manifestSha256', 'stateSha256']) {
    if (pin[field] !== expected[field]) throw trustError(`trusted ${field} differs from project state`);
  }
  return pin;
}

/** Register only a never-trusted project; it is not an implicit repair operation. */
export function registerComponentTrust(project, expected) {
  const locations = recordPath(project, { create: true });
  return withRecordLock(locations, () => {
    try { fs.lstatSync(locations.record); throw trustError('an existing host trust pin cannot be replaced'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const record = { schemaVersion: 1, project: path.resolve(project), ...expected };
    const fd = fs.openSync(locations.record, fs.constants.O_WRONLY | fs.constants.O_CREAT |
      fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { fs.writeFileSync(fd, encode(record)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    syncDir(locations.root);
    return record;
  });
}

/** Compare-and-swap to a new version; a project-side archive is never authority. */
export function advanceComponentTrust(project, expected, nextStateSha256) {
  if (!digest.test(nextStateSha256)) throw trustError('invalid next state digest');
  const locations = recordPath(project);
  return withRecordLock(locations, () => {
    const pin = assertComponentTrust(project, expected);
    const updated = { ...pin, stateSha256: nextStateSha256 };
    const temporary = path.join(locations.root, `.${crypto.randomBytes(16).toString('hex')}.tmp`);
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT |
      fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { fs.writeFileSync(fd, encode(updated)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try {
      fs.renameSync(temporary, locations.record);
      syncDir(locations.root);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* Preserve original error. */ }
      throw error;
    }
    return updated;
  });
}

export function hostTrustDigest(bytes) { return hash(bytes); }
export function isMissingHostTrust(error) { return error?.code === 'TRUST_MISSING'; }

// A recovered history anchor is a *separate owner-approved host record*, never
// a replacement for Studio's normal component trust pin or a native backup.
const recoveryKeys = ['schemaVersion', 'project', 'rootIdentity', 'receiptSha256',
  'manifestSha256', 'stateSha256', 'recoverySha256', 'fromCommit', 'toCommit'];

/** Bind owner consent to an existing registry inode or to an absent directory's
 * nearest existing physical ancestor. Preview does not create host directories. */
export function componentHostRegistryBinding(project) {
  const root = trustedRoot(project);
  let ancestor = root;
  while (true) {
    let stat;
    try { stat = fs.lstatSync(ancestor, { bigint: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw trustError('no existing host registry ancestor');
      ancestor = parent;
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw trustError('unsafe host registry ancestor');
    }
    if (ancestor === root) secureDirectory(root);
    // An inode can be reused immediately after rmdir/mkdir. Before apply,
    // bind the physical directory generation, not just its device/inode.
    // Its ctime will change when our own lock is later created, after which
    // the open descriptor is the publication authority.
    return { root, ancestor, ancestorIdentity: `${stat.dev}:${stat.ino}`,
      ancestorCtimeNs: String(stat.ctimeNs),
      rootExists: ancestor === root };
  }
}

function assertHostRegistryBinding(project, expected, { created = false } = {}) {
  if (!expected || typeof expected !== 'object' || typeof expected.root !== 'string' ||
      typeof expected.ancestor !== 'string' || typeof expected.ancestorIdentity !== 'string' ||
      typeof expected.ancestorCtimeNs !== 'string' || !/^\d+$/.test(expected.ancestorCtimeNs) ||
      typeof expected.rootExists !== 'boolean' || trustedRoot(project) !== expected.root) {
    throw trustError('host registry destination changed since preview');
  }
  const current = created ? null : componentHostRegistryBinding(project);
  if (current && !encode(current).equals(encode(expected))) {
    throw trustError('host registry identity changed since preview');
  }
  const ancestor = fs.lstatSync(expected.ancestor, { bigint: true });
  if (!ancestor.isDirectory() || ancestor.isSymbolicLink() ||
      `${ancestor.dev}:${ancestor.ino}` !== expected.ancestorIdentity) {
    throw trustError('host registry physical identity changed since preview');
  }
  if (created) secureDirectory(expected.root);
}

function recoveryPath(project, create = false) {
  const locations = recordPath(project, { create });
  const basename = hash(Buffer.from(path.resolve(project)));
  return { ...locations, checkpoint: path.join(locations.root, `${basename}.recovery.json`) };
}

function validRecoveryDetails(details) {
  return details && typeof details === 'object' && !Array.isArray(details) &&
    Object.keys(details).length === 7 &&
    ['rootIdentity', 'receiptSha256', 'manifestSha256', 'stateSha256',
      'recoverySha256', 'fromCommit', 'toCommit'].every(key => Object.hasOwn(details, key)) &&
    typeof details.rootIdentity === 'string' && /^\d+:\d+$/.test(details.rootIdentity) &&
    [details.receiptSha256, details.manifestSha256, details.stateSha256,
      details.recoverySha256].every(value => typeof value === 'string' && digest.test(value)) &&
    [details.fromCommit, details.toCommit].every(value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value));
}

export function readComponentRecoveryCheckpoint(project, options = {}) {
  let location;
  try { location = recoveryPath(project); }
  catch (error) {
    if (error.code === 'TRUST_MISSING') return null;
    throw error;
  }
  const basename = hash(Buffer.from(path.resolve(project)));
  const binding = componentHostRegistryBinding(project);
  const store = openRecoveryStore(location.root, { ...options, readOnly: true });
  let bytes;
  try {
    if (!binding.rootExists || store.rootIdentity !== binding.ancestorIdentity ||
        store.rootCtimeNs !== binding.ancestorCtimeNs) {
      throw trustError('host registry identity changed during checkpoint read');
    }
    const locked = () => {
      if (store.read(`${basename}.json.lock`) !== null) {
        throw trustError('unfinished host recovery publication lock exists; inspect before trust');
      }
    };
    locked();
    bytes = store.read(`${basename}.recovery.json`);
    locked();
    if (!encode(componentHostRegistryBinding(project)).equals(encode(binding))) {
      throw trustError('host registry identity changed during checkpoint read');
    }
    if (bytes === null) return null;
  } finally { store.close(); }
  let record;
  try { record = JSON.parse(bytes.toString('utf8')); }
  catch { throw trustError('invalid component recovery checkpoint JSON'); }
  const { schemaVersion, project: savedProject, ...details } = record ?? {};
  if (schemaVersion !== 1 || savedProject !== path.resolve(project) ||
      Object.keys(record ?? {}).length !== recoveryKeys.length ||
      recoveryKeys.some(key => !Object.hasOwn(record, key)) ||
      !validRecoveryDetails(details) || !encode(record).equals(bytes)) {
    throw trustError('invalid or noncanonical component recovery checkpoint');
  }
  return record;
}

export function assertComponentRecoveryCheckpoint(project, expected) {
  const record = readComponentRecoveryCheckpoint(project);
  if (!record) throw trustError('no owner-approved component recovery checkpoint', 'TRUST_MISSING');
  for (const [key, value] of Object.entries(expected)) {
    if (!recoveryKeys.includes(key) || record[key] !== value) {
      throw trustError(`component recovery checkpoint ${key} differs from expected state`);
    }
  }
  return record;
}

export function registerComponentRecoveryCheckpoint(project, details,
  expectedHostBinding = componentHostRegistryBinding(project), options = {}) {
  if (!validRecoveryDetails(details)) throw trustError('invalid component recovery checkpoint details');
  assertHostRegistryBinding(project, expectedHostBinding);
  const location = recoveryPath(project, true);
  // A registry absent during preview is created here. Pin its *new* inode as
  // well: the original ancestor anchor alone cannot detect substitution of
  // this directory between mkdir and the exclusive checkpoint lock.
  const createdRootBinding = componentHostRegistryBinding(project);
  if (!createdRootBinding.rootExists || createdRootBinding.root !== location.root) {
    throw trustError('created host registry destination differs from expected path');
  }
  if (expectedHostBinding.rootExists &&
      createdRootBinding.ancestorCtimeNs !== expectedHostBinding.ancestorCtimeNs) {
    throw trustError('host registry directory generation changed since owner preview');
  }
  const basename = hash(Buffer.from(path.resolve(project)));
  const store = openRecoveryStore(location.root, options);
  let lock;
  let checkpoint;
  let committed = false;
  let publicationFailure;
  try {
    if (store.rootIdentity !== createdRootBinding.ancestorIdentity ||
        store.rootCtimeNs !== createdRootBinding.ancestorCtimeNs) {
      throw trustError('pinned host registry identity changed before checkpoint publication');
    }
    lock = store.createLock(`${basename}.json.lock`);
    const checkRegistry = () => {
      const visible = componentHostRegistryBinding(project);
      // ctime is deliberately *not* rechecked after the first exclusive
      // write: the pinned fd prevents inode reuse during this transaction,
      // and adding/removing our own lock updates directory ctime.
      if (store.rootIdentity !== createdRootBinding.ancestorIdentity ||
          visible.root !== createdRootBinding.root ||
          visible.ancestor !== createdRootBinding.ancestor ||
          visible.ancestorIdentity !== createdRootBinding.ancestorIdentity ||
          !visible.rootExists) {
        throw trustError('host registry physical identity changed during checkpoint publication');
      }
    };
    assertHostRegistryBinding(project, expectedHostBinding, { created: true });
    checkRegistry();
    if (store.read(`${basename}.json`) !== null) {
      throw trustError('already trusted Studio project cannot be re-anchored by recovery');
    }
    if (store.read(`${basename}.recovery.json`) !== null) {
      throw trustError('existing component recovery checkpoint cannot be replaced');
    }
    const record = { schemaVersion: 1, project: path.resolve(project), ...details };
    checkpoint = store.createRecord(`${basename}.recovery.json`, encode(record));
    assertHostRegistryBinding(project, expectedHostBinding, { created: true });
    checkRegistry();
    // The checkpoint is not authority until this pinned lock is removed.
    try { store.removeCreated(lock); }
    catch (error) {
      // On POSIX unlink is the namespace commit point. A later fsync/close
      // error cannot turn an already visible, committed checkpoint into a
      // failed apply that a caller might unsafely retry.
      if (!lock.removed) throw error;
      process.emitWarning(`Host recovery lock removal completed but durability/close check failed: ${error.message}`);
    }
    lock = null;
    committed = true;
    return record;
  } catch (error) {
    publicationFailure = error;
    // Never remove an old checkpoint. Only this call's retained exclusive
    // creation handle may be rolled back through the *same* pinned directory.
    let rollbackSafe = !error.recoveryRollbackUnsafe;
    if (checkpoint) {
      try { store.removeCreated(checkpoint); }
      catch (rollbackError) { rollbackSafe = false; error.rollbackError = rollbackError; }
    }
    if (lock && rollbackSafe) {
      try { store.removeCreated(lock); }
      catch (rollbackError) { error.lockCleanupError = rollbackError; }
    }
    throw error;
  } finally {
    try { store.close(); }
    catch (error) {
      if (publicationFailure) publicationFailure.closeError = error;
      else if (committed) process.emitWarning(`Committed host recovery cleanup failed: ${error.message}`);
      else throw error;
    }
  }
}

// Separate, host-owned checkpoints bind source-repair consent and journal events.
// A game-local SHA chain alone is not an authorization boundary: a game editor
// can recompute its hashes, but must not be able to silently re-pin this registry.
function qaRepairCheckpointPath(project, output, index) {
  if (typeof project !== 'string' || typeof output !== 'string' ||
      !path.isAbsolute(project) || !path.isAbsolute(output) ||
      !Number.isInteger(index) || index < 0 || index > 4) throw trustError('invalid QA repair checkpoint');
  const locations = recordPath(project);
  const basename = hash(Buffer.from(`${path.resolve(project)}\0${path.resolve(output)}`));
  return { ...locations, checkpoint: path.join(locations.root, `qa-repair-${basename}-${index}.json`) };
}

export function pinQaRepairCheckpoint(project, output, index, receiptSha256) {
  if (typeof receiptSha256 !== 'string' || !digest.test(receiptSha256)) {
    throw trustError('invalid QA repair receipt digest');
  }
  const locations = qaRepairCheckpointPath(project, output, index);
  return withRecordLock(locations, () => {
    const receipt = { schemaVersion: 1, project: path.resolve(project),
      output: path.resolve(output), index, receiptSha256 };
    const fd = fs.openSync(locations.checkpoint, fs.constants.O_WRONLY | fs.constants.O_CREAT |
      fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    try { fs.writeFileSync(fd, encode(receipt)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    syncDir(locations.root);
    return receipt;
  });
}

export function assertQaRepairCheckpoint(project, output, index, receiptSha256) {
  const locations = qaRepairCheckpointPath(project, output, index);
  let record;
  try { record = JSON.parse(readSecure(locations.checkpoint).toString('utf8')); }
  catch { throw trustError('missing or invalid QA repair checkpoint'); }
  const expected = { schemaVersion: 1, project: path.resolve(project),
    output: path.resolve(output), index, receiptSha256 };
  if (!encode(expected).equals(encode(record)) || !digest.test(receiptSha256 ?? '')) {
    throw trustError('QA repair consent or event no longer matches host checkpoint');
  }
  return expected;
}

function checkedStudioFile(project, name) {
  const filename = path.join(project, name);
  let descriptor;
  try {
    const before = fs.lstatSync(filename, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 128n * 1024n) {
      throw trustError('unsafe Studio creation file', 'STUDIO_ORIGIN_UNSAFE_FILE');
    }
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.nlink !== 1n || opened.size !== before.size) {
      throw trustError('Studio file changed during verification', 'STUDIO_ORIGIN_UNSAFE_FILE');
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const linked = fs.lstatSync(filename, { bigint: true });
    if (bytes.length !== Number(before.size) || after.size !== before.size ||
        after.dev !== before.dev || after.ino !== before.ino ||
        linked.dev !== before.dev || linked.ino !== before.ino || linked.nlink !== 1n || linked.isSymbolicLink()) {
      throw trustError('Studio file changed during verification', 'STUDIO_ORIGIN_UNSAFE_FILE');
    }
    return bytes;
  } catch (error) {
    if (error.code === 'STUDIO_ORIGIN_UNSAFE_FILE') throw error;
    throw trustError('Studio creation file is missing or unsafe', 'STUDIO_ORIGIN_UNSAFE_FILE');
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

/** Read-only, host-bound proof that Studio created this exact physical project. */
export function verifyStudioOrigin(projectDir) {
  const requested = path.resolve(projectDir);
  let project;
  try {
    project = canonicalPhysicalDirectory(requested);
    const st = fs.lstatSync(project, { bigint: true });
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('unsafe root');
    const expected = {
      rootIdentity: `${st.dev}:${st.ino}`,
      receiptSha256: hash(checkedStudioFile(project, 'ludory.studio.json')),
      manifestSha256: hash(checkedStudioFile(project, 'ludory.project.json')),
      stateSha256: hash(checkedStudioFile(project, 'ludory.components.json')),
    };
    assertComponentTrust(project, expected);
    const after = fs.lstatSync(project, { bigint: true });
    if (!after.isDirectory() || after.isSymbolicLink() || `${after.dev}:${after.ino}` !== expected.rootIdentity) {
      throw trustError('project root changed during verification', 'STUDIO_ORIGIN_UNSAFE_ROOT');
    }
    return { ok: true, code: 'STUDIO_ORIGIN_TRUSTED', project };
  } catch (error) {
    const code = error.code === 'TRUST_MISSING' ? 'STUDIO_ORIGIN_TRUST_MISSING'
      : error.code === 'STUDIO_ORIGIN_UNSAFE_FILE' ? 'STUDIO_ORIGIN_UNSAFE_FILE'
        : error.code === 'STUDIO_ORIGIN_UNSAFE_ROOT' ? 'STUDIO_ORIGIN_UNSAFE_ROOT'
          : error.code === 'TRUST_CONFLICT' ? 'STUDIO_ORIGIN_TRUST_CONFLICT'
            : project ? 'STUDIO_ORIGIN_TRUST_CONFLICT' : 'STUDIO_ORIGIN_UNSAFE_ROOT';
    return { ok: false, code, project: project ?? requested };
  }
}
