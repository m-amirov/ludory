import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const MAX_EVENTS = 10;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const baseStatus = () => ({ recordedOnly: true, browserAttested: false,
  reviewProvenance: 'LOCAL_RECORD_ONLY', actualModeration: 'NOT_RUN',
  releaseReady: false, publicationAllowed: false });
const blocked = code => ({ ...baseStatus(), status: 'BLOCKED', reasonCode: code,
  images: [], sessionId: null, candidateSha256: null });

function pathPartsHaveNoLinks(filename) {
  const absolute = path.resolve(filename);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep)) {
    if (!part) continue;
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); }
    catch (error) {
      if (error.code === 'ENOENT') return false;
      fail('QA_JOURNAL_PATH_UNREADABLE');
    }
    if (stat.isSymbolicLink()) fail('QA_JOURNAL_UNSAFE_PATH');
  }
  return true;
}

function safeParent(outputDir) {
  if (typeof outputDir !== 'string' || !outputDir.trim() || !path.isAbsolute(outputDir)) {
    fail('QA_JOURNAL_OUTPUT_REQUIRED');
  }
  const output = path.resolve(outputDir);
  if (!pathPartsHaveNoLinks(path.dirname(output))) fail('QA_JOURNAL_PARENT_REQUIRED');
  const parent = fs.lstatSync(path.dirname(output), { bigint: true });
  if (!parent.isDirectory()) fail('QA_JOURNAL_PARENT_REQUIRED');
  if (fs.existsSync(output) || pathPartsHaveNoLinks(output)) fail('QA_JOURNAL_OUTPUT_EXISTS');
  return { output, parentIdentity: parent };
}

const sameDir = (a, b) => a?.isDirectory() && b?.isDirectory() &&
  a.dev === b.dev && a.ino === b.ino;

// Node has no cross-platform openat. The process CWD holds the actual directory
// inode while synchronous basename-only operations run, even if a visible path
// is renamed or replaced. This must never span an await or user callback.
function withPinnedDirectory(directory, operation, { expectedIdentity, sync = false } = {}) {
  if (!pathPartsHaveNoLinks(directory)) fail('QA_JOURNAL_OUTPUT_UNAVAILABLE');
  const before = fs.lstatSync(directory, { bigint: true });
  if (!before.isDirectory() || (expectedIdentity && !sameDir(before, expectedIdentity))) {
    fail('QA_JOURNAL_DIRECTORY_CHANGED');
  }
  const previous = process.cwd();
  try {
    process.chdir(directory);
    if (!sameDir(fs.lstatSync('.', { bigint: true }), before)) fail('QA_JOURNAL_DIRECTORY_CHANGED');
    const value = operation();
    if (sync) {
      let fd;
      try {
        fd = fs.openSync('.', fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
        fs.fsyncSync(fd);
      } catch { fail('QA_JOURNAL_DIRECTORY_DURABILITY_UNVERIFIED'); }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    if (!pathPartsHaveNoLinks(directory) ||
        !sameDir(fs.lstatSync(directory, { bigint: true }), before)) {
      fail('QA_JOURNAL_DIRECTORY_CHANGED');
    }
    return value;
  } finally { process.chdir(previous); }
}

function inside(root, target) {
  const relative = path.relative(path.resolve(root), target);
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function ensureOutputSafe(output, plan) {
  for (const forbidden of [plan.sourceOptions?.evidenceDir, plan.sourceOptions?.promoRoot]) {
    if (typeof forbidden === 'string' && inside(forbidden, output)) fail('QA_JOURNAL_SOURCE_OVERLAP');
  }
  for (const file of [
    ...plan.images.map(item => item.file),
    plan.sourceOptions?.archivePath, plan.sourceOptions?.receiptPath,
    plan.sourceOptions?.metadataPath, plan.sourceOptions?.rightsPath,
    plan.sourceOptions?.sdkEvidencePath,
  ]) {
    if (typeof file === 'string' && (inside(output, file) || output === path.resolve(file))) {
      fail('QA_JOURNAL_SOURCE_OVERLAP');
    }
  }
}

function stableWrite(file, value) {
  if (path.isAbsolute(file) || path.basename(file) !== file) fail('QA_JOURNAL_FILE_UNSAFE');
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > 128 * 1024) fail('QA_JOURNAL_EVENT_TOO_LARGE');
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function safeJson(file, maxBytes = 128 * 1024) {
  if (!pathPartsHaveNoLinks(file)) fail('QA_JOURNAL_FILE_MISSING');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size < 2 || stat.size > maxBytes) fail('QA_JOURNAL_FILE_UNSAFE');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino ||
        opened.size !== stat.size) fail('QA_JOURNAL_FILE_CHANGED');
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('QA_JOURNAL_FILE_CHANGED');
    return JSON.parse(bytes.toString('utf8'));
  } finally { fs.closeSync(fd); }
}

