import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_RECORD_BYTES = 8192;
const recoveryName = /^[a-f0-9]{64}(?:\.recovery)?\.json(?:\.lock)?$/;

function conflict(message) {
  return Object.assign(new Error(`Studio host trust: ${message}`), { code: 'TRUST_CONFLICT' });
}

function validateName(name) {
  if (typeof name !== 'string' || !recoveryName.test(name)) {
    throw conflict('invalid host recovery record basename');
  }
  return name;
}

function fileIdentity(stat) { return `${stat.dev}:${stat.ino}`; }

function checkedFile(fd, expected, label) {
  const stat = fs.fstatSync(fd, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(MAX_RECORD_BYTES) ||
      (expected && fileIdentity(stat) !== expected) ||
      (stat.mode & 0o022n) || (process.getuid && stat.uid !== BigInt(process.getuid()))) {
    throw conflict(`unsafe or replaced host recovery ${label}`);
  }
  return stat;
}

function linuxStore(root) {
  if (!fs.existsSync('/proc/self/fd') || !fs.constants.O_DIRECTORY || !fs.constants.O_NOFOLLOW) {
    throw conflict('Linux procfs and descriptor-relative host recovery operations are required');
  }
  const rootFd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY |
    fs.constants.O_NOFOLLOW | (fs.constants.O_CLOEXEC || 0));
  const opened = fs.fstatSync(rootFd, { bigint: true });
  if (!opened.isDirectory() || (opened.mode & 0o022n) ||
      (process.getuid && opened.uid !== BigInt(process.getuid()))) {
    fs.closeSync(rootFd);
    throw conflict('unsafe pinned host registry directory');
  }
  const anchor = `/proc/self/fd/${rootFd}`;
  const handles = new Set();
  let closed = false;
  const ensureOpen = () => { if (closed) throw conflict('closed host recovery store'); };
  const located = name => { ensureOpen(); return path.join(anchor, validateName(name)); };
  const sync = () => { ensureOpen(); fs.fsyncSync(rootFd); };
  const create = (name, bytes) => {
    const filename = located(name);
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_RECORD_BYTES) {
      throw conflict('host recovery record exceeds permitted size');
    }
    let fd;
    try {
      fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT |
        fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') throw conflict('host recovery lock or record already exists');
      if (error.code === 'ENOENT') throw conflict('pinned host registry directory was detached');
      throw error;
    }
    const handle = { fd, name, identity: fileIdentity(fs.fstatSync(fd, { bigint: true })), removed: false };
    handles.add(handle);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      checkedFile(fd, handle.identity, name);
      sync();
      return handle;
    } catch (error) {
      try { removeCreated(handle); }
      catch (rollbackError) {
        error.rollbackError = rollbackError;
        error.recoveryRollbackUnsafe = true;
      }
      throw error;
    }
  };
  const removeCreated = handle => {
    ensureOpen();
    if (!handles.has(handle) || handle.removed) throw conflict('invalid recovery rollback handle');
    checkedFile(handle.fd, handle.identity, handle.name);
    const target = located(handle.name);
    const linked = fs.lstatSync(target, { bigint: true });
    if (!linked.isFile() || linked.isSymbolicLink() || linked.nlink !== 1n ||
        fileIdentity(linked) !== handle.identity) throw conflict('host recovery record changed before cleanup');
    fs.unlinkSync(target);
    handle.removed = true;
    // Do not silently resume after a directory fsync error: the physical
    // cleanup was attempted but its durable outcome is not known.
    sync();
    fs.closeSync(handle.fd);
    handles.delete(handle);
  };
  return {
    rootIdentity: fileIdentity(opened),
    rootCtimeNs: String(opened.ctimeNs),
    read(name) {
      const filename = located(name);
      let before;
      try { before = fs.lstatSync(filename, { bigint: true }); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
          before.size > BigInt(MAX_RECORD_BYTES)) throw conflict('unsafe host recovery record');
      const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const stat = checkedFile(fd, fileIdentity(before), name);
        if (stat.size !== before.size) throw conflict('host recovery record changed while reading');
        const bytes = fs.readFileSync(fd);
        if (bytes.length !== Number(stat.size) ||
            fs.fstatSync(fd, { bigint: true }).size !== stat.size) {
          throw conflict('host recovery record changed while reading');
        }
        return bytes;
      } finally { fs.closeSync(fd); }
    },
    createLock(name) { return create(name, Buffer.alloc(0)); },
    createRecord: create,
    removeCreated,
    sync,
    close() {
      if (closed) return;
      closed = true;
      for (const handle of handles) fs.closeSync(handle.fd);
      handles.clear();
      fs.closeSync(rootFd);
    },
  };
}

