import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nativePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../native/build/Release/directory_pin.node');
const requiredPinContractVersion = 4;
let native;

export function assertWindowsDirectoryPinContract(candidate) {
  if (candidate?.pinContractVersion !== requiredPinContractVersion ||
      typeof candidate.open !== 'function' || typeof candidate.close !== 'function' ||
      typeof candidate.createGuard !== 'function' || typeof candidate.removeGuard !== 'function') {
    throw new Error(`Stale or invalid Win32 native pin security contract: requires pinContractVersion=${requiredPinContractVersion}; rebuild from trusted Ludory source with npm run build:windows-pin`);
  }
}

function nativePin() {
  if (!native) {
    try { native = require(nativePath); }
    catch (cause) {
      throw new Error('Windows-native directory pin unavailable: build the Win32 N-API module before component apply', { cause });
    }
  }
  assertWindowsDirectoryPinContract(native);
  return native;
}

export function openProtectedDirectory(directory) {
  if (process.platform !== 'win32') throw new Error('Windows-native directory pin is Windows only');
  const before = fs.lstatSync(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error(`Unsafe Windows directory pin target: ${directory}`);
  }
  const addon = nativePin();
  const pin = addon.open(directory);
  try {
    const after = fs.lstatSync(directory, { bigint: true });
    if (!after.isDirectory() || after.isSymbolicLink() ||
        before.dev !== after.dev || before.ino !== after.ino ||
        pin.fileId !== after.ino) {
      throw new Error(`Changed Windows directory while pinning: ${directory}`);
    }
    return { dev: after.dev, ino: after.ino, close: () => addon.close(pin.token),
      createGuard: basename => {
        const guard = addon.createGuard(pin.token, basename);
        try {
          const parent = fs.lstatSync(directory, { bigint: true });
          const child = fs.lstatSync(path.join(directory, basename), { bigint: true });
          if (parent.isSymbolicLink() || !parent.isDirectory() ||
              parent.dev !== after.dev || parent.ino !== after.ino ||
              !child.isFile() || child.isSymbolicLink() || child.nlink !== 1n ||
              child.ino !== guard.fileId || child.dev !== after.dev) {
            throw new Error(`Changed Windows directory or guard after anchored creation: ${directory}`);
          }
          return { basename, fileId: guard.fileId, close: () => addon.close(guard.token),
            remove: () => addon.removeGuard(guard.token) };
        } catch (error) {
          // A guard may be the only file keeping a formerly empty physical
          // directory safe. Never delete it merely because its visible path
          // changed; leave it closed and fail the transaction before writes.
          addon.close(guard.token);
          throw error;
        }
      } };
  } catch (error) {
    addon.close(pin.token);
    throw error;
  }
}

/** Read-only prerequisite probe for Codex on Windows; never builds or fetches code. */
export function inspectWindowsDirectoryPin() {
  const shared = { mode: 'component-native-doctor',
    native: process.platform === 'win32', buildCommand: 'npm run build:windows-pin', writes: [] };
  if (process.platform !== 'win32') return { ...shared, status: 'NOT_REQUIRED', conflicts: [] };
  try {
    // Validate a real directory handle, not merely the presence of a .node
    // filename. This also detects stale/ABI-incompatible or corrupt addons.
    const held = openProtectedDirectory(path.dirname(fileURLToPath(import.meta.url)));
    held.close();
    return { ...shared, status: 'READY', conflicts: [] };
  } catch (error) {
    return { ...shared, status: 'BLOCKED', reasonCode: 'WINDOWS_NATIVE_PIN_UNAVAILABLE',
      conflicts: [`Win32 directory pin unavailable: ${error.message}`],
      nextAction: 'Run npm run build:windows-pin from the trusted Ludory repository with Node >=22.9 and MSVC; rerun this doctor before component apply.' };
  }
}