const eventFile = index => `${String(index).padStart(6, '0')}.json`;
const coreEvent = event => ({ schemaVersion: event.schemaVersion, index: event.index,
  previousSha256: event.previousSha256, payload: event.payload });

/** Creates one opt-in output directory; never touches any original game/candidate file. */
export function beginQaJournal(outputDir, plan) {
  if (plan?.kind !== 'qa-web-review-plan' || plan.status !== 'READY' ||
      !Array.isArray(plan.images) || plan.images.length !== 5 || !SHA.test(plan.candidateSha256 ?? '')) {
    fail('QA_JOURNAL_PLAN_INVALID');
  }
  const { output, parentIdentity } = safeParent(outputDir);
  ensureOutputSafe(output, plan);
  const sessionId = randomUUID();
  const content = { schemaVersion: 1, kind: 'qa-web-review-session', sessionId,
    target: plan.target, candidateSha256: plan.candidateSha256,
    captureStatus: plan.captureStatus, captureReportSha256: plan.captureReportSha256,
    metadataSha256: plan.metadataSha256, reviewerModel: 'chatgpt-web/gpt-6-sol-instant',
    reviewerEffort: 'low', sourceOptions: plan.sourceOptions,
    images: plan.images.map(({ id, kind, file, sha256, size, mimeType, ref }) =>
      ({ id, kind, file, sha256, size, mimeType, ref })) };
  const session = { ...content, sha256: hash(JSON.stringify(content)) };
  let created;
  try {
    created = withPinnedDirectory(path.dirname(output), () => {
      fs.mkdirSync(path.basename(output), { mode: 0o700 });
      return fs.lstatSync(path.basename(output), { bigint: true });
    }, { expectedIdentity: parentIdentity, sync: true });
  }
  catch (error) { fail(error.code === 'EEXIST' ? 'QA_JOURNAL_OUTPUT_EXISTS' :
    error.code?.startsWith('QA_') ? error.code : 'QA_JOURNAL_CREATE_FAILED'); }
  withPinnedDirectory(output, () => stableWrite('session.json', session),
    { expectedIdentity: created, sync: true });
  return { sessionId, outputDir: output };
}

// Must be called inside withPinnedDirectory so every open remains cwd-relative.
function loadJournalFromCwd(outputDir) {
  const folder = path.resolve(outputDir);
  const session = safeJson('session.json');
  if (!session || session.schemaVersion !== 1 || session.kind !== 'qa-web-review-session' ||
      typeof session.sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(session.sessionId) ||
      !SHA.test(session.candidateSha256 ?? '') || !SHA.test(session.sha256 ?? '') ||
      !Array.isArray(session.images) || session.images.length !== 5 ||
      session.reviewerModel !== 'chatgpt-web/gpt-6-sol-instant' || session.reviewerEffort !== 'low') {
    fail('QA_JOURNAL_SESSION_INVALID');
  }
  const { sha256: declared, ...body } = session;
  if (hash(JSON.stringify(body)) !== declared) fail('QA_JOURNAL_SESSION_CHANGED');
  const files = fs.readdirSync('.').sort();
  const events = files.filter(name => name !== 'session.json');
  if (events.length > MAX_EVENTS || events.some((name, index) =>
    name !== `${String(index + 1).padStart(6, '0')}.json`)) fail('QA_JOURNAL_SEQUENCE_INVALID');
  const images = [];
  let pending = null;
  let previous = declared;
  for (const [index, name] of events.entries()) {
    const event = safeJson(name);
    if (!event || event.schemaVersion !== 1 || event.index !== index + 1 ||
        event.previousSha256 !== previous || !SHA.test(event.sha256 ?? '') ||
        hash(JSON.stringify(coreEvent(event))) !== event.sha256 ||
        !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
      fail('QA_JOURNAL_EVENT_INVALID');
    }
    const row = event.payload;
    const image = session.images[row.imageIndex];
    if (!image || !Number.isSafeInteger(row.imageIndex) || row.imageSha256 !== image.sha256 ||
        typeof row.traceId !== 'string' || row.traceId !== `qa-${session.sessionId}-${row.imageIndex}`) {
      fail('QA_JOURNAL_EVENT_MISMATCH');
    }
    if (row.type === 'REQUESTED' && pending === null && row.imageIndex === images.length &&
        Object.keys(row).every(key => ['type', 'imageIndex', 'traceId', 'imageSha256'].includes(key))) {
      pending = row;
    } else if (row.type === 'OBSERVED' && pending && row.imageIndex === pending.imageIndex &&
        row.traceId === pending.traceId && ['REVIEWED', 'ISSUES_FOUND'].includes(row.verdict) &&
        typeof row.summary === 'string' && row.summary.length <= 3000 &&
        Array.isArray(row.findings) && row.findings.length <= 12 &&
        row.hostObservation?.protocolVersion === 2 && row.hostObservation?.source === 'browser-ui' &&
        Object.keys(row).every(key => ['type', 'imageIndex', 'traceId', 'imageSha256', 'verdict',
          'summary', 'findings', 'hostObservation'].includes(key))) {
      images.push({ id: image.id, kind: image.kind, sha256: image.sha256, verdict: row.verdict,
        summary: row.summary, findings: row.findings });
      pending = null;
    } else fail('QA_JOURNAL_EVENT_ORDER');
    previous = event.sha256;
  }
  return { folder, session, images, pending, events, previous };
}

