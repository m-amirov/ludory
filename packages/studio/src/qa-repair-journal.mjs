import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pinQaRepairCheckpoint, assertQaRepairCheckpoint } from '@ludory/studio-trust';
import { planQaRepair, snapshotQaRepairSource,
  validateQaRepairAuthorization } from './qa-repair-scope.mjs';
import { inspectQaJournal } from './qa-review-journal.mjs';
import { planQaWebReview } from './qa-review-contract.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const base = { schemaVersion: 1, kind: 'qa-repair-session', recordedOnly: true,
  browserAttested: false, reviewProvenance: 'LOCAL_RECORD_ONLY', actualModeration: 'NOT_RUN',
  releaseReady: false, publicationAllowed: false };
const blocked = code => ({ ...base, status: 'BLOCKED', reasonCode: code });
const identity = stat => `${stat.dev}:${stat.ino}`;

function safePath(filename, { allowMissingLeaf = false } = {}) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) fail('QA_REPAIR_OUTPUT_REQUIRED');
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  const segments = absolute.slice(current.length).split(path.sep).filter(Boolean);
  for (const [index, part] of segments.entries()) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current, { bigint: true }); }
    catch (error) {
      if (error.code === 'ENOENT' && allowMissingLeaf && index === segments.length - 1) return absolute;
      fail('QA_REPAIR_OUTPUT_UNAVAILABLE');
    }
    if (stat.isSymbolicLink()) fail('QA_REPAIR_OUTPUT_SYMBOLIC');
    if (index < segments.length - 1 && !stat.isDirectory()) fail('QA_REPAIR_OUTPUT_UNSAFE');
  }
  return absolute;
}

// Synchronous cwd-relative operations pin the real directory while open/write/fsync run.
// Never await or call external code inside a pinned scope.
function withDirectory(directory, action, { expectedIdentity, sync = false } = {}) {
  safePath(directory);
  const first = fs.lstatSync(directory, { bigint: true });
  if (!first.isDirectory() || (expectedIdentity && identity(first) !== expectedIdentity)) {
    fail('QA_REPAIR_DIRECTORY_CHANGED');
  }
  const previous = process.cwd();
  try {
    process.chdir(directory);
    if (identity(fs.lstatSync('.', { bigint: true })) !== identity(first)) fail('QA_REPAIR_DIRECTORY_CHANGED');
    const result = action();
    if (sync) {
      const fd = fs.openSync('.', fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
      try { fs.fsyncSync(fd); } catch { fail('QA_REPAIR_DIRECTORY_DURABILITY_UNVERIFIED'); }
      finally { fs.closeSync(fd); }
    }
    if (identity(fs.lstatSync(directory, { bigint: true })) !== identity(first)) {
      fail('QA_REPAIR_DIRECTORY_CHANGED');
    }
    return result;
  } finally { process.chdir(previous); }
}

function writeExclusive(filename, value) {
  if (path.basename(filename) !== filename) fail('QA_REPAIR_FILE_UNSAFE');
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > MAX_BYTES) fail('QA_REPAIR_EVENT_TOO_LARGE');
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function readFile(filename) {
  if (path.basename(filename) !== filename) fail('QA_REPAIR_FILE_UNSAFE');
  const stat = fs.lstatSync(filename, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.size < 2n || stat.size > BigInt(MAX_BYTES)) {
    fail('QA_REPAIR_FILE_UNSAFE');
  }
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || identity(opened) !== identity(stat) || opened.size !== stat.size) {
      fail('QA_REPAIR_FILE_CHANGED');
    }
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (after.size !== stat.size || after.mtimeNs !== stat.mtimeNs) fail('QA_REPAIR_FILE_CHANGED');
    return JSON.parse(bytes.toString('utf8'));
  } finally { fs.closeSync(fd); }
}

function changedPaths(before, after) {
  const original = new Map(before.map(file => [file.path,
    `${file.sha256}:${file.size}:${file.identity}`]));
  const fresh = new Map(after.map(file => [file.path,
    `${file.sha256}:${file.size}:${file.identity}`]));
  return [...new Set([...original.keys(), ...fresh.keys()])].filter(name =>
    original.get(name) !== fresh.get(name)).sort();
}

function eventName(index) { return `${String(index).padStart(6, '0')}.json`; }

