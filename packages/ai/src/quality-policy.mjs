import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspectNativeProject } from './source.mjs';
import { hasStudioCreationReceipt } from './executor.mjs';

export const qualityDigest = data => crypto.createHash('sha256').update(data).digest('hex');
const QUALITY_DIR = '.ludory/quality';
const POLICY_FILE = `${QUALITY_DIR}/policy.json`;
const SKIP = new Set(['.git', '.ludory', '.worktrees', 'node_modules', 'coverage', 'target', 'dist', 'build', '.cache']);
const SOURCE_FILE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx|json|html|css|scss|yaml|yml)$/i;
const MAX_FILES = 5000;
const MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_QUALITY_POLICY = Object.freeze({
  schemaVersion: 1, mode: 'engineering-quality',
  tiers: { quick: { crapMaxExclusive: 10, duplicateThreshold: 0.8 }, deep: { maxWorkers: 2 } },
  tools: { crapper: null, dryer: null, mutator: null },
});

export function safeQualityDirectory(project, relative = QUALITY_DIR, create = false) {
  let current = project;
  for (const component of relative.split('/')) {
    if (!component || component === '.' || component === '..' || component.includes('\\')) throw new Error('QUALITY_PATH_INVALID');
    current = path.join(current, component);
    if (create && !fs.existsSync(current)) {
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('QUALITY_PATH_UNSAFE');
  }
  return current;
}

export function safeQualityFile(project, relative, { required = true } = {}) {
  const segments = relative.split('/');
  if (segments.length < 3 || segments.some(s => !s || s === '.' || s === '..' || s.includes('\\'))) {
    throw new Error('QUALITY_PATH_INVALID');
  }
  const parent = safeQualityDirectory(project, segments.slice(0, -1).join('/'));
  const filename = path.join(parent, segments.at(-1));
  let stat;
  try { stat = fs.lstatSync(filename); }
  catch (e) { if (e.code === 'ENOENT' && !required) return filename; throw e; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('QUALITY_FILE_UNSAFE');
  return filename;
}

function validPolicy(data) {
  if (!data || data.schemaVersion !== 1 || data.mode !== 'engineering-quality' ||
      !data.tiers || data.tiers.quick?.crapMaxExclusive !== 10 || data.tiers.quick?.duplicateThreshold !== 0.8 ||
      data.tiers.deep?.maxWorkers !== 2 || !data.tools) throw new Error('QUALITY_POLICY_INVALID');
  for (const name of ['crapper', 'dryer', 'mutator']) {
    const tool = data.tools[name];
    if (tool !== null && (typeof tool !== 'object' || Array.isArray(tool) ||
      typeof tool.path !== 'string' || !path.isAbsolute(tool.path) ||
      !/^[a-f0-9]{64}$/.test(tool.sha256) || typeof tool.version !== 'string' || !tool.version ||
      !Number.isSafeInteger(tool.timeoutMs) || tool.timeoutMs < 100 || tool.timeoutMs > 600_000)) {
      throw new Error('QUALITY_POLICY_INVALID_TOOL');
    }
  }
  return data;
}

export function readQualityPolicy(projectDir) {
  const source = inspectNativeProject(projectDir);
  const filename = safeQualityFile(source.project, POLICY_FILE);
  const data = fs.readFileSync(filename);
  if (data.byteLength > 32 * 1024) throw new Error('QUALITY_POLICY_TOO_LARGE');
  return validPolicy(JSON.parse(data.toString('utf8')));
}

export function snapshotQualitySource(projectDir) {
  const source = inspectNativeProject(projectDir);
  const files = [];
  let size = 0;
  function visit(root, prefix = '') {
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP.has(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(root, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('QUALITY_SOURCE_SYMBOLIC');
      if (stat.isDirectory()) { visit(full, relative); continue; }
      if (!stat.isFile()) throw new Error('QUALITY_SOURCE_UNSAFE');
      if (!SOURCE_FILE.test(entry.name)) continue;
      if (++size > MAX_FILES) throw new Error('QUALITY_SOURCE_TOO_MANY_FILES');
      const bytes = fs.readFileSync(full);
      if ((visit.totalBytes += bytes.length) > MAX_BYTES) throw new Error('QUALITY_SOURCE_TOO_LARGE');
      files.push({ path: relative, sha256: qualityDigest(bytes), size: bytes.length });
    }
  }
  visit.totalBytes = 0;
  visit(source.project);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { project: source.project, rootIdentity: source.rootIdentity,
    manifestSha256: source.manifestSha256, files,
    digest: qualityDigest(JSON.stringify(files)) };
}

function eligible(project) {
  const source = inspectNativeProject(project);
  if (!hasStudioCreationReceipt(source.project)) throw new Error('QUALITY_NEW_STUDIO_GAME_REQUIRED');
  const receiptFile = path.join(source.project, 'ludory.studio.json');
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (receipt.files['ludory.project.json'] !== source.manifestSha256) {
    throw new Error('QUALITY_CREATION_RECEIPT_MISMATCH');
  }
  return source;
}

export function planQualityEnable(projectDir) {
  const project = path.resolve(projectDir);
  try {
    const source = eligible(project);
    const policyPath = path.join(project, POLICY_FILE);
    if (fs.existsSync(policyPath)) {
      readQualityPolicy(project);
      return { mode: 'quality-enable', status: 'IN_SYNC', project, writes: [] };
    }
    if (fs.existsSync(path.join(project, '.ludory'))) safeQualityDirectory(project, '.ludory');
    const binding = snapshotQualitySource(project);
    return { mode: 'quality-enable', status: 'READY', project, binding,
      fingerprint: qualityDigest(JSON.stringify(binding)), writes: [POLICY_FILE] };
  } catch (error) {
    return { mode: 'quality-enable', status: 'BLOCKED', project, conflicts: [error.message], writes: [] };
  }
}

export function applyQualityEnable(plan) {
  if (plan?.status !== 'READY') throw new Error('QUALITY_PLAN_NOT_READY');
  const fresh = planQualityEnable(plan.project);
  if (fresh.status === 'IN_SYNC') return fresh;
  if (fresh.status !== 'READY' || fresh.fingerprint !== plan.fingerprint) {
    return { mode: 'quality-enable', project: plan.project, status: 'BLOCKED',
      conflicts: ['QUALITY_PLAN_STALE'], writes: [] };
  }
  try {
    safeQualityDirectory(plan.project, QUALITY_DIR, true);
    const filename = safeQualityFile(plan.project, POLICY_FILE, { required: false });
    fs.writeFileSync(filename, `${JSON.stringify(DEFAULT_QUALITY_POLICY, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { mode: 'quality-enable', project: plan.project, status: 'ENABLED', writes: [POLICY_FILE] };
  } catch (error) {
    return { mode: 'quality-enable', project: plan.project, status: 'BLOCKED', conflicts: [error.message], writes: [] };
  }
}
