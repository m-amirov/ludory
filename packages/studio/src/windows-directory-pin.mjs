import fs from 'node:fs';

// libuv's Win32 UV_FS_O_EXLOCK flag (uv/win.h): CreateFileW is opened
// without FILE_SHARE_DELETE. Node does not publish this flag in fs.constants.
// The native CI gate exercises the resulting kernel rename denial; an error
// opening a directory is always a blocker, never an unprotected fallback.
const windowsNativeExclusiveFlag = 0x10000000;

export function openProtectedDirectory(directory) {
  if (process.platform !== 'win32') throw new Error('Windows-native directory pin is Windows only');
  const before = fs.lstatSync(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error(`Unsafe Windows directory pin target: ${directory}`);
  }
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | windowsNativeExclusiveFlag);
  try {
    const after = fs.fstatSync(fd, { bigint: true });
    if (!after.isDirectory() || before.dev !== after.dev || before.ino !== after.ino) {
      throw new Error(`Changed Windows directory while pinning: ${directory}`);
    }
    return fd;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