function fromDirectory() {
  const session = readFile('session.json');
  if (!session || session.schemaVersion !== 1 || session.kind !== 'qa-repair-consent' ||
      !SHA.test(session.sha256 ?? '') || !session.source || !Array.isArray(session.source.files) ||
      !SHA.test(session.source.digest ?? '') || !Array.isArray(session.authorization?.inScope) ||
      session.authorization.maxRepairs !== 2 || !SHA.test(session.review?.journalSha256 ?? '')) {
    fail('QA_REPAIR_SESSION_INVALID');
  }
  const { sha256: declared, ...body } = session;
  if (hash(JSON.stringify(body)) !== declared) fail('QA_REPAIR_SESSION_CHANGED');
  validateQaRepairAuthorization(session.source, session.authorization);
  assertQaRepairCheckpoint(session.project, session.outputDir, 0, declared);
  const entries = fs.readdirSync('.').sort();
  const events = entries.filter(name => name !== 'session.json');
  if (events.length > 4 || events.some((name, index) => name !== eventName(index + 1))) {
    fail('QA_REPAIR_EVENT_SEQUENCE');
  }
  let currentSource = session.source;
  let currentReview = session.review;
  let state = 'READY_FOR_ROUND';
  let roundsUsed = 0;
  let pending = null;
  let previous = declared;
  let last = null;
  for (const [index, name] of events.entries()) {
    const event = readFile(name);
    const { sha256: receiptSha, ...eventBody } = event ?? {};
    if (eventBody.schemaVersion !== 1 || eventBody.index !== index + 1 ||
        eventBody.previousSha256 !== previous || !SHA.test(receiptSha ?? '') ||
        hash(JSON.stringify(eventBody)) !== receiptSha) fail('QA_REPAIR_EVENT_INVALID');
    assertQaRepairCheckpoint(session.project, session.outputDir, index + 1, receiptSha);
    const p = eventBody.payload;
    if (state === 'READY_FOR_ROUND' && p?.type === 'ROUND_STARTED' &&
        p.round === roundsUsed + 1 && p.sourceDigest === currentSource.digest &&
        p.candidateSha256 === currentReview.candidateSha256 &&
        Object.keys(p).length === 4) {
      state = 'PENDING_RECOVERY';
      pending = p;
    } else if (state === 'PENDING_RECOVERY' && pending && p?.type === 'ROUND_RESULT' &&
        p.round === pending.round && p.source?.project === currentSource.project &&
        p.source?.rootIdentity === currentSource.rootIdentity && SHA.test(p.source?.digest ?? '') &&
        Array.isArray(p.source.files) && Array.isArray(p.changedPaths) &&
        JSON.stringify(changedPaths(currentSource.files, p.source.files)) === JSON.stringify(p.changedPaths) &&
        p.review?.target === currentReview.target && SHA.test(p.review?.candidateSha256 ?? '') &&
        ['REWORK', 'RECHECK_RECORDED', 'ESCALATE'].includes(p.status) &&
        typeof p.reasonCode === 'string') {
      const invalidScope = p.changedPaths.some(name => !session.authorization.inScope.includes(name));
      if (invalidScope !== (p.reasonCode === 'QA_REPAIR_SCOPE_VIOLATION') ||
          (invalidScope && p.status !== 'ESCALATE')) fail('QA_REPAIR_EVENT_POLICY_INVALID');
      currentSource = p.source;
      currentReview = p.review;
      roundsUsed++;
      last = p;
      state = p.status === 'REWORK' && roundsUsed < 2 ? 'READY_FOR_ROUND' : p.status;
      pending = null;
    } else fail('QA_REPAIR_EVENT_ORDER');
    previous = receiptSha;
  }
  return { session, events, state, roundsUsed, currentSource, currentReview, last, pending,
    lastReceiptSha256: previous };
}

function view(current) {
  return { ...base, status: current.state, reasonCode: current.last?.reasonCode ??
    (current.state === 'PENDING_RECOVERY' ? 'QA_REPAIR_CONFIRM_AGENT_STATE' : 'QA_REPAIR_SESSION_RECORDED'),
  outputDir: current.session.outputDir, project: current.session.project,
  target: current.session.review.target, candidateSha256: current.currentReview.candidateSha256,
  sourceDigest: current.currentSource.digest, maxRepairs: 2, roundsUsed: current.roundsUsed + (current.pending ? 1 : 0),
  remainingRepairs: 2 - current.roundsUsed - (current.pending ? 1 : 0),
  authorizedPaths: current.session.authorization.inScope, mutationBoundary: current.session.authorization.mutationBoundary,
  changedPaths: current.last?.changedPaths ?? [],
  warning: 'Recorded-only QA history; primary Codex agent must verify live Web host and rebuild evidence. No platform approval.' };
}

