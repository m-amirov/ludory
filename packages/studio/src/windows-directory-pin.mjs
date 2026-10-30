import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nativePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../native/build/Release/directory_pin.node');
let native;

function nativePin() {
  if (native) return native;
  try { native = require(nativePath); }
  catch (cause) {
    throw new Error('Windows-native directory pin unavailable: build the Win32 N-API module before component apply', { cause });
  }
  if (typeof native.open !== 'function' || typeof native.close !== 'function') {
    throw new Error('Invalid Windows-native directory pin API');
  }
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
    return { dev: after.dev, ino: after.ino, close: () => addon.close(pin.token) };
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
