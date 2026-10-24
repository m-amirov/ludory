import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { defineGame } from '@ludory/core';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function directoryIdentity(dir) {
  const stat = fs.lstatSync(dir, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('SOURCE_PROJECT_DIRECTORY_INVALID');
  return `${stat.dev}:${stat.ino}`;
}

function nativeRoot(projectDir) {
  const resolved = path.resolve(projectDir);
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(resolved, canonical)) throw new Error('SOURCE_PROJECT_DIRECTORY_SYMBOLIC');
  directoryIdentity(resolved);
  return resolved;
}

function git(project, ...args) {
  const result = spawnSync('git', args, {
    cwd: project, encoding: 'utf8', timeout: 15_000, windowsHide: true, shell: false,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error('SOURCE_GIT_UNAVAILABLE');
  }
  return result.stdout.trim();
}

function regularFile(project, relative) {
  const parts = relative.split('/');
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes(':') ||
      relative.includes('\0') || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid artifact path');
  }
  let current = project;
  for (const [index, component] of parts.entries()) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('Invalid artifact: symbolic path');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('Invalid artifact: non-directory parent');
    if (index === parts.length - 1 && !stat.isFile()) throw new Error('Invalid artifact: not a regular file');
  }
  if (!samePath(fs.realpathSync.native(current), current)) throw new Error('Invalid artifact: symbolic path');
  return current;
}

export function inspectNativeProject(projectDir) {
  const project = nativeRoot(projectDir);
  let bytes;
  try { bytes = fs.readFileSync(regularFile(project, 'ludory.project.json')); }
  catch (error) { throw new Error(`SOURCE_MANIFEST_UNREADABLE: ${error.message}`); }
  let manifest;
  try { manifest = defineGame(JSON.parse(bytes.toString('utf8'))); }
  catch { throw new Error('SOURCE_MANIFEST_INVALID'); }
  const root = fs.realpathSync.native(git(project, 'rev-parse', '--show-toplevel'));
  if (!samePath(root, project)) throw new Error('SOURCE_WRONG_GIT_ROOT');
  const gitHead = git(project, 'rev-parse', '--verify', 'HEAD');
  if (!/^[a-f0-9]{40,64}$/.test(gitHead)) throw new Error('SOURCE_GIT_HEAD_INVALID');
  const status = git(project, 'status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).ludory/ai');
  if (status) throw new Error('SOURCE_WORKTREE_DIRTY');
  // Git status can silently trust skip-worktree/assume-unchanged index bits.
  // Require ordinary, tracked index entries for *all* source files, not only
  // the manifest; this is CRLF/filter-safe unlike raw bytes-versus-HEAD.
  const indexed = git(project, 'ls-files', '-v', '-z', '--').split('\0').filter(Boolean);
  const manifestFlag = indexed.find(entry => entry.slice(2) === 'ludory.project.json');
  if (!manifestFlag) throw new Error('SOURCE_MANIFEST_NOT_TRACKED');
  if (manifestFlag !== 'H ludory.project.json') throw new Error('SOURCE_MANIFEST_INDEX_UNSAFE');
  if (indexed.some(entry => !entry.startsWith('H '))) throw new Error('SOURCE_GIT_INDEX_UNSAFE');
  return { project, rootIdentity: directoryIdentity(project), manifest, manifestSha256: digest(bytes), gitHead, gitClean: true };
}

export function verifyNativeSource(binding) {
  try {
    const current = inspectNativeProject(binding.project);
    if (binding.rootIdentity !== current.rootIdentity) return { ok: false, code: 'SOURCE_ROOT_CHANGED' };
    if (binding.manifestSha256 !== current.manifestSha256) return { ok: false, code: 'SOURCE_MANIFEST_CHANGED' };
    if (binding.gitHead !== current.gitHead) return { ok: false, code: 'SOURCE_HEAD_CHANGED' };
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.message.split(':')[0] };
  }
}

/** Hash file bytes from the verified game root without following symbolic entries. */
export function snapshotArtifact(projectDir, relativePath) {
  const project = nativeRoot(projectDir);
  const file = regularFile(project, relativePath);
  const fd = fs.openSync(file, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let size = 0;
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) !== 0) {
      size += count;
      hash.update(buffer.subarray(0, count));
    }
    if (!fs.fstatSync(fd).isFile() || !samePath(fs.realpathSync.native(file), file)) {
      throw new Error('Invalid artifact: changed during inspection');
    }
  } finally { fs.closeSync(fd); }
  return { path: relativePath, sha256: hash.digest('hex'), size };
}