function appendEvent(output, payload, expectedHead) {
  let checkpoint;
  withDirectory(output, () => {
    const current = fromDirectory();
    if (current.events.length >= 4) fail('QA_REPAIR_LIMIT');
    if (current.lastReceiptSha256 !== expectedHead) fail('QA_REPAIR_CONCURRENT_TRANSITION');
    if (payload.type === 'ROUND_STARTED') {
      if (current.state !== 'READY_FOR_ROUND' || payload.round !== current.roundsUsed + 1 ||
          payload.sourceDigest !== current.currentSource.digest ||
          payload.candidateSha256 !== current.currentReview.candidateSha256) {
        fail('QA_REPAIR_CONCURRENT_TRANSITION');
      }
    } else if (payload.type === 'ROUND_RESULT') {
      if (current.state !== 'PENDING_RECOVERY' || payload.round !== current.pending.round ||
          JSON.stringify(changedPaths(current.currentSource.files, payload.source.files)) !==
            JSON.stringify(payload.changedPaths)) fail('QA_REPAIR_CONCURRENT_TRANSITION');
    } else fail('QA_REPAIR_EVENT_TYPE');
    const observedSource = snapshotQaRepairSource(current.session.project);
    const expectedSource = payload.type === 'ROUND_STARTED' ? current.currentSource : payload.source;
    if (observedSource.digest !== expectedSource.digest ||
        observedSource.rootIdentity !== expectedSource.rootIdentity) fail('QA_REPAIR_SOURCE_STALE');
    const body = { schemaVersion: 1, index: current.events.length + 1,
      previousSha256: current.lastReceiptSha256, payload };
    checkpoint = { index: body.index, sha256: hash(JSON.stringify(body)), project: current.session.project };
    writeExclusive(eventName(body.index), { ...body, sha256: checkpoint.sha256 });
  }, { sync: true });
  // The independent host-owned pin is published only AFTER local bytes + directory flush.
  // A crash in between blocks the journal on read rather than granting an unpinned action.
  pinQaRepairCheckpoint(checkpoint.project, output, checkpoint.index, checkpoint.sha256);
  return withDirectory(output, fromDirectory);
}

/** Durable consent. It never executes or schedules a source change. */
export function beginQaRepair(plan, { apply = false } = {}) {
  if (!apply || plan?.status !== 'READY_FOR_AGENT_HANDOFF') return plan;
  try {
    const fresh = planQaRepair({ project: plan.project, reviewOutput: plan.review.outputDir,
      inScope: plan.authorization.inScope.join(';'),
      mutationBoundary: plan.authorization.mutationBoundary, outputDir: plan.outputDir });
    if (fresh.status !== 'READY_FOR_AGENT_HANDOFF' || fresh.source.digest !== plan.source.digest ||
        fresh.source.rootIdentity !== plan.source.rootIdentity ||
        fresh.review.journalSha256 !== plan.review.journalSha256) fail('QA_REPAIR_CONSENT_STALE');
    safePath(plan.outputDir, { allowMissingLeaf: true });
    const parent = path.dirname(plan.outputDir);
    const parentIdentity = identity(fs.lstatSync(parent, { bigint: true }));
    const body = { schemaVersion: 1, kind: 'qa-repair-consent', sessionId: randomUUID(),
      project: plan.project, outputDir: plan.outputDir, source: plan.source, review: plan.review,
      authorization: plan.authorization };
    const session = { ...body, sha256: hash(JSON.stringify(body)) };
    let created;
    withDirectory(parent, () => {
      fs.mkdirSync(path.basename(plan.outputDir), { mode: 0o700 });
      created = identity(fs.lstatSync(path.basename(plan.outputDir), { bigint: true }));
    }, { expectedIdentity: parentIdentity, sync: true });
    withDirectory(plan.outputDir, () => writeExclusive('session.json', session),
      { expectedIdentity: created, sync: true });
    pinQaRepairCheckpoint(plan.project, plan.outputDir, 0, session.sha256);
    return inspectQaRepair(plan.outputDir);
  } catch (error) {
    return blocked(error.code ?? 'QA_REPAIR_CONSENT_FAILED');
  }
}

/** Historical local status; cannot attest that any Web browser was really used. */
export function inspectQaRepair(outputDir) {
  try { return withDirectory(outputDir, () => view(fromDirectory())); }
  catch (error) { return blocked(error.code ?? 'QA_REPAIR_JOURNAL_UNREADABLE'); }
}

