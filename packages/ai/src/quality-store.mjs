import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspectNativeProject } from './source.mjs';
import { qualityDigest, readQualityPolicy, safeQualityDirectory, safeQualityFile, snapshotQualitySource } from './quality-policy.mjs';

const RUNS = '.ludory/quality/runs';
const RUN_ID = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[a-f0-9]{12}$/;
const ATTEMPT_ID = /^\d{13}-[a-f0-9]{12}$/;
const MAX_REPORT_BYTES = 256 * 1024;
const MAX_RUNS = 1000;
const STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED']);
const TIER_CHECKS = { quick: ['tests', 'crapper', 'dryer'], deep: ['tests', 'crapper', 'dryer', 'mutator'] };
const ARTIFACT_PATH = /^(?:coverage\/lcov\.info|\.metrics\/(?:crap\.edn|dry\.edn|mutate\/[A-Za-z0-9_.-]+\.edn))$/;

function checkedArtifact(project, entry) {
  if (!ARTIFACT_PATH.test(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 1024 * 1024) {
    throw new Error('QUALITY_ARTIFACT_INVALID');
  }
  let current = project;
  const parts = entry.path.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error('QUALITY_ARTIFACT_UNSAFE');
    }
  }
  const data = fs.readFileSync(current);
  if (data.length !== entry.size || qualityDigest(data) !== entry.sha256) {
    throw new Error('QUALITY_ARTIFACT_CHANGED');
  }
  return data;
}

function artifactContents(project, report) {
  const list = report.artifacts ?? [];
  if (!Array.isArray(list) || list.length > 20 ||
      new Set(list.map(item => item.path)).size !== list.length) throw new Error('QUALITY_ARTIFACT_INVALID');
  let total = 0;
  return list.map(entry => {
    const bytes = checkedArtifact(project, entry);
    if ((total += bytes.length) > 2 * 1024 * 1024) throw new Error('QUALITY_ARTIFACT_TOO_LARGE');
    const file = `${qualityDigest(entry.path).slice(0, 16)}${path.extname(entry.path)}`;
    return { ...entry, file, bytes };
  });
}

function checkedReads(project, { writerLock = false } = {}) {
  const root = safeQualityDirectory(project, RUNS, false);
  if (fs.existsSync(path.join(root, '.lock')) && !writerLock) throw new Error('QUALITY_EVIDENCE_LOCKED');
  const ids = fs.readdirSync(root).filter(id => writerLock ? id !== '.lock' : true).sort();
  if (ids.length > MAX_RUNS || ids.some(id => !RUN_ID.test(id))) throw new Error('QUALITY_EVIDENCE_INTEGRITY');
  let previousReceiptDigest = null;
  const entries = [];
  for (const id of ids) {
    safeQualityDirectory(project, `${RUNS}/${id}`);
    const bytes = fs.readFileSync(safeQualityFile(project, `${RUNS}/${id}/receipt.json`));
    const reportBytes = fs.readFileSync(safeQualityFile(project, `${RUNS}/${id}/report.json`));
    if (bytes.length > 64 * 1024 || reportBytes.length > MAX_REPORT_BYTES) throw new Error('QUALITY_EVIDENCE_INTEGRITY');
    const receipt = JSON.parse(bytes.toString('utf8'));
    const { receiptDigest, ...body } = receipt;
    if (receipt.schemaVersion !== 1 || receipt.qualityRunId !== id ||
        receipt.previousReceiptDigest !== previousReceiptDigest ||
        receipt.reportSha256 !== qualityDigest(reportBytes) ||
        receiptDigest !== qualityDigest(JSON.stringify(body)) ||
        !STATUSES.has(receipt.status)) throw new Error('QUALITY_EVIDENCE_INTEGRITY');
    JSON.parse(reportBytes.toString('utf8'));
    if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length > 20 ||
        new Set(receipt.artifacts.map(a => a.file)).size !== receipt.artifacts.length) {
      throw new Error('QUALITY_EVIDENCE_INTEGRITY');
    }
    for (const item of receipt.artifacts) {
      if (!ARTIFACT_PATH.test(item.path) ||
          item.file !== `${qualityDigest(item.path).slice(0, 16)}${path.extname(item.path)}` ||
          !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size)) {
        throw new Error('QUALITY_EVIDENCE_INTEGRITY');
      }
      const artifactBytes = fs.readFileSync(safeQualityFile(project, `${RUNS}/${id}/reports/${item.file}`));
      if (artifactBytes.length !== item.size || qualityDigest(artifactBytes) !== item.sha256) {
        throw new Error('QUALITY_EVIDENCE_INTEGRITY');
      }
    }
    entries.push(receipt);
    previousReceiptDigest = receiptDigest;
  }
  return entries;
}