function windowsStore(root, pinFactory, { readOnly = false } = {}) {
  if (typeof pinFactory !== 'function') {
    throw conflict('Windows-native pinned host registry is required');
  }
  const pin = pinFactory(root);
  let guard;
  try {
    if (typeof pin.close !== 'function' || typeof pin.readRecoveryRecord !== 'function' ||
        typeof pin.createRecoveryLock !== 'function' || typeof pin.createRecoveryRecord !== 'function' ||
        typeof pin.createGuard !== 'function') {
      throw conflict('Windows-native recovery pin has a stale security contract');
    }
    // A writer holds an independent undeletable child to prevent an empty
    // directory being transformed into a junction while the root is pinned.
    // Read-only previews create no files; OBJ_DONT_REPARSE covers their opens.
    if (!readOnly) {
      guard = pin.createGuard(`.ludory-components-guard-${crypto.randomBytes(16).toString('hex')}`);
    }
  } catch (error) {
    pin.close?.();
    throw error;
  }
  const handles = new Set();
  let closed = false;
  const ensureOpen = () => { if (closed) throw conflict('closed host recovery store'); };
  const add = (name, native) => {
    const handle = { name, native, removed: false };
    handles.add(handle);
    return handle;
  };
  const create = (name, bytes, isLock) => {
    ensureOpen();
    validateName(name);
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_RECORD_BYTES) {
      throw conflict('host recovery record exceeds permitted size');
    }
    try {
      return add(name, isLock ? pin.createRecoveryLock(name) : pin.createRecoveryRecord(name, bytes));
    } catch (error) {
      // The native API must attempt internal rollback on write/flush failure;
      // without its file token JS cannot verify cleanup. Retain host lock.
      if (!isLock) error.recoveryRollbackUnsafe = true;
      throw error;
    }
  };
  return {
    rootIdentity: `${pin.dev}:${pin.ino}`,
    rootCtimeNs: pin.ctimeNs,
    read(name) {
      ensureOpen();
      return pin.readRecoveryRecord(validateName(name));
    },
    createLock(name) { return create(name, Buffer.alloc(0), true); },
    createRecord(name, bytes) { return create(name, bytes, false); },
    removeCreated(handle) {
      ensureOpen();
      if (!handles.has(handle) || handle.removed) throw conflict('invalid native recovery rollback handle');
      try { handle.native.remove(); }
      catch (error) {
        // The native delete disposition is the Windows publication point.
        // A later CloseHandle error cannot roll back a committed record.
        if (error.recoveryDeleteMarked) {
          handle.removed = true;
          handles.delete(handle);
        }
        throw error;
      }
      handle.removed = true;
      handles.delete(handle);
    },
    sync() { ensureOpen(); /* Native FlushFileBuffers on each created file. */ },
    close() {
      if (closed) return;
      closed = true;
      try {
        for (const handle of handles) handle.native.close();
        handles.clear();
        if (guard) guard.remove();
      } finally { pin.close(); }
    },
  };
}

/** A recovery-only, pinned registry store. Never fall back to path-based writes. */
export function openRecoveryStore(root, { windowsPin, readOnly = false } = {}) {
  if (process.platform === 'linux') return linuxStore(root);
  if (process.platform === 'win32') return windowsStore(root, windowsPin, { readOnly });
  throw conflict('host recovery requires a supported, handle-anchored registry writer');
}
