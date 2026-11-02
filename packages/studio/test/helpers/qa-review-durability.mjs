import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Probe the actual filesystem/Node host, not merely the OS label. Windows
// usually lacks directory fsync; that must fail closed without a paid Web call.
export const qaDirectoryDurabilityAvailable = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-fsync-probe-'));
  try {
    for (const folder of [dir, path.dirname(dir)]) {
      const fd = fs.openSync(folder, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
      try { fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
    }
    return true;
  } catch { return false; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();