function inspectEvidence(project) {
  const policy = readQualityPolicy(project);
  let entries;
  try { entries = checkedReads(project); }
  catch (error) {
    if (error.code === 'ENOENT' && !fs.existsSync(path.join(project, RUNS))) entries = [];
    else throw error;
  }
  return { entries, policyDigest: qualityDigest(JSON.stringify(policy)) };
}

export function persistQualityReceipt(projectDir, { tier, status, reasonCode = null,
  checks, report, sourceDigest: expectedSourceDigest, policyDigest: expectedPolicyDigest,
  attemptId = null } = {}) {
  const source = snapshotQualitySource(projectDir);
  if (expectedSourceDigest && expectedSourceDigest !== source.digest) throw new Error('QUALITY_SOURCE_CHANGED');
  if (!['quick', 'deep'].includes(tier) || !STATUSES.has(status) ||
      !Array.isArray(checks) || !checks.length || checks.length > 16 || !report || typeof report !== 'object' ||
      (attemptId !== null && !ATTEMPT_ID.test(attemptId))) {
    throw new Error('QUALITY_RECEIPT_INVALID');
  }
  if (status === 'PASS') {
    const expected = TIER_CHECKS[tier];
    if (!attemptId || !expectedSourceDigest || !expectedPolicyDigest || !report.requestSha256 ||
        report.schemaVersion !== 1 || report.tier !== tier || report.sourceDigest !== source.digest ||
        !Array.isArray(report.checks) || JSON.stringify(report.checks) !== JSON.stringify(checks) ||
        !Array.isArray(report.artifacts) || !Array.isArray(expected) ||
        checks.length !== expected.length || checks.some((c, index) =>
          c.name !== expected[index] || c.status !== 'PASS' || c.observed !== true || c.exitCode !== 0 ||
          !Array.isArray(c.command) || !c.command.length ||
          !/^[a-f0-9]{64}$/.test(c.outputSha256 ?? '') ||
          !Array.isArray(c.artifacts) || !c.artifacts.length ||
          (index > 0 && (!/^[a-f0-9]{64}$/.test(c.toolSha256 ?? '') || !c.version))) ||
        JSON.stringify(checks.flatMap(c => c.artifacts)) !== JSON.stringify(report.artifacts)) {
      throw new Error('QUALITY_PASS_UNATTESTED');
    }
  }
  const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
  if (reportBytes.length > MAX_REPORT_BYTES) throw new Error('QUALITY_REPORT_TOO_LARGE');
  const project = source.project;
  const artifacts = artifactContents(project, report);
  const root = safeQualityDirectory(project, RUNS, true);
  const lock = path.join(root, '.lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch { throw new Error('QUALITY_EVIDENCE_LOCKED'); }
  try {
    const { entries, policyDigest } = inspectEvidenceUnlocked(project);
    if (expectedPolicyDigest && expectedPolicyDigest !== policyDigest) throw new Error('QUALITY_POLICY_CHANGED');
    const qualityRunId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(6).toString('hex')}`;
    const relative = `${RUNS}/${qualityRunId}`;
    safeQualityDirectory(project, relative, true);
    const body = {
      schemaVersion: 1, qualityRunId, projectId: inspectNativeProject(project).manifest.id,
      createdAt: new Date().toISOString(), tier, status, reasonCode, attemptId,
      sourceDigest: source.digest, policyDigest, checks,
      artifacts: artifacts.map(({ bytes: _bytes, ...item }) => item),
      reportSha256: qualityDigest(reportBytes),
      previousReceiptDigest: entries.at(-1)?.receiptDigest ?? null,
    };
    const receipt = { ...body, receiptDigest: qualityDigest(JSON.stringify(body)) };
    if (artifacts.length) safeQualityDirectory(project, `${relative}/reports`, true);
    for (const item of artifacts) {
      fs.writeFileSync(safeQualityFile(project, `${relative}/reports/${item.file}`, { required: false }),
        item.bytes, { flag: 'wx', mode: 0o600 });
    }
    fs.writeFileSync(safeQualityFile(project, `${relative}/report.json`, { required: false }),
      reportBytes, { flag: 'wx', mode: 0o600 });
    if (snapshotQualitySource(project).digest !== source.digest) throw new Error('QUALITY_SOURCE_CHANGED');
    fs.writeFileSync(safeQualityFile(project, `${relative}/receipt.json`, { required: false }),
      `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
    return receipt;
  } finally {
    // Only the lock directory created by this invocation is removed; evidence stays append-only.
    fs.rmdirSync(lock);
  }
}

