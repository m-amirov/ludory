import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The test process and any spawned Studio CLI share an ephemeral host-owned
// trust directory. Tests must not create security state under the developer's
// real ~/.local/state or %LOCALAPPDATA%.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-test-host-trust-'));
const previous = process.env.LUDORY_STUDIO_TRUST_DIR;
process.env.LUDORY_STUDIO_TRUST_DIR = root;
process.on('exit', () => {
  if (previous === undefined) delete process.env.LUDORY_STUDIO_TRUST_DIR;
  else process.env.LUDORY_STUDIO_TRUST_DIR = previous;
  fs.rmSync(root, { recursive: true, force: true });
});
