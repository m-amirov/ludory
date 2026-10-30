import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

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

function load(project) {
  const locations = recordPath(project);
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