function orphanAttempts(project, entries) {
  const relative = '.ludory/quality/attempts';
  if (!fs.existsSync(path.join(project, relative))) return false;
  const dir = safeQualityDirectory(project, relative);
  const ids = fs.readdirSync(dir);
  if (ids.length > MAX_RUNS || ids.some(id => !ATTEMPT_ID.test(id))) throw new Error('QUALITY_EVIDENCE_INTEGRITY');
  const recorded = new Set(entries.map(receipt => receipt.attemptId).filter(Boolean));
  for (const id of ids) {
    safeQualityDirectory(project, `${relative}/${id}`);
    if (!recorded.has(id)) return true;
  }
  return false;
}

function inspectEvidenceUnlocked(project) {
  const policy = readQualityPolicy(project);
  // Keep the exclusive lock continuously held while scanning and appending.
  return { entries: checkedReads(project, { writerLock: true }),
    policyDigest: qualityDigest(JSON.stringify(policy)) };
}

export function qualityStatus(projectDir) {
  let project;
  try {
    project = inspectNativeProject(projectDir).project;
    const { entries, policyDigest } = inspectEvidence(project);
    if (orphanAttempts(project, entries)) return { mode: 'quality-status', status: 'BLOCKED',
      project, reasonCode: 'QUALITY_EXECUTION_INTERRUPTED' };
    if (!entries.length) return { mode: 'quality-status', status: 'NOT_RUN', project };
    const receipt = entries.at(-1);
    const source = snapshotQualitySource(project);
    const stale = receipt.sourceDigest !== source.digest || receipt.policyDigest !== policyDigest;
    return { mode: 'quality-status', status: stale ? 'STALE' : receipt.status,
      project, qualityRunId: receipt.qualityRunId, reasonCode: stale ? 'QUALITY_EVIDENCE_STALE' : receipt.reasonCode,
      sourceDigest: receipt.sourceDigest, receiptDigest: receipt.receiptDigest,
      checks: receipt.checks.map(check => ({ name: check.name, status: check.status,
        reasonCode: check.reasonCode })) };
  } catch (error) {
    return { mode: 'quality-status', project: project ?? path.resolve(projectDir),
      status: 'BLOCKED', reasonCode: error.message.startsWith('QUALITY_EVIDENCE_LOCKED') ? 'QUALITY_EVIDENCE_INTERRUPTED' :
        error.message.startsWith('QUALITY_POLICY_') ? error.message : 'QUALITY_EVIDENCE_INTEGRITY' };
  }
}

export function planQualityEvidence(projectDir, { run = 'latest' } = {}) {
  const current = qualityStatus(projectDir);
  if (current.status === 'NOT_RUN' || current.reasonCode === 'QUALITY_EXECUTION_INTERRUPTED' ||
      current.reasonCode === 'QUALITY_EVIDENCE_INTEGRITY' ||
      current.reasonCode === 'QUALITY_EVIDENCE_INTERRUPTED') return current;
  try {
    const { entries } = inspectEvidence(current.project);
    const receipt = run === 'latest' ? entries.at(-1) : entries.find(e => e.qualityRunId === run);
    if (!receipt) return { status: 'BLOCKED', reasonCode: 'QUALITY_RUN_NOT_FOUND', project: current.project };
    return { mode: 'quality-evidence', status: current.status === 'STALE' && receipt === entries.at(-1)
      ? 'STALE' : receipt.status, project: current.project, receipt };
  } catch {
    return { mode: 'quality-evidence', status: 'BLOCKED', reasonCode: 'QUALITY_EVIDENCE_INTEGRITY', project: current.project };
  }
}
