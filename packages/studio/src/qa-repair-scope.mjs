import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyStudioOrigin } from '@ludory/studio-trust';
import { inspectQaJournal } from './qa-review-journal.mjs';
import { planQaWebReview } from './qa-review-contract.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const MAX_FILES = 5000;
const MAX_BYTES = 128 * 1024 * 1024;
const SKIP = new Set(['.git', '.worktrees', 'node_modules', 'coverage',
  'target', 'dist', 'build', '.cache']);
const GENERATED_LUDORY = new Set(['ai', 'quality', 'qa', 'qa-moderation', 'qa-repair', 'qa-repairs']);
const PROTECTED = new Set(['AGENTS.md', 'game-spec.yaml', 'ludory.project.json',
  'ludory.studio.json', 'ludory.components.json', 'package.json', 'package-lock.json',
  'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

function checkedFile(filename) {
  const stat = fs.lstatSync(filename, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(MAX_BYTES)) fail('QA_REPAIR_SOURCE_UNSAFE');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== stat.dev ||
        opened.ino !== stat.ino || opened.size !== stat.size || opened.mtimeNs !== stat.mtimeNs) {
      fail('QA_REPAIR_SOURCE_CHANGED');
    }
    const digest = createHash('sha256');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    let count;
    while ((count = fs.readSync(fd, chunk, 0, chunk.length, null))) {
      total += count;
      if (total > MAX_BYTES) fail('QA_REPAIR_SOURCE_TOO_LARGE');
      digest.update(chunk.subarray(0, count));
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (total !== Number(stat.size) || after.size !== stat.size ||
        after.mtimeNs !== stat.mtimeNs || after.ino !== stat.ino) fail('QA_REPAIR_SOURCE_CHANGED');
    return { sha256: digest.digest('hex'), size: total,
      identity: `${opened.dev}:${opened.ino}` };
  } finally { fs.closeSync(fd); }
}

/** Inventory all non-generated game files, including user notes and binary assets. */
export function snapshotQaRepairSource(projectDir) {
  const trust = verifyStudioOrigin(projectDir);
  if (!trust.ok) fail(trust.code);
  const project = trust.project;
  const root = fs.lstatSync(project, { bigint: true });
  const rootIdentity = `${root.dev}:${root.ino}`;
  const files = [];
  let bytes = 0;
  function visit(directory, prefix = '', expected = null) {
    const before = fs.lstatSync(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() ||
        (expected && identity(before) !== identity(expected))) fail('QA_REPAIR_SOURCE_DIRECTORY_CHANGED');
    const previous = process.cwd();
    try {
      // cwd anchors this directory inode while basename-only operations run.
      process.chdir(directory);
      if (identity(fs.lstatSync('.', { bigint: true })) !== identity(before)) {
        fail('QA_REPAIR_SOURCE_DIRECTORY_CHANGED');
      }
      for (const entry of fs.readdirSync('.', { withFileTypes: true }).sort((a, b) =>
        Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const stat = fs.lstatSync(entry.name, { bigint: true });
        if (stat.isSymbolicLink()) fail('QA_REPAIR_SOURCE_SYMBOLIC');
        if (stat.isDirectory()) {
          if ((prefix === '' && SKIP.has(entry.name)) ||
              (prefix === '.ludory' && GENERATED_LUDORY.has(entry.name))) continue;
          visit(entry.name, relative, stat);
          continue;
        }
        if (!stat.isFile() || files.length >= MAX_FILES) fail('QA_REPAIR_SOURCE_UNSAFE');
        const file = checkedFile(entry.name);
        bytes += file.size;
        if (bytes > MAX_BYTES) fail('QA_REPAIR_SOURCE_TOO_LARGE');
        files.push({ path: relative, ...file });
      }
    } finally { process.chdir(previous); }
    const after = fs.lstatSync(directory, { bigint: true });
    if (identity(after) !== identity(before) || !after.isDirectory() || after.isSymbolicLink()) {
      fail('QA_REPAIR_SOURCE_DIRECTORY_CHANGED');
    }
  }
  visit(project);
  const after = fs.lstatSync(project, { bigint: true });
  if (`${after.dev}:${after.ino}` !== rootIdentity || !verifyStudioOrigin(project).ok) {
    fail('QA_REPAIR_SOURCE_CHANGED');
  }
  return { project, rootIdentity, files, digest: hash(JSON.stringify(files)) };
}

function identity(stat) { return `${stat.dev}:${stat.ino}`; }

function scopePaths(inScope, files) {
  if (typeof inScope !== 'string' || inScope.length > 4096) fail('QA_REPAIR_SCOPE_REQUIRED');
  const paths = inScope.split(';').map(item => item.trim());
  if (paths.length < 1 || paths.length > 30 || new Set(paths).size !== paths.length) {
    fail('QA_REPAIR_SCOPE_INVALID');
  }
  const available = new Set(files.map(item => item.path));
  for (const candidate of paths) {
    const segments = candidate.split('/');
    if (!candidate || path.isAbsolute(candidate) || candidate.includes('\\') || candidate.includes(':') ||
        candidate.includes('\0') || segments.some(part => !part || part === '.' || part === '..' || part.startsWith('.')) ||
        segments.some(part => /^(?:licenses?|rights?|secrets?|vendor|node_modules|sdk)$/i.test(part)) ||
        segments.some(part => /(?:^|[-_.])(?:sdk|bridge|credentials?|secrets?|token)(?:[-_.]|$)/i.test(part)) ||
        PROTECTED.has(path.posix.basename(candidate)) || !available.has(candidate)) {
      fail('QA_REPAIR_SCOPE_PROTECTED');
    }
  }
  return paths;
}

/** Validate authorization after a journal is reopened, not only at CLI preview. */
export function validateQaRepairAuthorization(source, authorization) {
  if (!source || !Array.isArray(source.files) || !SHA.test(source.digest ?? '') ||
      source.digest !== hash(JSON.stringify(source.files)) ||
      !authorization || authorization.maxRepairs !== 2 ||
      !Array.isArray(authorization.inScope) ||
      typeof authorization.mutationBoundary !== 'string' ||
      !authorization.mutationBoundary.trim() || authorization.mutationBoundary.length > 1000) {
    fail('QA_REPAIR_CONSENT_INVALID');
  }
  const paths = scopePaths(authorization.inScope.join(';'), source.files);
  if (JSON.stringify(paths) !== JSON.stringify(authorization.inScope)) fail('QA_REPAIR_CONSENT_INVALID');
  return true;
}

const base = { schemaVersion: 1, kind: 'qa-repair-plan', actualModeration: 'NOT_RUN',
  releaseReady: false, publicationAllowed: false };

/** Read-only consent preview; local review journal is never a live Web credential. */
export function planQaRepair({ project, reviewOutput, inScope, mutationBoundary, outputDir } = {}) {
  try {
    if (typeof project !== 'string' || !project || typeof reviewOutput !== 'string' ||
        !path.isAbsolute(reviewOutput) || typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) {
      fail('QA_REPAIR_INPUT_REQUIRED');
    }
    const source = snapshotQaRepairSource(project);
    const scope = scopePaths(inScope, source.files);
    if (typeof mutationBoundary !== 'string' || !mutationBoundary.trim() ||
        mutationBoundary.length > 1000) fail('QA_REPAIR_BOUNDARY_REQUIRED');
    const output = path.resolve(outputDir);
    if (inside(source.project, output) || inside(path.resolve(reviewOutput), output) ||
        fs.existsSync(output)) fail('QA_REPAIR_OUTPUT_UNSAFE');
    const review = inspectQaJournal(reviewOutput);
    if (!['RECORDED_ISSUES_FOUND', 'RECORDED_REVIEWED'].includes(review.status) || !review.journalSha256 ||
        !['yandex-games', 'vk-games'].includes(review.target)) fail('QA_REPAIR_REVIEW_REQUIRED');
    const freshReview = review.sourceOptions && planQaWebReview(review.sourceOptions);
    if (freshReview?.status !== 'READY' || freshReview.candidateSha256 !== review.candidateSha256 ||
        freshReview.captureReportSha256 !== review.captureReportSha256 ||
        freshReview.metadataSha256 !== review.metadataSha256 ||
        JSON.stringify(freshReview.images) !== JSON.stringify(review.recordedInputImages)) {
      fail('QA_REPAIR_REVIEW_STALE');
    }
    const findings = review.images.flatMap(image => image.findings.map(finding =>
      ({ imageId: image.id, imageSha256: image.sha256, ...finding })));
    if (!findings.some(item => item.severity === 'P0' || item.severity === 'P1')) {
      fail('QA_REPAIR_NO_BLOCKING_FINDINGS');
    }
    return { ...base, status: 'READY_FOR_AGENT_HANDOFF', reasonCode: 'QA_REPAIR_CONSENT_PREVIEW',
      project: source.project, outputDir: output, source,
      review: { outputDir: path.resolve(reviewOutput), target: review.target,
        candidateSha256: review.candidateSha256, journalSha256: review.journalSha256,
        findings },
      authorization: { inScope: scope, mutationBoundary: mutationBoundary.trim(), maxRepairs: 2 },
      warning: 'P3c journal is a local record, not authenticated live Web evidence. The primary Codex agent must independently verify source/build provenance and host before any patch; this is not platform approval.' };
  } catch (error) {
    return { ...base, status: 'BLOCKED', reasonCode: error.code ??
      (typeof error.message === 'string' && error.message.startsWith('QA_') ? error.message : 'QA_REPAIR_SOURCE_UNVERIFIED'),
    };
  }
}