export function startQaRepairRound(outputDir, { apply = false } = {}) {
  const status = inspectQaRepair(outputDir);
  if (status.status !== 'READY_FOR_ROUND' || !apply) return status;
  try {
    const current = withDirectory(outputDir, fromDirectory);
    const fresh = snapshotQaRepairSource(current.session.project);
    if (fresh.digest !== current.currentSource.digest ||
        fresh.rootIdentity !== current.currentSource.rootIdentity) fail('QA_REPAIR_SOURCE_STALE');
    // Persist intent BEFORE the primary agent can write an in-scope game file.
    const next = appendEvent(outputDir, { type: 'ROUND_STARTED', round: current.roundsUsed + 1,
      sourceDigest: current.currentSource.digest, candidateSha256: current.currentReview.candidateSha256 },
    current.lastReceiptSha256);
    return { ...view(next), status: 'NEEDS_AGENT_ACTION', round: next.pending.round,
      nextAction: { kind: 'CODEX_REPAIR_AND_FRESH_QA', executableByCli: false,
        allowedFiles: next.session.authorization.inScope,
        mutationBoundary: next.session.authorization.mutationBoundary } };
  } catch (error) { return blocked(error.code ?? 'QA_REPAIR_START_FAILED'); }
}

/** Record fresh evidence only; unchanged, missing and mismatched reviews never advance. */
export function completeQaRepairRound(outputDir, { reviewOutput, apply = false } = {}) {
  const status = inspectQaRepair(outputDir);
  if (status.status !== 'PENDING_RECOVERY') return status;
  try {
    const current = withDirectory(outputDir, fromDirectory);
    const source = snapshotQaRepairSource(current.session.project);
    if (source.rootIdentity !== current.currentSource.rootIdentity ||
        source.digest === current.currentSource.digest) fail('QA_REPAIR_SOURCE_NOT_REBUILT');
    const changes = changedPaths(current.currentSource.files, source.files);
    const outOfScope = changes.filter(name => !current.session.authorization.inScope.includes(name));
    let nextReview = current.currentReview;
    let nextStatus;
    let reasonCode;
    if (outOfScope.length) {
      nextStatus = 'ESCALATE';
      reasonCode = 'QA_REPAIR_SCOPE_VIOLATION';
    } else {
      if (typeof reviewOutput !== 'string' || !path.isAbsolute(reviewOutput)) fail('QA_REPAIR_RECHECK_REQUIRED');
      const recheck = inspectQaJournal(reviewOutput);
      if (!['RECORDED_ISSUES_FOUND', 'RECORDED_REVIEWED'].includes(recheck.status) ||
          recheck.target !== current.currentReview.target ||
          recheck.candidateSha256 === current.currentReview.candidateSha256 ||
          recheck.journalSha256 === current.currentReview.journalSha256 ||
          !recheck.sourceOptions) fail('QA_REPAIR_RECHECK_UNVERIFIED');
      const fresh = planQaWebReview(recheck.sourceOptions);
      if (fresh.status !== 'READY' || fresh.candidateSha256 !== recheck.candidateSha256 ||
          JSON.stringify(fresh.images) !== JSON.stringify(recheck.recordedInputImages)) {
        fail('QA_REPAIR_RECHECK_STALE');
      }
      const findings = recheck.images.flatMap(image => image.findings.map(item => ({ ...item, imageId: image.id })));
      nextReview = { outputDir: path.resolve(reviewOutput), target: recheck.target,
        candidateSha256: recheck.candidateSha256, journalSha256: recheck.journalSha256, findings };
      const priorP0 = new Set(current.currentReview.findings.filter(item => item.severity === 'P0')
        .map(item => JSON.stringify([item.imageId, item.category, item.description])));
      const newP0 = findings.some(item => item.severity === 'P0' &&
        !priorP0.has(JSON.stringify([item.imageId, item.category, item.description])));
      const stillBlocking = findings.some(item => item.severity === 'P0' || item.severity === 'P1');
      if (newP0) { nextStatus = 'ESCALATE'; reasonCode = 'QA_REPAIR_P0_REGRESSION'; }
      else if (stillBlocking) {
        nextStatus = current.pending.round === 2 ? 'ESCALATE' : 'REWORK';
        reasonCode = nextStatus === 'ESCALATE' ? 'QA_REPAIR_BUDGET_EXHAUSTED' : 'QA_REPAIR_FINDINGS_REMAIN';
      } else { nextStatus = 'RECHECK_RECORDED'; reasonCode = 'QA_REPAIR_REINSPECTION_RECORDED_ONLY'; }
    }
    const payload = { type: 'ROUND_RESULT', round: current.pending.round, status: nextStatus,
      reasonCode, source, review: nextReview, changedPaths: changes };
    if (!apply) return { ...view({ ...current, state: nextStatus, last: payload,
      currentSource: source, currentReview: nextReview, roundsUsed: current.roundsUsed + 1,
      pending: null }), reasonCode, changedPaths: changes };
    return { ...view(appendEvent(outputDir, payload, current.lastReceiptSha256)), status: nextStatus, reasonCode,
      changedPaths: changes };
  } catch (error) { return blocked(error.code ?? 'QA_REPAIR_RECHECK_FAILED'); }
}
