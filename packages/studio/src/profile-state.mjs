import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROFILE_ROOT = '.ludory/profiles';
export const ACTIVE_PROFILE = `${PROFILE_ROOT}/active.json`;
const MAX_STATE = 1024 * 1024;
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export const encode = data => Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8');

function entryExists(filename) {
  try { fs.lstatSync(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function profileSnapshot(profile) {
  return encode({
    schemaVersion: 1,
    profile: {
      id: profile.id,
      version: profile.version,
      engine: profile.engine,
      targets: [...profile.targets].sort(),
    },
    catalog: { origin: profile.origin, sourceSha256: profile.sourceSha256 },
  });
}

function physical(directory, description) {
  const stat = fs.lstatSync(directory);
  const actual = fs.realpathSync.native(directory);
  const expected = path.resolve(directory);
  const matches = process.platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  if (!stat.isDirectory() || stat.isSymbolicLink() || !matches) {
    throw new Error(`Unsafe ${description}: symlink or non-directory`);
  }
  return stat;
}

export function checkedProfileRoot(project) {
  const parent = path.join(project, '.ludory');
  if (!entryExists(parent)) return { exists: false, parentExists: false };
  physical(parent, '.ludory directory');
  const root = path.join(parent, 'profiles');
  if (!entryExists(root)) return { exists: false, parentExists: true };
  physical(root, 'profile directory');
  return { exists: true, parentExists: true, root };
}

export function readRegular(file, label, maxSize = MAX_STATE) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxSize) {
    throw new Error(`Unsafe or oversized ${label}`);
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== stat.ino || opened.dev !== stat.dev) {
      throw new Error(`Unsafe or swapped ${label}`);
    }
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function strictKeys(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} fields`);
  }
}

const hashPattern = /^[0-9a-f]{64}$/;

function checkRevision(entry) {
  strictKeys(entry, ['id', 'version', 'sourceSha256', 'snapshotSha256'], 'revision');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) ||
      typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(entry.version) ||
      !hashPattern.test(entry.sourceSha256) || !hashPattern.test(entry.snapshotSha256)) {
    throw new Error('Invalid profile revision identity or hashes');
  }
}

function readSnapshot(root, revision) {
  const directory = path.join(root, 'snapshots');
  physical(directory, 'profile snapshots directory');
  const bytes = readRegular(path.join(directory, `${revision.snapshotSha256}.json`), 'profile snapshot');
  if (sha256(bytes) !== revision.snapshotSha256) throw new Error('Profile snapshot SHA-256 mismatch');
  let snapshot;
  try { snapshot = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Profile snapshot contains invalid JSON'); }
  strictKeys(snapshot, ['schemaVersion', 'profile', 'catalog'], 'profile snapshot');
  strictKeys(snapshot.profile, ['id', 'version', 'engine', 'targets'], 'snapshot profile');
  strictKeys(snapshot.catalog, ['origin', 'sourceSha256'], 'snapshot catalog');
  if (snapshot.schemaVersion !== 1 || snapshot.profile.id !== revision.id ||
      snapshot.profile.version !== revision.version || snapshot.catalog.sourceSha256 !== revision.sourceSha256 ||
      !['local', 'builtin'].includes(snapshot.catalog.origin) ||
      typeof snapshot.profile.engine !== 'string' || !Array.isArray(snapshot.profile.targets) ||
      snapshot.profile.targets.some(value => typeof value !== 'string')) {
    throw new Error('Profile snapshot does not match the recorded revision');
  }
}

function parseActive(bytes, generation) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Active profile state contains invalid JSON'); }
  strictKeys(value, ['schemaVersion', 'generation', 'profile', 'history'], 'active profile state');
  if (value.schemaVersion !== 1 || value.generation !== generation ||
      !Array.isArray(value.history) || value.history.length !== generation || value.history.length > 256) {
    throw new Error('Unsupported active profile state schema, generation or history');
  }
  checkRevision(value.profile);
  for (const previous of value.history) checkRevision(previous);
  if (!bytes.equals(encode(value))) throw new Error('Profile revision bytes differ from canonical state');
  return value;
}

/** Resolve the latest of immutable, exclusive revision commits; no active path is overwritten. */
export function readProfileState(project, { transient = [] } = {}) {
  const rootState = checkedProfileRoot(project);
  if (!rootState.exists) return { installed: false, rootState };
  const active = path.join(rootState.root, 'active.json');
  if (!entryExists(active)) throw new Error('Existing profile directory has no verifiable active state');
  const bytes = readRegular(active, 'active profile state');
  let value = parseActive(bytes, 0);
  let stateBytes = bytes;
  const committedStates = [bytes];
  const revisionDir = path.join(rootState.root, 'revisions');
  if (entryExists(revisionDir)) {
    physical(revisionDir, 'profile revisions directory');
    const entries = fs.readdirSync(revisionDir).sort();
    if (entries.length > 256) throw new Error('Too many profile revisions');
    for (let i = 0; i < entries.length; i++) {
      const expectedName = `${String(i + 1).padStart(8, '0')}.json`;
      if (entries[i] !== expectedName) throw new Error(`Unexpected profile revision: ${entries[i]}`);
      const following = readRegular(path.join(revisionDir, expectedName), 'profile revision');
      const next = parseActive(following, i + 1);
      if (JSON.stringify(next.history) !== JSON.stringify([value.profile, ...value.history])) {
        throw new Error('Profile revision chain does not match previous active state');
      }
      value = next;
      stateBytes = following;
      committedStates.push(following);
    }
  }
  for (const revision of [value.profile, ...value.history]) readSnapshot(rootState.root, revision);
  const historyDir = path.join(rootState.root, 'history');
  if (value.generation === 0) {
    // Genesis does not create these directories. Their premature appearance
    // cannot establish Ludory ownership, even when they are empty.
    if (entryExists(historyDir) || entryExists(revisionDir)) {
      throw new Error('Foreign profile history or revisions directory at generation zero');
    }
  } else {
    physical(historyDir, 'profile history directory');
    const expected = new Map(committedStates.slice(0, -1).map(previous => [`${sha256(previous)}.json`, previous]));
    const actual = fs.readdirSync(historyDir);
    if (actual.length !== expected.size || actual.some(name => !expected.has(name))) {
      throw new Error('Profile recovery history has unexpected, missing or foreign entries');
    }
    for (const [name, previous] of expected) {
      if (!readRegular(path.join(historyDir, name), 'profile history').equals(previous)) {
        throw new Error('Profile recovery history bytes changed');
      }
    }
  }
  const allowed = new Set(['active.json', 'snapshots', 'history', 'revisions', ...transient]);
  for (const name of fs.readdirSync(rootState.root)) {
    if (!allowed.has(name)) throw new Error(`Unknown profile management path: ${name}`);
  }
  return { installed: true, rootState, bytes: stateBytes, sha256: sha256(stateBytes), value };
}