/** Appends one durable event; a failed REQUESTED publication forbids any host call. */
export function appendQaJournal(outputDir, payload) {
  return withPinnedDirectory(outputDir, () => appendFromCwd(outputDir, payload), { sync: true });
}

function appendFromCwd(outputDir, payload) {
  const current = loadJournalFromCwd(outputDir);
  if (current.events.length >= MAX_EVENTS) fail('QA_JOURNAL_LIMIT');
  const session = current.session;
  const image = session.images[payload?.imageIndex];
  if (!image || payload.imageSha256 !== image.sha256 ||
      payload.traceId !== `qa-${session.sessionId}-${payload.imageIndex}`) fail('QA_JOURNAL_EVENT_MISMATCH');
  const isRequest = payload.type === 'REQUESTED' && !current.pending &&
    payload.imageIndex === current.images.length;
  const isResult = payload.type === 'OBSERVED' && current.pending &&
    payload.imageIndex === current.pending.imageIndex &&
    payload.traceId === current.pending.traceId;
  if (!isRequest && !isResult) fail('QA_JOURNAL_EVENT_ORDER');
  // Keep event form narrow before serializing; no source bytes, credentials or prompts.
  const allowed = isRequest ? ['type', 'imageIndex', 'traceId', 'imageSha256'] :
    ['type', 'imageIndex', 'traceId', 'imageSha256', 'verdict', 'summary', 'findings', 'hostObservation'];
  if (!payload || Object.keys(payload).some(key => !allowed.includes(key))) fail('QA_JOURNAL_EVENT_INVALID');
  if (isResult && (!['REVIEWED', 'ISSUES_FOUND'].includes(payload.verdict) ||
      typeof payload.summary !== 'string' || !Array.isArray(payload.findings) ||
      !payload.hostObservation || typeof payload.hostObservation !== 'object')) fail('QA_JOURNAL_EVENT_INVALID');
  const event = { schemaVersion: 1, index: current.events.length + 1,
    previousSha256: current.previous, payload };
  const receipt = { ...event, sha256: hash(JSON.stringify(event)) };
  try { stableWrite(eventFile(receipt.index), receipt); }
  catch (error) { fail(error?.code?.startsWith('QA_') ? error.code : 'QA_JOURNAL_COMMIT_FAILED'); }
  return receipt.sha256;
}

/** Read-only historical status. Never authenticates a prior browser session. */
export function inspectQaJournal(outputDir) {
  try {
    return withPinnedDirectory(outputDir, () => inspectFromCwd(outputDir));
  } catch (error) { return blocked(error?.code?.startsWith('QA_') ? error.code : 'QA_JOURNAL_UNREADABLE'); }
}

function inspectFromCwd(outputDir) {
  const current = loadJournalFromCwd(outputDir);
  const complete = current.images.length === 5 && !current.pending;
  return { ...baseStatus(), status: complete
    ? current.images.some(row => row.verdict === 'ISSUES_FOUND') ? 'RECORDED_ISSUES_FOUND' : 'RECORDED_REVIEWED'
    : 'PENDING_RECOVERY', sessionId: current.session.sessionId,
    target: current.session.target, candidateSha256: current.session.candidateSha256,
    captureStatus: current.session.captureStatus, captureReportSha256: current.session.captureReportSha256,
    metadataSha256: current.session.metadataSha256,
    images: current.images, pending: current.pending ? { imageIndex: current.pending.imageIndex,
      traceId: current.pending.traceId } : null,
    sourceOptions: current.session.sourceOptions, recordedInputImages: current.session.images,
    journalSha256: current.previous };
}
