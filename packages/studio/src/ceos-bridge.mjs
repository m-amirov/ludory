import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const CEOS_COMPAT_VERSION = '0.5.40';
const MAX_STDOUT = 1024 * 1024;

function blocked(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

function readSmall(file, limit, label) {
  let st;
  try { st = fs.statSync(file); }
  catch { blocked('BLOCKED_CEOS_ENTRY', `${label} is missing or unreadable`); }
  if (!st.isFile() || st.size > limit) blocked('BLOCKED_CEOS_ENTRY', `${label} is not a bounded regular file`);
  return fs.readFileSync(file);
}

function findGlobalEntry() {
  const exeDir = path.dirname(process.execPath);
  const npmScripts = [
    path.join(exeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(exeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const script of npmScripts) {
    if (!fs.existsSync(script)) continue;
    const found = spawnSync(process.execPath, [script, 'root', '-g'], {
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024,
    });
    if (found.status === 0 && found.stdout.trim()) {
      return path.resolve(found.stdout.trim(), 'codex-engineering-os', 'bin', 'ceos.mjs');
    }
  }
  // Safe, predictable fallback for NVM for Windows and standard Unix global prefixes.
  const candidates = [
    path.join(exeDir, 'node_modules', 'codex-engineering-os', 'bin', 'ceos.mjs'),
    path.resolve(exeDir, '..', 'lib', 'node_modules', 'codex-engineering-os', 'bin', 'ceos.mjs'),
  ];
  return candidates.find(fs.existsSync) ?? candidates[0];
}

/** Find a complete compatible CEOS install; a stale global junction is never accepted. */
export function resolveCeosEntry({ entry, env = process.env } = {}) {
  const selected = entry ?? env.LUDORY_CEOS_ENTRY ?? findGlobalEntry();
  if (typeof selected !== 'string' || !path.isAbsolute(selected)) {
    blocked('BLOCKED_CEOS_ENTRY', 'CEOS entry must be an absolute path to bin/ceos.mjs');
  }
  let entryPath;
  try { entryPath = fs.realpathSync.native(selected); }
  catch { blocked('BLOCKED_CEOS_UNAVAILABLE', 'CEOS entry is missing (or its junction target was removed)'); }
  if (path.basename(entryPath) !== 'ceos.mjs' || path.basename(path.dirname(entryPath)) !== 'bin') {
    blocked('BLOCKED_CEOS_ENTRY', 'Expected a CEOS bin/ceos.mjs entry');
  }
  const packageDir = path.resolve(entryPath, '..', '..');
  let meta;
  try { meta = JSON.parse(readSmall(path.join(packageDir, 'package.json'), 128 * 1024, 'CEOS package.json').toString('utf8')); }
  catch { blocked('BLOCKED_CEOS_ENTRY', 'Invalid CEOS package manifest'); }
  if (meta?.name !== 'codex-engineering-os') blocked('BLOCKED_CEOS_ENTRY', 'Unexpected CEOS package identity');
  const version = readSmall(path.join(packageDir, 'VERSION'), 80, 'CEOS VERSION').toString('utf8').trim();
  if (version !== meta.version || version !== CEOS_COMPAT_VERSION) {
    blocked('BLOCKED_CEOS_VERSION', `CEOS ${version || '(missing)'} is unsupported; expected ${CEOS_COMPAT_VERSION}`);
  }
  const bytes = readSmall(entryPath, 1024 * 1024, 'CEOS entry');
  return { entryPath, version, entrySha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

/** CEOS must be trusted local code. Never invoke a .cmd shim, shell or user-supplied command line. */
export function invokeCeos({ entryPath, project, args, timeoutMs = 60_000 } = {}) {
  if (!path.isAbsolute(entryPath) || !path.isAbsolute(project) || !Array.isArray(args) ||
      args.some(arg => typeof arg !== 'string') || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 180_000) {
    throw new Error('CEOS_EXECUTION_ERROR: invalid invocation arguments');
  }
  const child = spawnSync(process.execPath, [entryPath, ...args], {
    cwd: project, encoding: 'utf8', windowsHide: true, shell: false,
    timeout: timeoutMs, maxBuffer: MAX_STDOUT,
  });
  if (child.error?.code === 'ETIMEDOUT') throw new Error('CEOS_TIMEOUT: CEOS process exceeded the time limit');
  if (child.error?.code === 'ENOBUFS') throw new Error('CEOS_OVERFLOW: CEOS output exceeded the size limit');
  if (Buffer.byteLength(child.stdout ?? '', 'utf8') >= MAX_STDOUT ||
      Buffer.byteLength(child.stderr ?? '', 'utf8') >= MAX_STDOUT) {
    throw new Error('CEOS_OVERFLOW: CEOS output exceeded the size limit');
  }
  if (child.error || child.signal || ![0, 1, 2, 3].includes(child.status)) {
    throw new Error('CEOS_EXECUTION_ERROR: CEOS did not return a supported exit code');
  }
  let data;
  try { data = JSON.parse(child.stdout); }
  catch { throw new Error('CEOS_INVALID_JSON: CEOS did not return a complete JSON result'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('CEOS_INVALID_JSON: CEOS result must be an object');
  }
  return { ceosExitCode: child.status, data };
}
