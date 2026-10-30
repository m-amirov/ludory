import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPipeline, checkTransition } from './pipelines.mjs';
import { inspectNativeProject, verifyNativeSource, snapshotArtifact } from './source.mjs';
import { inspectGeneratedImage, readProjectImageInput } from './image-artifacts.mjs';
import { canonicalPhysicalDirectory } from '@ludory/core';
import { validateNarrativeVerdict } from './narrative-review-contract.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serial = value => `${JSON.stringify(value, null, 2)}\n`;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/;
const EXCLUSIVE = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
const EXECUTION_CODES = new Set(['EXECUTED_UNVERIFIED', 'EXECUTOR_INCOMPLETE', 'EXECUTOR_UNAVAILABLE',
  'EXECUTOR_TIMEOUT', 'EXECUTOR_OUTPUT_LIMIT', 'EXECUTOR_SPAWN_FAILED', 'EXECUTOR_NONZERO_EXIT',
  'EXECUTOR_MALFORMED_JSONL', 'EXECUTOR_TURN_FAILED', 'EXECUTOR_WRAPPER_UNSUPPORTED',
  'EXECUTOR_INTERRUPTED', 'EXECUTOR_CHECKS_FAILED']);
const DEV_TASKS = new Set(['episode-script', 'art-concept']);
const REVIEW_CODES = new Set(['HOST_OBSERVED', 'REVIEW_RESPONSE_UNVERIFIED', 'REVIEW_INTERRUPTED']);
const DEV_RESULT_CODES = new Set(['HOST_OBSERVED', 'DEV_EXECUTOR_UNVERIFIED', 'DEV_EXECUTOR_INTERRUPTED']);
const DEV_MODEL = /^gpt-\d+(?:\.\d+)?-sol$/i;
const IMAGE_MODEL = /^gpt-\d+(?:\.\d+)?-(?:terra|sol)$/i;
// Read-only compatibility for signed native run events created before the API route
// was removed. This is a ledger schema, NOT an executable provider or CLI option.
const ARCHIVED_IMAGE_REQUEST_MODELS = new Map([
  ['auto', 'gpt-image-2.5-sunburst'], ['sunburst', 'gpt-image-2.5-sunburst'],
  ['flare', 'gpt-image-2.5-flare'],
]);
const IMAGE_CODES = new Set(['HOST_OBSERVED', 'IMAGE_EXECUTOR_UNVERIFIED', 'IMAGE_EXECUTOR_INTERRUPTED']);
const ART_REVIEW_CODES = new Set(['ART_REVIEW_OBSERVED', 'ART_REVIEW_INTERRUPTED']);

/** A paid host turn must never start until its intent has crossed the filesystem barrier.
 * On platforms that cannot flush directory metadata (including some Windows filesystems),
 * fail closed instead of silently claiming an unproven durable journal. */
function flushNativeDirectory() {
  let fd;
  try {
    fd = fs.openSync('.', fs.constants.O_RDONLY);
    if (!fs.fstatSync(fd).isDirectory()) throw new Error('NOT_A_DIRECTORY');
    fs.fsyncSync(fd);
  } catch { throw new Error('NATIVE_STORAGE_DURABILITY_UNVERIFIED'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function flushNativeFile(fd) {
  try { fs.fsyncSync(fd); }
  catch { throw new Error('NATIVE_STORAGE_DURABILITY_UNVERIFIED'); }
}

/** Read-only inventory of narrowly recognized crash remnants. Never infer that
 * an external reviewer has stopped merely because a local lock is stale. */
export function inspectNativeStorageRecovery(projectDir, runId) {
  const project = canonicalPhysicalDirectory(projectDir);
  if (!RUN_ID.test(runId) || runId.includes('..')) throw new Error('NATIVE_RECOVERY_RUN_INVALID');
  const runDir = checkedRunDir(project, runId);
  const aiDir = path.join(project, '.ludory', 'ai');
  const eventsDir = path.join(runDir, 'events');
  const entries = [];
  const collect = (file, label) => {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 4 * 1024 * 1024) {
      throw new Error('NATIVE_RECOVERY_UNSAFE_ENTRY');
    }
    const bytes = fs.readFileSync(file);
    entries.push({ file, label, sha256: sha256(bytes), dev: st.dev, ino: st.ino, size: st.size });
  };
  const lock = path.join(aiDir, '.lock');
  if (fs.existsSync(lock)) {
    collect(lock, 'lock');
    const raw = fs.readFileSync(lock, 'utf8');
    if (!/^[1-9]\d*\n$/.test(raw)) throw new Error('NATIVE_RECOVERY_LOCK_UNKNOWN');
    const pid = Number(raw.trim());
    if (!Number.isSafeInteger(pid)) throw new Error('NATIVE_RECOVERY_LOCK_UNKNOWN');
    try { process.kill(pid, 0); throw new Error('NATIVE_RECOVERY_EXECUTOR_MAY_BE_ACTIVE'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const indexed = new Map();
  for (const name of fs.readdirSync(eventsDir)) {
    if (/^\.pending-[a-f0-9]{24}$/.test(name)) collect(path.join(eventsDir, name), `event-${name.slice(1)}`);
    else if (!/^\d{6}(?:\.commit)?\.json$/.test(name)) throw new Error('NATIVE_RECOVERY_UNKNOWN_EVENT_ENTRY');
    else {
      const index = Number(name.slice(0, 6));
      if (!indexed.has(index)) indexed.set(index, {});
      indexed.get(index)[name.endsWith('.commit.json') ? 'marker' : 'event'] = name;
    }
  }
  const ordered = [...indexed].sort((a, b) => a[0] - b[0]);
  for (let offset = 0; offset < ordered.length; offset++) {
    const [index, pair] = ordered[offset];
    if (index !== offset + 1) throw new Error('NATIVE_RECOVERY_EVENT_SEQUENCE');
    if (!pair.event || !pair.marker) {
      if (offset !== ordered.length - 1) throw new Error('NATIVE_RECOVERY_EVENT_SEQUENCE');
      collect(path.join(eventsDir, pair.event ?? pair.marker), `event-${pair.event ?? pair.marker}`);
      continue;
    }
    const { data: marker } = readJsonBounded(path.join(eventsDir, pair.marker));
    const { bytes } = readJsonBounded(path.join(eventsDir, pair.event));
    if (marker.index !== index || marker.eventSha256 !== sha256(bytes)) {
      throw new Error('NATIVE_RECOVERY_COMMITTED_EVENT_INVALID');
    }
  }
  return { kind: 'NATIVE_STORAGE_RECOVERY', status: entries.length ? 'NEEDS_CONFIRMATION' : 'CLEAN',
    project, runId, entries };
}

export function applyNativeStorageRecovery(preview, { confirmNoExecutor = false } = {}) {
  if (!confirmNoExecutor) throw new Error('NATIVE_RECOVERY_CONFIRMATION_REQUIRED');
  if (preview?.kind !== 'NATIVE_STORAGE_RECOVERY') throw new Error('NATIVE_RECOVERY_PLAN_INVALID');
  const fresh = inspectNativeStorageRecovery(preview.project, preview.runId);
  if (JSON.stringify(fresh.entries) !== JSON.stringify(preview.entries)) {
    throw new Error('NATIVE_RECOVERY_STALE_PLAN');
  }
  if (!fresh.entries.length) return { status: 'CLEAN', quarantine: null };
  const quarantine = path.join(preview.project, '.ludory', `recovery-${crypto.randomBytes(12).toString('hex')}`);
  fs.mkdirSync(quarantine, { mode: 0o700 });
  for (const entry of fresh.entries) {
    const target = path.join(quarantine, entry.label);
    fs.renameSync(entry.file, target);
  }
  return { status: 'RECOVERED', quarantine, moved: fresh.entries.length };
}

function validateArtRequest(request, current) {
  const imported = current.events.find(event => event.kind === 'IMAGE_IMPORTED')?.manual;
  if (!imported || !request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).sort().join(',') !== 'brief,image,modelObserved,sources' ||
      request.modelObserved !== 'gpt-6-sol' ||
      request.image?.path !== imported.output.outputPath ||
      request.image?.sha256 !== imported.output.outputSha256 ||
      request.image?.size !== imported.output.outputSize ||
      request.image?.mediaType !== imported.output.mediaType ||
      request.image?.ref !== `candidate-${imported.output.outputSha256.slice(0, 20)}` ||
      JSON.stringify(request.brief) !== JSON.stringify(imported.brief) ||
      !Array.isArray(request.sources) || request.sources.length !== 4 ||
      request.sources.map(x => x?.role).join(',') !== 'scene,characters,location,style' ||
      request.sources.some(x => typeof x.path !== 'string' || !x.path ||
        !/^[a-f0-9]{64}$/.test(x.sha256 ?? '') || !Number.isSafeInteger(x.size) || x.size < 1)) {
    throw new Error('NATIVE_ART_REVIEW_REQUEST_INVALID');
  }
  return request;
}

function validateArtResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      Object.keys(result).sort().join(',') !== 'code,receiptSha256' ||
      !ART_REVIEW_CODES.has(result.code) ||
      (result.code === 'ART_REVIEW_OBSERVED'
        ? !/^[a-f0-9]{64}$/.test(result.receiptSha256 ?? '')
        : result.receiptSha256 !== null)) throw new Error('NATIVE_ART_REVIEW_RESULT_INVALID');
  return result;
}

function verifyArtResultReceipt(project, runId, requestSha256, result) {
  if (result.code !== 'ART_REVIEW_OBSERVED') return;
  const matching = readNativeArtReviews(project, runId).filter(item =>
    item.artRequestSha256 === requestSha256 && sha256(serial(item)) === result.receiptSha256);
  if (matching.length !== 1) throw new Error('NATIVE_ART_REVIEW_RECEIPT_NOT_FOUND');
}

function validateImageRequest(request, { allowArchived = false } = {}) {
  const archived = allowArchived && request?.route === 'gpt-image' &&
    ARCHIVED_IMAGE_REQUEST_MODELS.get(request.requestedModel) === request.modelRequested &&
    request.modelObserved === null;
  const legacy = ['image-terra', 'image-sol'].includes(request?.route) &&
      ['auto', 'terra', 'sol'].includes(request?.requestedModel) &&
      IMAGE_MODEL.test(request?.modelObserved ?? '') &&
      request.modelObserved.endsWith(request.route.slice(6)) &&
      (request.requestedModel === 'auto' || `image-${request.requestedModel}` === request.route);
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      request.taskKind !== 'image' || !(archived || legacy) ||
      !request.brief || typeof request.brief.path !== 'string' ||
      !/^[a-f0-9]{64}$/.test(request.brief.sha256 ?? '') ||
      !Number.isSafeInteger(request.brief.size) || request.brief.size < 1 ||
      request.brief.size > 64 * 1024) throw new Error('NATIVE_IMAGE_REQUEST_INVALID');
  return { taskKind: 'image', route: request.route, requestedModel: request.requestedModel,
    modelObserved: request.modelObserved,
    ...(archived && { modelRequested: request.modelRequested }),
    brief: { ...request.brief } };
}

function validateImageOutput(image, runId, requestIndex, order, modelObserved) {
  const prefix = `.ludory/ai/runs/${runId}/images/image-${String(requestIndex).padStart(6, '0')}-${order}.`;
  if (!image || typeof image !== 'object' || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mediaType) ||
      image.outputPath !== `${prefix}${image.mediaType === 'image/png' ? 'png' : image.mediaType === 'image/jpeg' ? 'jpg' : 'webp'}` ||
      !/^[a-f0-9]{64}$/.test(image.outputSha256 ?? '') ||
      !Number.isSafeInteger(image.outputSize) || image.outputSize < 1 || image.outputSize > 10 * 1024 * 1024 ||
      !Number.isSafeInteger(image.width) || image.width < 1 || image.width > 16384 ||
      !Number.isSafeInteger(image.height) || image.height < 1 || image.height > 16384 ||
      image.width * image.height > 64 * 1024 * 1024 || image.modelObserved !== modelObserved) {
    throw new Error('NATIVE_IMAGE_OUTPUT_INVALID');
  }
  return { outputPath: image.outputPath, outputSha256: image.outputSha256,
    outputSize: image.outputSize, mediaType: image.mediaType, width: image.width,
    height: image.height, modelObserved: image.modelObserved };
}

function validateImageResult(result, runId, request) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      !IMAGE_CODES.has(result.code) || result.ok !== (result.code === 'HOST_OBSERVED') ||
      result.reviewStatus !== 'PENDING_REVIEW' || !Array.isArray(result.images)) {
    throw new Error('NATIVE_IMAGE_RESULT_INVALID');
  }
  if (result.ok) {
    if (result.modelObserved !== request?.modelObserved || !result.images.length || result.images.length > 4) {
      throw new Error('NATIVE_IMAGE_RESULT_INVALID');
    }
  } else if (result.modelObserved !== null || result.images.length) throw new Error('NATIVE_IMAGE_RESULT_INVALID');
  return { ok: result.ok, code: result.code, reviewStatus: 'PENDING_REVIEW',
    modelObserved: result.modelObserved, images: result.images.map((img, index) =>
      validateImageOutput(img, runId, request?.eventIndex, index, request?.modelObserved)) };
}

function validateImageManualImport(value, runId, index, { allowArchived = false } = {}) {
  if (!value || typeof value !== 'object' || value.taskKind !== 'image' ||
      value.provenance !== 'USER_DECLARED' || value.reviewStatus !== 'PENDING_REVIEW' ||
      !value.brief || !value.source || !value.output ||
      (value.handoffSha256 !== undefined && !/^[a-f0-9]{64}$/.test(value.handoffSha256)) ||
      !(allowArchived ? ['auto', 'terra', 'sol', 'sunburst', 'flare']
        : ['auto', 'terra', 'sol']).includes(value.requestedModel)) throw new Error('NATIVE_IMAGE_IMPORT_INVALID');
  for (const item of [value.brief, value.source]) {
    if (typeof item.path !== 'string' || !item.path || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') ||
        !Number.isSafeInteger(item.size) || item.size < 1) throw new Error('NATIVE_IMAGE_IMPORT_INVALID');
  }
  const item = value.output;
  if (value.source.sha256 !== item.outputSha256 || value.source.size !== item.outputSize) {
    throw new Error('NATIVE_IMAGE_IMPORT_INVALID');
  }
  const escapedRun = runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expectedExtension = item.mediaType === 'image/png' ? '.png'
    : item.mediaType === 'image/jpeg' ? '.jpg' : item.mediaType === 'image/webp' ? '.webp' : null;
  if (!new RegExp(`^\\.ludory/ai/runs/${escapedRun}/images/import-${String(index).padStart(6, '0')}-[a-f0-9]{24}\\.(?:png|jpg|webp)$`).test(item.outputPath ?? '') ||
      !expectedExtension || !item.outputPath.endsWith(expectedExtension) ||
      item.modelObserved !== null || !['image/png', 'image/jpeg', 'image/webp'].includes(item.mediaType) ||
      !/^[a-f0-9]{64}$/.test(item.outputSha256 ?? '') ||
      !Number.isSafeInteger(item.outputSize) || item.outputSize < 1 || item.outputSize > 10 * 1024 * 1024 ||
      !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height) ||
      item.width < 1 || item.height < 1 || item.width > 16384 || item.height > 16384 ||
      item.width * item.height > 64 * 1024 * 1024) throw new Error('NATIVE_IMAGE_IMPORT_INVALID');
  return { taskKind: 'image', provenance: 'USER_DECLARED', reviewStatus: 'PENDING_REVIEW',
    requestedModel: value.requestedModel, brief: { ...value.brief },
    source: { ...value.source }, output: { ...item },
    ...(value.handoffSha256 && { handoffSha256: value.handoffSha256 }) };
}

function validateDevRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      !DEV_TASKS.has(request.taskKind) || request.route !== 'web-dev' ||
      !DEV_MODEL.test(request.modelObserved ?? '') ||
      !request.brief || !Array.isArray(request.sources) || request.sources.length > 8) {
    throw new Error('NATIVE_DEV_REQUEST_INVALID');
  }
  for (const item of [request.brief, ...request.sources]) {
    if (!item || typeof item.path !== 'string' || !item.path ||
        !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') ||
        !Number.isSafeInteger(item.size) || item.size < 1) {
      throw new Error('NATIVE_DEV_REQUEST_INVALID');
    }
  }
  return { taskKind: request.taskKind, route: 'web-dev', modelObserved: request.modelObserved,
    brief: { ...request.brief }, sources: request.sources.map(item => ({ ...item })) };
}

function validateDevResult(result, runId, pendingRequest) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      !DEV_RESULT_CODES.has(result.code) ||
      result.ok !== (result.code === 'HOST_OBSERVED') ||
      result.reviewStatus !== 'PENDING_REVIEW') throw new Error('NATIVE_DEV_RESULT_INVALID');
  if (result.ok) {
    if (result.modelObserved !== pendingRequest?.modelObserved ||
        result.outputPath !== `.ludory/ai/runs/${runId}/drafts/draft-${String(pendingRequest.eventIndex).padStart(6, '0')}.md` ||
        !/^[a-f0-9]{64}$/.test(result.outputSha256 ?? '') ||
        !Number.isSafeInteger(result.outputSize) || result.outputSize < 1 || result.outputSize > 256 * 1024) {
      throw new Error('NATIVE_DEV_RESULT_INVALID');
    }
  } else if (result.outputPath !== null || result.outputSha256 !== null ||
      result.outputSize !== null || result.modelObserved !== null) {
    throw new Error('NATIVE_DEV_RESULT_INVALID');
  }
  return { ok: result.ok, code: result.code, reviewStatus: 'PENDING_REVIEW',
    modelObserved: result.modelObserved, outputPath: result.outputPath,
    outputSha256: result.outputSha256, outputSize: result.outputSize };
}

function validateManualImport(value, runId, index) {
  if (!value || typeof value !== 'object' || !DEV_TASKS.has(value.taskKind) ||
      value.provenance !== 'USER_DECLARED' || value.reviewStatus !== 'PENDING_REVIEW' ||
      !value.brief || !value.source || !value.output ||
      !new RegExp(`^\\.ludory/ai/runs/${runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/drafts/import-${String(index).padStart(6, '0')}-[a-f0-9]{24}\\.md$`)
        .test(value.output.outputPath ?? '') ||
      !/^[a-f0-9]{64}$/.test(value.output.outputSha256 ?? '') ||
      !Number.isSafeInteger(value.output.outputSize) ||
      value.output.outputSize < 1 || value.output.outputSize > 256 * 1024) {
    throw new Error('NATIVE_DEV_MANUAL_IMPORT_INVALID');
  }
  for (const item of [value.brief, value.source]) {
    if (typeof item.path !== 'string' || !item.path ||
        !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') ||
        !Number.isSafeInteger(item.size) || item.size < 1) {
      throw new Error('NATIVE_DEV_MANUAL_IMPORT_INVALID');
    }
  }
  return { taskKind: value.taskKind, provenance: 'USER_DECLARED', reviewStatus: 'PENDING_REVIEW',
    brief: { ...value.brief }, source: { ...value.source }, output: { ...value.output } };
}

function draftDescriptor(item) {
  return { path: item.outputPath, sha256: item.outputSha256, size: item.outputSize };
}

/** Read the latest completed episode draft in a run; never infer an artifact from a filename. */
export function episodeDraftOfRun(current) {
  const events = current.events;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === 'DRAFT_IMPORTED' && event.manual.taskKind === 'episode-script') {
      return { draft: draftDescriptor(event.manual.output), brief: event.manual.brief,
        sources: [], taskKind: 'episode-script' };
    }
    if (event.kind === 'EXECUTION_RESULT' && event.result.ok &&
        events[i - 1]?.kind === 'ACTION_REQUESTED' &&
        events[i - 1].executor === 'web-dev' && events[i - 1].request.taskKind === 'episode-script') {
      return { draft: draftDescriptor(event.result), brief: events[i - 1].request.brief,
        sources: events[i - 1].request.sources, taskKind: 'episode-script' };
    }
  }
  return null;
}

function reviewedEpisodeIsCurrent(current) {
  const episode = episodeDraftOfRun(current);
  return !episode || (current.narrativeReview?.verdict === 'ACCEPT' &&
    current.narrativeReview.draftSha256 === episode.draft.sha256);
}

function validateNarrativeRequest(value, sourceDraft) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'brief,draft,modelObserved,sources,taskKind' ||
      value.taskKind !== 'episode-script' || value.modelObserved !== 'gpt-6-sol' ||
      !sourceDraft || JSON.stringify(value) !== JSON.stringify({
        taskKind: 'episode-script', modelObserved: 'gpt-6-sol',
        draft: sourceDraft.draft, brief: sourceDraft.brief, sources: sourceDraft.sources,
      })) throw new Error('NATIVE_REVIEW_REQUEST_INVALID');
  return value;
}

function readBoundText(project, source) {
  const snapshot = snapshotArtifact(project, source.path, { maxBytes: 256 * 1024 });
  if (snapshot.sha256 !== source.sha256 || snapshot.size !== source.size) {
    throw new Error('NATIVE_REVIEW_SOURCE_STALE');
  }
  const value = fs.readFileSync(path.join(project, ...source.path.split('/')));
  if (sha256(value) !== source.sha256 || value.includes(0)) throw new Error('NATIVE_REVIEW_SOURCE_STALE');
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}

function verifyNarrativeInputs(project, request) {
  const draft = readBoundText(project, request.draft);
  readBoundText(project, request.brief);
  for (const source of request.sources) readBoundText(project, source);
  return draft;
}

function validateNarrativeResult(value, request, draftText) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'code,modelObserved,report' ||
      !REVIEW_CODES.has(value.code) || !Object.hasOwn(value, 'modelObserved') ||
      !Object.hasOwn(value, 'report')) throw new Error('NATIVE_REVIEW_RESULT_INVALID');
  const trusted = value.code === 'HOST_OBSERVED';
  if (value.modelObserved !== (trusted ? request.modelObserved : null)) {
    throw new Error('NATIVE_REVIEW_RESULT_INVALID');
  }
  let report;
  try { report = validateNarrativeVerdict(value.report, draftText, request.draft.sha256); }
  catch { throw new Error('NATIVE_REVIEW_RESULT_INVALID'); }
  if (!trusted && report.verdict !== 'BLOCKED') throw new Error('NATIVE_REVIEW_RESULT_INVALID');
  return { code: value.code, modelObserved: value.modelObserved, report };
}

function verifyDraftInputs(project, files) {
  for (const item of files) {
    try {
      const now = snapshotArtifact(project, item.path);
      if (now.sha256 !== item.sha256 || now.size !== item.size) throw new Error('NATIVE_DEV_SOURCE_STALE');
    } catch { throw new Error('NATIVE_DEV_SOURCE_STALE'); }
  }
}

function validateExecutionResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      typeof result.ok !== 'boolean' || !EXECUTION_CODES.has(result.code) ||
      !(result.exitCode === null || (Number.isSafeInteger(result.exitCode) && result.exitCode >= 0)) ||
      !/^[a-f0-9]{64}$/.test(result.transcriptSha256 ?? '') ||
      !Number.isSafeInteger(result.eventCount) || result.eventCount < 0 ||
      typeof result.completed !== 'boolean' ||
      (result.ok !== (result.code === 'EXECUTED_UNVERIFIED')) ||
      (result.ok && (result.exitCode !== 0 || !result.completed))) {
    throw new Error('NATIVE_EXECUTION_RESULT_INVALID');
  }
  return { ok: result.ok, code: result.code, exitCode: result.exitCode,
    transcriptSha256: result.transcriptSha256, eventCount: result.eventCount, completed: result.completed };
}

function directoryIdentity(dir) {
  const st = fs.statSync(dir, { bigint: true });
  if (!st.isDirectory()) throw new Error('NATIVE_STORAGE_FOREIGN_PATH');
  return `${st.dev}:${st.ino}`;
}

/** Enter only verified direct children; subsequent relative writes stay on the entered directory inode. */
function enterDirectory(name, create = false) {
  if (create) {
    try { fs.mkdirSync(name, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const stat = fs.lstatSync(name, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('NATIVE_STORAGE_FOREIGN_PATH');
  const expected = `${stat.dev}:${stat.ino}`;
  process.chdir(name);
  if (directoryIdentity('.') !== expected) throw new Error('NATIVE_STORAGE_DIRECTORY_CHANGED');
  return expected;
}

function withinDirectory(name, create, fn) {
  enterDirectory(name, create);
  try { return fn(); }
  finally { process.chdir('..'); }
}

function safeDir(dir, { create = false } = {}) {
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('NATIVE_STORAGE_FOREIGN_PATH');
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    fs.mkdirSync(dir, { mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('NATIVE_STORAGE_FOREIGN_PATH');
  }
}

function storage(project, create = false) {
  const root = path.join(project, '.ludory');
  const ai = path.join(root, 'ai');
  const runs = path.join(ai, 'runs');
  safeDir(root, { create });
  safeDir(ai, { create });
  if (fs.readdirSync(ai).some(name => !['runs', '.lock'].includes(name))) {
    throw new Error('NATIVE_STORAGE_FOREIGN_PATH');
  }
  safeDir(runs, { create });
  if (fs.readdirSync(runs, { withFileTypes: true }).some(entry =>
    !entry.isDirectory() || !RUN_ID.test(entry.name) || entry.name.includes('..'))) {
    throw new Error('NATIVE_STORAGE_FOREIGN_PATH');
  }
  return { ai, runs };
}

function withLock(project, expectedSource, fn) {
  const priorCwd = process.cwd();
  let fd, lockIdentity, aiIdentity, runsIdentity;
  try {
    process.chdir(project);
    if (directoryIdentity('.') !== expectedSource.rootIdentity) throw new Error('NATIVE_SOURCE_ROOT_CHANGED');
    enterDirectory('.ludory', true);
    aiIdentity = enterDirectory('ai', true);
    if (fs.readdirSync('.').some(name => !['runs', '.lock'].includes(name))) {
      throw new Error('NATIVE_STORAGE_FOREIGN_PATH');
    }
    try { fd = fs.openSync('.lock', EXCLUSIVE, 0o600); }
    catch { throw new Error('NATIVE_STORAGE_LOCKED'); }
    const lock = fs.fstatSync(fd);
    lockIdentity = `${lock.dev}:${lock.ino}`;
    fs.writeSync(fd, `${process.pid}\n`);
    runsIdentity = enterDirectory('runs', true);
    if (fs.readdirSync('.', { withFileTypes: true }).some(entry =>
      !entry.isDirectory() || !RUN_ID.test(entry.name) || entry.name.includes('..'))) {
      throw new Error('NATIVE_STORAGE_FOREIGN_PATH');
    }
    return fn();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (lockIdentity) {
      try {
        if (runsIdentity && directoryIdentity('.') === runsIdentity) process.chdir('..');
        if (directoryIdentity('.') === aiIdentity) {
          const current = fs.lstatSync('.lock');
          if (`${current.dev}:${current.ino}` === lockIdentity && current.isFile() && !current.isSymbolicLink()) {
            fs.unlinkSync('.lock');
          }
        }
      } catch { /* Retain a displaced/foreign lock for manual recovery. */ }
    }
    process.chdir(priorCwd);
  }
}

function readJsonBounded(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('NATIVE_INTEGRITY_UNSAFE_FILE');
  const bytes = fs.readFileSync(file);
  let data;
  try { data = JSON.parse(bytes); }
  catch { throw new Error('NATIVE_INTEGRITY_INVALID_JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('NATIVE_INTEGRITY_INVALID_OBJECT');
  return { data, bytes };
}

function checkedRunDir(project, runId) {
  if (!RUN_ID.test(runId) || runId.includes('..')) throw new Error('NATIVE_INVALID_RUN_ID');
  const dir = path.join(storage(project).runs, runId);
  safeDir(dir);
  return dir;
}

/** Independently inspect committed image bytes, not metadata supplied by a host or event caller. */
function verifyStoredImage(project, runId, output) {
  const expectedBase = path.basename(output.outputPath ?? '');
  if (!expectedBase || output.outputPath !== `.ludory/ai/runs/${runId}/images/${expectedBase}`) {
    throw new Error('NATIVE_IMAGE_OUTPUT_INVALID');
  }
  const previous = process.cwd();
  let fd;
  try {
    process.chdir(project);
    enterDirectory('.ludory');
    enterDirectory('ai');
    enterDirectory('runs');
    enterDirectory(runId);
    enterDirectory('images');
    const stat = fs.lstatSync(expectedBase, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n ||
        stat.size < 1n || stat.size > 10n * 1024n * 1024n) throw new Error('NATIVE_IMAGE_OUTPUT_INVALID');
    fd = fs.openSync(expectedBase, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== stat.dev ||
        opened.ino !== stat.ino || opened.size !== stat.size) throw new Error('NATIVE_IMAGE_OUTPUT_INVALID');
    const bytes = fs.readFileSync(fd);
    const info = inspectGeneratedImage(bytes, { mediaType: output.mediaType });
    const after = fs.lstatSync(expectedBase, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
        after.nlink !== 1n || info.sha256 !== output.outputSha256 ||
        info.size !== output.outputSize || info.width !== output.width ||
        info.height !== output.height) throw new Error('NATIVE_IMAGE_OUTPUT_INVALID');
  } catch { throw new Error('NATIVE_IMAGE_OUTPUT_INVALID'); }
  finally {
    if (fd !== undefined) fs.closeSync(fd);
    process.chdir(previous);
  }
}

function nativeRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('NATIVE_SCOPE_INVALID');
  const { target, inScope, outOfScope = [], acceptanceContract, mutationBoundary } = scope;
  if (![target, acceptanceContract, mutationBoundary].every(x => typeof x === 'string' && x.trim()) ||
      !Array.isArray(inScope) || inScope.length === 0 || !inScope.every(x => typeof x === 'string' && x.trim()) ||
      !Array.isArray(outOfScope) || !outOfScope.every(x => typeof x === 'string' && x.trim())) {
    throw new Error('NATIVE_SCOPE_INVALID');
  }
  return { target, inScope: [...inScope], outOfScope: [...outOfScope], acceptanceContract, mutationBoundary };
}

export function planNewRun(projectDir, definition) {
  const source = inspectNativeProject(projectDir);
  const pipeline = getPipeline(definition?.pipeline);
  const scope = normalizeScope(definition?.scope);
  const runId = nativeRunId();
  const run = {
    schemaVersion: 1, runId, projectId: source.manifest.id,
    pipeline: pipeline.id, pipelineVersion: pipeline.version, scope,
    source, createdAt: new Date().toISOString(),
  };
  return { status: 'READY', kind: 'NATIVE_RUN_START', project: source.project, source,
    run, fingerprint: sha256(serial(run)), writes: [`.ludory/ai/runs/${runId}/`], conflicts: [] };
}

export function commitNewRun(plan) {
  if (!plan || plan.status !== 'READY' || plan.kind !== 'NATIVE_RUN_START' ||
      sha256(serial(plan.run)) !== plan.fingerprint || plan.project !== plan.source?.project ||
      plan.run?.source?.project !== plan.project ||
      plan.run?.projectId !== plan.source?.manifest?.id) throw new Error('NATIVE_STALE_RUN_PLAN');
  const integrity = verifyNativeSource(plan.source);
  if (!integrity.ok) throw new Error(`NATIVE_SOURCE_STALE: ${integrity.code}`);
  return withLock(plan.project, plan.source, () => {
    const again = verifyNativeSource(plan.source);
    if (!again.ok) throw new Error(`NATIVE_SOURCE_STALE: ${again.code}`);
    // Never adopt a run directory created by another actor, even if empty.
    try { fs.mkdirSync(plan.run.runId, { mode: 0o700 }); }
    catch { throw new Error('NATIVE_RUN_CONFLICT: run already exists'); }
    withinDirectory(plan.run.runId, false, () => {
      const raw = serial(plan.run);
      const runFd = fs.openSync('run.json', EXCLUSIVE, 0o600);
      try { fs.writeFileSync(runFd, raw); } finally { fs.closeSync(runFd); }
      fs.mkdirSync('events', { mode: 0o700 });
      // Readers never treat a partially created directory as a committed run.
      const commitFd = fs.openSync('commit.json', EXCLUSIVE, 0o600);
      try { fs.writeFileSync(commitFd, serial({
        schemaVersion: 1, runId: plan.run.runId, runSha256: sha256(raw),
      })); } finally { fs.closeSync(commitFd); }
    });
    return readNativeRun(plan.project, plan.run.runId);
  });
}

function activeRunIds(project) {
  if (!fs.existsSync(path.join(project, '.ludory', 'ai', 'runs'))) throw new Error('NATIVE_NO_RUN');
  const { runs } = storage(project);
  return fs.readdirSync(runs, { withFileTypes: true }).filter(x => x.isDirectory() && RUN_ID.test(x.name) &&
    fs.existsSync(path.join(runs, x.name, 'commit.json'))).map(x => x.name).sort();
}

/** Read-only discovery; never chooses one of several active runs implicitly. */
export function listNativeRuns(projectDir) {
  const project = inspectNativeProject(projectDir).project;
  if (!fs.existsSync(path.join(project, '.ludory', 'ai', 'runs'))) return [];
  return activeRunIds(project).map(id => {
    const current = readNativeRun(project, id);
    return { runId: id, status: current.status, nextStage: current.nextStage,
      pipeline: current.run.pipeline, createdAt: current.run.createdAt };
  });
}

export function readNativeRun(projectDir, runRef = 'latest') {
  const project = canonicalPhysicalDirectory(projectDir);
  let runId = runRef;
  if (!runRef || runRef === 'latest') {
    const runs = activeRunIds(project);
    const active = runs.map(id => readNativeRun(project, id)).filter(x => !x.terminal);
    if (active.length > 1) throw new Error('NATIVE_AMBIGUOUS_ACTIVE_RUNS');
    runId = active.length === 1 ? active[0].run.runId : runs.at(-1);
    if (!runId) throw new Error('NATIVE_NO_RUN');
  }
  const dir = checkedRunDir(project, runId);
  const markerPath = path.join(dir, 'commit.json');
  if (!fs.existsSync(markerPath)) throw new Error('NATIVE_INCOMPLETE_UNCOMMITTED_RUN');
  const { data: marker } = readJsonBounded(markerPath);
  const { data: run, bytes: runBytes } = readJsonBounded(path.join(dir, 'run.json'));
  if (marker.schemaVersion !== 1 || marker.runId !== runId || marker.runSha256 !== sha256(runBytes) ||
      run.schemaVersion !== 1 || run.runId !== runId || run.projectId !== run.source?.manifest?.id ||
      getPipeline(run.pipeline).version !== run.pipelineVersion) throw new Error('NATIVE_INTEGRITY_RUN_HASH');
  // A run is portable with its game. Copying its store into another *live*
  // project is not relocation; the original location must be gone first.
  if (run.source.project !== project && fs.existsSync(run.source.project)) {
    throw new Error('NATIVE_INTEGRITY_PROJECT_BINDING');
  }
  const currentProject = inspectNativeProject(project);
  if (run.projectId !== currentProject.manifest.id) throw new Error('NATIVE_INTEGRITY_PROJECT_BINDING');
  const eventsDir = path.join(dir, 'events');
  safeDir(eventsDir);
  const files = fs.readdirSync(eventsDir).sort();
  if (files.length % 2 !== 0) throw new Error('NATIVE_INTEGRITY_EVENT_RECEIPT_MISSING');
  let precedingHash = marker.runSha256;
  let next = getPipeline(run.pipeline).stages[0].id;
  let status = 'ACTIVE', terminal = null;
  let pendingExecutor = null;
  let pendingRequestSha256 = null;
  let pendingDevRequest = null;
  let pendingImageRequest = null;
  const manualTaskKinds = new Set();
  let reviewPending = false;
  let narrativeDraftPending = false;
  let otherReviewPending = false;
  let pendingNarrativeReview = null;
  let pendingNarrativeRequest = null;
  let priorNarrativeStatus = null;
  let narrativeReview = null;
  let pendingArtReview = null;
  let pendingArtRequest = null;
  let priorArtStatus = null;
  let manualImageImported = false;
  const events = [];
  for (let index = 0; index < files.length / 2; index++) {
    const prefix = String(index + 1).padStart(6, '0');
    if (files[index * 2] !== `${prefix}.commit.json` || files[index * 2 + 1] !== `${prefix}.json`) {
      throw new Error('NATIVE_INTEGRITY_EVENT_SEQUENCE');
    }
    const file = `${prefix}.json`;
    const { data: event, bytes } = readJsonBounded(path.join(eventsDir, file));
    const { data: receipt } = readJsonBounded(path.join(eventsDir, `${prefix}.commit.json`));
    if (receipt.schemaVersion !== 1 || receipt.index !== index + 1 || receipt.eventSha256 !== sha256(bytes)) {
      throw new Error('NATIVE_INTEGRITY_EVENT_HASH');
    }
    if (event.index !== index + 1 || event.prevSha256 !== precedingHash || event.stage !== next || terminal) {
      throw new Error('NATIVE_INTEGRITY_EVENT_CHAIN');
    }
    if (pendingNarrativeReview && event.kind !== 'NARRATIVE_REVIEW_RESULT') {
      throw new Error('NATIVE_INTEGRITY_REVIEW_PENDING');
    }
    if (pendingArtReview && event.kind !== 'ART_REVIEW_RESULT') {
      throw new Error('NATIVE_INTEGRITY_ART_REVIEW_PENDING');
    }
    if (event.kind === 'CHECKPOINT') {
      if (pendingExecutor) throw new Error('NATIVE_INTEGRITY_EXECUTOR_PENDING_RESULT');
      // Historical checkpoints stay readable; new narrative receipts must never approve an obsolete draft.
      if (event.outcome === 'CONTINUE' && narrativeReview &&
          !reviewedEpisodeIsCurrent({ events, narrativeReview })) {
        throw new Error('NATIVE_INTEGRITY_REVIEW_DRAFT_MISMATCH');
      }
      if (!Array.isArray(event.artifacts)) throw new Error('NATIVE_INTEGRITY_EVENT_ARTIFACTS');
      for (const artifact of event.artifacts) {
        // Hashes describe bytes at checkpoint time, not an eternal promise
        // that the mutable working copy will still contain the same bytes.
        if (!artifact || typeof artifact.path !== 'string' || !artifact.path ||
            !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
            !Number.isSafeInteger(artifact.size) || artifact.size < 0) {
          throw new Error('NATIVE_INTEGRITY_EVENT_ARTIFACTS');
        }
      }
      const transition = checkTransition(run.pipeline, event.stage, event.outcome, { hasEvidence: event.artifacts.length > 0 });
      if (!transition.ok) throw new Error(`NATIVE_INTEGRITY_INVALID_TRANSITION: ${transition.code}`);
      next = transition.nextStage;
      terminal = transition.terminal;
      status = terminal ?? 'ACTIVE';
    } else if (event.kind === 'ACTION_REQUESTED') {
      if (['WAITING_FOR_EVIDENCE', 'EXECUTED_UNVERIFIED'].includes(status) ||
          event.outcome !== null || event.artifacts?.length ||
          (event.executor !== undefined && !['codex', 'web-dev', 'image-gen'].includes(event.executor))) {
        throw new Error('NATIVE_INTEGRITY_DUPLICATE_REQUEST');
      }
      if (event.executor === 'web-dev') {
        try { pendingDevRequest = { ...validateDevRequest(event.request), eventIndex: event.index }; }
        catch { throw new Error('NATIVE_INTEGRITY_DEV_REQUEST'); }
      }
      if (event.executor === 'image-gen') {
        try { pendingImageRequest = { ...validateImageRequest(event.request, { allowArchived: true }), eventIndex: event.index }; }
        catch { throw new Error('NATIVE_INTEGRITY_IMAGE_REQUEST'); }
      }
      status = 'WAITING_FOR_EVIDENCE';
      pendingExecutor = event.executor ?? null;
      pendingRequestSha256 = pendingExecutor ? sha256(bytes) : null;
    } else if (event.kind === 'EXECUTION_RESULT') {
      if (status !== 'WAITING_FOR_EVIDENCE' || !['codex', 'web-dev', 'image-gen'].includes(pendingExecutor) ||
          event.requestSha256 !== pendingRequestSha256 ||
          event.outcome !== null || event.artifacts?.length) {
        throw new Error('NATIVE_INTEGRITY_UNREQUESTED_EXECUTION_RESULT');
      }
      try {
        if (pendingExecutor === 'codex') validateExecutionResult(event.result);
        else if (pendingExecutor === 'web-dev') {
          validateDevResult(event.result, run.runId, pendingDevRequest);
          if (event.result.ok) {
            const file = snapshotArtifact(project, event.result.outputPath);
            if (file.sha256 !== event.result.outputSha256 || file.size !== event.result.outputSize) {
              throw new Error('NATIVE_DEV_OUTPUT_CHANGED');
            }
          }
        }
        else {
          validateImageResult(event.result, run.runId, pendingImageRequest);
          if (event.result.ok) for (const image of event.result.images) verifyStoredImage(project, run.runId, image);
        }
      }
      catch { throw new Error('NATIVE_INTEGRITY_EXECUTION_RESULT'); }
      status = event.result.ok ? 'EXECUTED_UNVERIFIED' : 'EXECUTION_FAILED';
      if (event.result.ok && pendingExecutor === 'web-dev') {
        if (pendingDevRequest.taskKind === 'episode-script') narrativeDraftPending = true;
        else otherReviewPending = true;
      } else if (event.result.ok && pendingExecutor === 'image-gen') otherReviewPending = true;
      reviewPending = otherReviewPending || narrativeDraftPending;
      pendingExecutor = null;
      pendingRequestSha256 = null;
      pendingDevRequest = null;
      pendingImageRequest = null;
    } else if (event.kind === 'DRAFT_IMPORTED') {
      if (pendingExecutor || event.outcome !== null || event.artifacts?.length ||
          manualTaskKinds.has(event.manual?.taskKind)) throw new Error('NATIVE_INTEGRITY_DEV_MANUAL_IMPORT');
      try {
        const imported = validateManualImport(event.manual, runId, event.index);
        const file = snapshotArtifact(project, imported.output.outputPath);
        if (file.sha256 !== imported.output.outputSha256 || file.size !== imported.output.outputSize) {
          throw new Error('NATIVE_MANUAL_DRAFT_CHANGED');
        }
        manualTaskKinds.add(imported.taskKind);
        if (imported.taskKind === 'episode-script') narrativeDraftPending = true;
        else otherReviewPending = true;
        reviewPending = otherReviewPending || narrativeDraftPending;
      } catch { throw new Error('NATIVE_INTEGRITY_DEV_MANUAL_IMPORT'); }
    } else if (event.kind === 'IMAGE_IMPORTED') {
      if (pendingExecutor || event.outcome !== null || event.artifacts?.length || manualImageImported) {
        throw new Error('NATIVE_INTEGRITY_IMAGE_IMPORT');
      }
      try {
        const imp = validateImageManualImport(event.manual, runId, event.index, { allowArchived: true });
        verifyStoredImage(project, runId, imp.output);
        manualImageImported = true;
        otherReviewPending = true;
        reviewPending = true;
      } catch { throw new Error('NATIVE_INTEGRITY_IMAGE_IMPORT'); }
    } else if (event.kind === 'NARRATIVE_REVIEW_REQUESTED') {
      if (pendingExecutor || pendingNarrativeReview || narrativeReview || !narrativeDraftPending ||
          event.outcome !== null || event.artifacts?.length) {
        throw new Error('NATIVE_INTEGRITY_REVIEW_REQUEST');
      }
      try {
        validateNarrativeRequest(event.review, episodeDraftOfRun({ events }));
        const draft = snapshotArtifact(project, event.review.draft.path);
        if (draft.sha256 !== event.review.draft.sha256 || draft.size !== event.review.draft.size) {
          throw new Error('NATIVE_REVIEW_DRAFT_STALE');
        }
      } catch { throw new Error('NATIVE_INTEGRITY_REVIEW_REQUEST'); }
      pendingNarrativeReview = sha256(bytes);
      pendingNarrativeRequest = event.review;
      priorNarrativeStatus = status;
      status = 'NARRATIVE_REVIEW_PENDING';
    } else if (event.kind === 'NARRATIVE_REVIEW_RESULT') {
      if (!pendingNarrativeReview || event.reviewRequestSha256 !== pendingNarrativeReview ||
          event.outcome !== null || event.artifacts?.length) {
        throw new Error('NATIVE_INTEGRITY_REVIEW_RESULT');
      }
      try {
        const draftText = readBoundText(project, pendingNarrativeRequest.draft);
        const validated = validateNarrativeResult(event.reviewResult, pendingNarrativeRequest, draftText);
        narrativeReview = validated.report;
      } catch { throw new Error('NATIVE_INTEGRITY_REVIEW_RESULT'); }
      pendingNarrativeReview = null;
      pendingNarrativeRequest = null;
      status = priorNarrativeStatus;
      priorNarrativeStatus = null;
      narrativeDraftPending = narrativeReview.verdict !== 'ACCEPT';
      reviewPending = otherReviewPending || narrativeDraftPending;
    } else if (event.kind === 'ART_REVIEW_REQUESTED') {
      if (pendingExecutor || pendingArtReview || pendingNarrativeReview ||
          !['ACTIVE', 'EXECUTION_FAILED'].includes(status) ||
          event.outcome !== null || event.artifacts?.length) {
        throw new Error('NATIVE_INTEGRITY_ART_REVIEW_REQUEST');
      }
      try { validateArtRequest(event.artReview, { events }); }
      catch { throw new Error('NATIVE_INTEGRITY_ART_REVIEW_REQUEST'); }
      pendingArtReview = sha256(bytes);
      pendingArtRequest = event.artReview;
      priorArtStatus = status;
      status = 'ART_REVIEW_PENDING';
    } else if (event.kind === 'ART_REVIEW_RESULT') {
      if (!pendingArtReview || event.artRequestSha256 !== pendingArtReview ||
          event.outcome !== null || event.artifacts?.length) {
        throw new Error('NATIVE_INTEGRITY_ART_REVIEW_RESULT');
      }
      try {
        validateArtResult(event.artReviewResult);
        if (event.artReviewResult.code === 'ART_REVIEW_OBSERVED') {
          const witnessed = readArtReceiptEntries(project, runId, run.projectId).filter(item =>
            item.artRequestSha256 === pendingArtReview &&
            sha256(serial(item)) === event.artReviewResult.receiptSha256);
          if (witnessed.length !== 1) throw new Error('ART_REVIEW_RECEIPT_MISSING');
        }
      }
      catch { throw new Error('NATIVE_INTEGRITY_ART_REVIEW_RESULT'); }
      pendingArtReview = null;
      pendingArtRequest = null;
      status = priorArtStatus;
      priorArtStatus = null;
    } else throw new Error('NATIVE_INTEGRITY_EVENT_KIND');
    precedingHash = sha256(bytes);
    events.push(event);
  }
  return { run, events, status, nextStage: next, terminal, headSha256: precedingHash,
    pendingExecutor, pendingRequestSha256, reviewPending, narrativeDraftPending, otherReviewPending,
    pendingNarrativeReview, pendingNarrativeRequest, narrativeReview,
    pendingArtReview, pendingArtRequest,
    integrity: { ok: true, issues: [] } };
}

/** Internal art-ledger parser: does not call readNativeRun, so witnessed native results
 * can verify their receipt without recursive integrity reads. */
function readArtReceiptEntries(project, runId, projectId) {
  const root = checkedRunDir(project, runId);
  const directory = path.join(root, 'reviews');
  try { fs.lstatSync(directory); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('ART_REVIEW_INTEGRITY_DIRECTORY');
  }
  safeDir(directory);
  const files = fs.readdirSync(directory).sort();
  if (files.length % 2) throw new Error('ART_REVIEW_INTEGRITY_SEQUENCE');
  const history = [];
  let previous = null;
  for (let i = 1; i <= files.length / 2; i++) {
    const prefix = String(i).padStart(6, '0');
    if (files[(i - 1) * 2] !== `${prefix}.commit.json` ||
        files[(i - 1) * 2 + 1] !== `${prefix}.json`) throw new Error('ART_REVIEW_INTEGRITY_SEQUENCE');
    let receipt, marker, bytes;
    try {
      ({ data: receipt, bytes } = readJsonBounded(path.join(directory, `${prefix}.json`)));
      ({ data: marker } = readJsonBounded(path.join(directory, `${prefix}.commit.json`)));
    } catch { throw new Error('ART_REVIEW_INTEGRITY_FILE'); }
    if (marker.schemaVersion !== 1 || marker.index !== i || marker.sha256 !== sha256(bytes) ||
        receipt.schemaVersion !== 1 || receipt.index !== i ||
        receipt.projectId !== projectId || receipt.runId !== runId ||
        !/^[a-f0-9]{64}$/.test(receipt.runHeadSha256 ?? '') ||
        receipt.prevSha256 !== (previous ?? receipt.runHeadSha256) ||
        receipt.provenance !== 'HOST_OBSERVED' || receipt.modelObserved !== 'gpt-6-sol' ||
        receipt.visualInputObserved !== true ||
        (receipt.artRequestSha256 !== undefined &&
          (receipt.artRequestSha256 !== receipt.runHeadSha256 ||
            history.some(item => item.artRequestSha256 === receipt.artRequestSha256))) ||
        receipt.hostObservation?.protocolVersion !== 2 || receipt.hostObservation?.source !== 'browser-ui' ||
        receipt.hostObservation?.traceId !== `art-${runId}` ||
        receipt.hostObservation?.selectedModel !== 'gpt-6-sol' || receipt.hostObservation?.reasoning !== 'high' ||
        receipt.hostObservation?.image?.ref !== receipt.image?.ref ||
        receipt.hostObservation?.image?.sha256 !== receipt.image?.sha256 ||
        receipt.hostObservation?.image?.bytes !== receipt.image?.size ||
        receipt.hostObservation?.upload?.creationRequestObserved !== true ||
        receipt.hostObservation?.upload?.processingRequestObserved !== true ||
        !['process_upload_stream', 'claim_and_finish'].includes(receipt.hostObservation?.upload?.processingRequestKind) ||
        receipt.hostObservation?.upload?.processingEvent !== 'file.processing.completed' ||
        receipt.hostObservation?.upload?.processingCompleted !== true ||
        receipt.hostObservation?.upload?.visibleAttachmentChip !== true ||
         !['PASS_ART', 'REWORK', 'BLOCKED'].includes(receipt.verdict) ||
        !['ART_REPORT_STRUCTURED', 'ART_IMAGE_NOT_VISIBLE', 'ART_REPORT_INVALID'].includes(receipt.reasonCode) ||
        !receipt.image || !/^[a-f0-9]{64}$/.test(receipt.image.sha256 ?? '') ||
        !receipt.brief || !/^[a-f0-9]{64}$/.test(receipt.brief.sha256 ?? '') ||
        !Array.isArray(receipt.sources) || receipt.sources.length !== 4 ||
        receipt.sources.map(x => x.role).join(',') !== 'scene,characters,location,style' ||
        receipt.sources.some(x => !/^[a-f0-9]{64}$/.test(x.sha256 ?? '')) ||
        !Array.isArray(receipt.findings) || typeof receipt.summary !== 'string') {
      throw new Error('ART_REVIEW_INTEGRITY_RECEIPT');
    }
    previous = sha256(bytes);
    history.push(receipt);
  }
  return history;
}

/** A separate, append-only artistic ledger. Review receipts do not advance workflow stages. */
export function readNativeArtReviews(projectDir, runRef) {
  const project = canonicalPhysicalDirectory(projectDir);
  const current = readNativeRun(project, runRef);
  return readArtReceiptEntries(project, current.run.runId, current.run.projectId);
}

/** Atomically commit a witnessed review; refuse stale inputs and foreign filesystem entries. */
export function recordNativeArtReview(projectDir, runRef, expectedHeadSha256, report) {
  const source = inspectNativeProject(projectDir);
  if (!report || report.provenance !== 'HOST_OBSERVED' ||
      report.modelObserved !== 'gpt-6-sol' || report.visualInputObserved !== true ||
      report.hostObservation?.protocolVersion !== 2 || report.hostObservation?.source !== 'browser-ui' ||
      report.hostObservation?.traceId !== `art-${runRef}` ||
      report.hostObservation?.selectedModel !== 'gpt-6-sol' || report.hostObservation?.reasoning !== 'high' ||
      report.hostObservation?.image?.ref !== report.image?.ref ||
      report.hostObservation?.image?.sha256 !== report.image?.sha256 ||
      report.hostObservation?.image?.bytes !== report.image?.size ||
      report.hostObservation?.upload?.creationRequestObserved !== true ||
      report.hostObservation?.upload?.processingRequestObserved !== true ||
      !['process_upload_stream', 'claim_and_finish'].includes(report.hostObservation?.upload?.processingRequestKind) ||
      report.hostObservation?.upload?.processingEvent !== 'file.processing.completed' ||
      report.hostObservation?.upload?.processingCompleted !== true ||
      report.hostObservation?.upload?.visibleAttachmentChip !== true ||
      !['PASS_ART', 'REWORK', 'BLOCKED'].includes(report.verdict) ||
      !['ART_REPORT_STRUCTURED', 'ART_IMAGE_NOT_VISIBLE', 'ART_REPORT_INVALID'].includes(report.reasonCode) ||
      typeof report.summary !== 'string' || report.summary.length > 3000 ||
      !Array.isArray(report.findings) || report.findings.length > 12 ||
      !report.image || !report.brief || !Array.isArray(report.sources) ||
      report.sources.length !== 4 ||
      !/^[a-f0-9]{64}$/.test(report.artRequestSha256 ?? '')) throw new Error('ART_REVIEW_INVALID');
  return withLock(source.project, source, () => {
    const current = readNativeRun(source.project, runRef);
    if (current.headSha256 !== expectedHeadSha256 || current.pendingExecutor || current.terminal ||
        current.status !== 'ART_REVIEW_PENDING' ||
        current.pendingArtReview !== report.artRequestSha256 ||
        JSON.stringify(current.pendingArtRequest) !== JSON.stringify({
          image: report.image, brief: report.brief, sources: report.sources,
          modelObserved: 'gpt-6-sol',
        })) throw new Error('ART_REVIEW_STALE');
    const imported = current.events.find(event => event.kind === 'IMAGE_IMPORTED')?.manual;
    if (!imported || imported.output.outputPath !== report.image.path ||
        imported.output.outputSha256 !== report.image.sha256 ||
        imported.output.outputSize !== report.image.size ||
        imported.output.mediaType !== report.image.mediaType ||
        JSON.stringify(imported.brief) !== JSON.stringify(report.brief)) throw new Error('ART_REVIEW_STALE');
    verifyStoredImage(source.project, current.run.runId, imported.output);
    verifyDraftInputs(source.project, [report.brief, ...report.sources]);
    const history = readNativeArtReviews(source.project, current.run.runId);
    if (history.some(item => item.artRequestSha256 === report.artRequestSha256)) {
      throw new Error('ART_REVIEW_REQUEST_ALREADY_RECORDED');
    }
    if (history.some(item => item.verdict === 'PASS_ART')) throw new Error('ART_ALREADY_ACCEPTED');
    if (history.filter(item => item.verdict === 'REWORK').length >= 2) throw new Error('ART_REWORK_LIMIT');
    if (history.some(item => JSON.stringify(item.image) !== JSON.stringify(report.image) ||
        JSON.stringify(item.brief) !== JSON.stringify(report.brief) ||
        JSON.stringify(item.sources) !== JSON.stringify(report.sources))) {
      throw new Error('ART_REVIEW_CONTEXT_CHANGED');
    }
    const index = history.length + 1;
    const receipt = { schemaVersion: 1, index, projectId: current.run.projectId,
      runId: current.run.runId, runHeadSha256: expectedHeadSha256,
      prevSha256: history.length ? sha256(serial(history.at(-1))) : expectedHeadSha256,
      at: new Date().toISOString(), provenance: 'HOST_OBSERVED', modelObserved: 'gpt-6-sol',
      visualInputObserved: true, artRequestSha256: report.artRequestSha256,
      hostObservation: report.hostObservation, image: report.image, brief: report.brief,
      sources: report.sources, verdict: report.verdict, reasonCode: report.reasonCode,
      summary: report.summary, findings: report.findings };
    checkedRunDir(source.project, current.run.runId);
    withinDirectory(current.run.runId, false, () => withinDirectory('reviews', true, () => {
      if (fs.readdirSync('.').length !== index * 2 - 2) throw new Error('ART_REVIEW_INTEGRITY_SEQUENCE');
      const prefix = String(index).padStart(6, '0');
      const bytes = serial(receipt);
      const marker = serial({ schemaVersion: 1, index, sha256: sha256(bytes) });
      const fd = fs.openSync(`${prefix}.json`, EXCLUSIVE, 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const committed = fs.openSync(`${prefix}.commit.json`, EXCLUSIVE, 0o600);
      try { fs.writeFileSync(committed, marker); fs.fsyncSync(committed); }
      finally { fs.closeSync(committed); }
      flushNativeDirectory();
    }));
    const verified = readNativeArtReviews(source.project, current.run.runId);
    if (verified.length !== index) throw new Error('ART_REVIEW_INTEGRITY_SEQUENCE');
    return { ...receipt, receiptPath: `.ludory/ai/runs/${current.run.runId}/reviews/${String(index).padStart(6, '0')}.json`,
      receiptSha256: sha256(serial(receipt)) };
  });
}

export function planNativeEvent(projectDir, runRef, input) {
  const project = path.resolve(projectDir);
  const current = readNativeRun(project, runRef);
  const source = inspectNativeProject(project);
  if (current.terminal) throw new Error('NATIVE_TERMINAL_RUN');
  if (!input || !['CHECKPOINT', 'ACTION_REQUESTED', 'EXECUTION_RESULT', 'DRAFT_IMPORTED',
    'IMAGE_IMPORTED', 'NARRATIVE_REVIEW_REQUESTED', 'NARRATIVE_REVIEW_RESULT',
    'ART_REVIEW_REQUESTED', 'ART_REVIEW_RESULT'].includes(input.kind)) {
    throw new Error('NATIVE_EVENT_KIND_INVALID');
  }
  if (input.stage !== current.nextStage) throw new Error(`NATIVE_INVALID_STAGE: expected ${current.nextStage}`);
  let artifacts = [];
  let outcome = null;
  let result = null;
  let manual = null;
  if (current.pendingNarrativeReview && input.kind !== 'NARRATIVE_REVIEW_RESULT') {
    throw new Error('NATIVE_NARRATIVE_REVIEW_PENDING');
  }
  if (current.pendingArtReview && input.kind !== 'ART_REVIEW_RESULT') {
    throw new Error('NATIVE_ART_REVIEW_PENDING');
  }
  if (input.kind === 'CHECKPOINT') {
    if (current.pendingExecutor || current.pendingNarrativeReview) throw new Error('NATIVE_EXECUTOR_PENDING_RESULT');
    if ((input.outcome ?? 'CONTINUE') === 'CONTINUE' && !reviewedEpisodeIsCurrent(current)) {
      throw new Error('NATIVE_NARRATIVE_REVIEW_REQUIRED');
    }
    if (!Array.isArray(input.artifacts)) throw new Error('NATIVE_ARTIFACTS_INVALID');
    artifacts = input.artifacts.map(relative => snapshotArtifact(project, relative));
    outcome = input.outcome ?? 'CONTINUE';
    const decision = checkTransition(current.run.pipeline, input.stage, outcome, { hasEvidence: artifacts.length > 0 });
    if (!decision.ok) throw new Error(`NATIVE_CHECKPOINT_BLOCKED: ${decision.code}`);
  } else if (input.kind === 'EXECUTION_RESULT') {
    if (current.status !== 'WAITING_FOR_EVIDENCE' || !['codex', 'web-dev', 'image-gen'].includes(current.pendingExecutor)) {
      throw new Error('NATIVE_EXECUTION_RESULT_WITHOUT_REQUEST');
    }
    result = current.pendingExecutor === 'codex' ? validateExecutionResult(input.result)
      : current.pendingExecutor === 'web-dev' ? validateDevResult(input.result, current.run.runId, {
        ...current.events.at(-1).request, eventIndex: current.events.at(-1).index,
      }) : validateImageResult(input.result, current.run.runId, {
        ...current.events.at(-1).request, eventIndex: current.events.at(-1).index,
      });
    if (current.pendingExecutor === 'web-dev' && result.ok) {
      const file = snapshotArtifact(project, result.outputPath);
      if (file.sha256 !== result.outputSha256 || file.size !== result.outputSize) {
        throw new Error('NATIVE_DEV_OUTPUT_CHANGED');
      }
    }
    if (current.pendingExecutor === 'image-gen' && result.ok) for (const image of result.images) {
      verifyStoredImage(project, current.run.runId, image);
    }
  } else if (input.kind === 'NARRATIVE_REVIEW_REQUESTED') {
    if (current.pendingExecutor || current.pendingNarrativeReview || current.narrativeReview ||
        !current.narrativeDraftPending) throw new Error('NATIVE_REVIEW_REQUEST_ALREADY_PENDING');
    validateNarrativeRequest(input.review, episodeDraftOfRun(current));
    verifyNarrativeInputs(project, input.review);
  } else if (input.kind === 'NARRATIVE_REVIEW_RESULT') {
    if (!current.pendingNarrativeReview || input.reviewRequestSha256 !== current.pendingNarrativeReview) {
      throw new Error('NATIVE_REVIEW_RESULT_WITHOUT_REQUEST');
    }
    validateNarrativeResult(input.reviewResult, current.pendingNarrativeRequest,
      readBoundText(project, current.pendingNarrativeRequest.draft));
  } else if (input.kind === 'ART_REVIEW_REQUESTED') {
    if (current.pendingExecutor || current.pendingNarrativeReview ||
        !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status)) {
      throw new Error('NATIVE_ART_REVIEW_ALREADY_PENDING');
    }
    validateArtRequest(input.artReview, current);
    const imported = current.events.find(event => event.kind === 'IMAGE_IMPORTED').manual;
    verifyStoredImage(project, current.run.runId, imported.output);
    verifyDraftInputs(project, [input.artReview.brief, ...input.artReview.sources]);
  } else if (input.kind === 'ART_REVIEW_RESULT') {
    if (!current.pendingArtReview || input.artRequestSha256 !== current.pendingArtReview) {
      throw new Error('NATIVE_ART_REVIEW_RESULT_WITHOUT_REQUEST');
    }
    validateArtResult(input.artReviewResult);
    verifyArtResultReceipt(project, current.run.runId, current.pendingArtReview, input.artReviewResult);
  } else if (input.kind === 'IMAGE_IMPORTED') {
    if (current.pendingExecutor || !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status) ||
        current.events.some(event => event.kind === 'IMAGE_IMPORTED')) throw new Error('NATIVE_IMAGE_IMPORT_DUPLICATE');
    manual = validateImageManualImport(input.manual, current.run.runId, current.events.length + 1);
    verifyStoredImage(project, current.run.runId, manual.output);
  } else if (input.kind === 'DRAFT_IMPORTED') {
    if (input.manual?.taskKind === 'episode-script' && episodeDraftOfRun(current)) {
      throw new Error('NATIVE_NARRATIVE_DRAFT_ALREADY_EXISTS');
    }
    if (current.pendingExecutor || !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status) ||
        current.events.some(event => event.kind === 'DRAFT_IMPORTED' &&
          event.manual.taskKind === input.manual?.taskKind)) throw new Error('NATIVE_DEV_MANUAL_IMPORT_DUPLICATE');
    manual = validateManualImport(input.manual, current.run.runId, current.events.length + 1);
    const file = snapshotArtifact(project, manual.output.outputPath);
    if (file.sha256 !== manual.output.outputSha256 || file.size !== manual.output.outputSize) {
      throw new Error('NATIVE_DEV_MANUAL_IMPORT_STALE');
    }
  } else {
    if (input.executor === 'web-dev' && input.request?.taskKind === 'episode-script' &&
        episodeDraftOfRun(current)) throw new Error('NATIVE_NARRATIVE_DRAFT_ALREADY_EXISTS');
    if (['WAITING_FOR_EVIDENCE', 'EXECUTED_UNVERIFIED'].includes(current.status)) {
      throw new Error('NATIVE_ACTION_ALREADY_REQUESTED');
    }
    if (input.executor !== undefined && !['codex', 'web-dev', 'image-gen'].includes(input.executor)) {
      throw new Error('NATIVE_EXECUTOR_UNSUPPORTED');
    }
  }
  const event = { schemaVersion: 1, index: current.events.length + 1, prevSha256: current.headSha256,
    kind: input.kind, stage: input.stage, outcome, artifacts, at: new Date().toISOString(),
    sourceAtCheckpoint: { gitHead: source.gitHead, manifestSha256: source.manifestSha256 } };
  if (result) event.result = result;
  if (manual) event.manual = manual;
  if (input.kind === 'ACTION_REQUESTED' && ['codex', 'web-dev', 'image-gen'].includes(input.executor)) {
    event.executor = input.executor;
    if (input.executor === 'web-dev') event.request = validateDevRequest(input.request);
    if (input.executor === 'image-gen') event.request = validateImageRequest(input.request);
  }
  if (result) event.requestSha256 = current.pendingRequestSha256;
  if (input.kind === 'NARRATIVE_REVIEW_REQUESTED') event.review = input.review;
  if (input.kind === 'NARRATIVE_REVIEW_RESULT') {
    event.reviewResult = input.reviewResult;
    event.reviewRequestSha256 = current.pendingNarrativeReview;
  }
  if (input.kind === 'ART_REVIEW_REQUESTED') event.artReview = input.artReview;
  if (input.kind === 'ART_REVIEW_RESULT') {
    event.artReviewResult = input.artReviewResult;
    event.artRequestSha256 = current.pendingArtReview;
  }
  return { status: 'READY', kind: 'NATIVE_EVENT', project, runId: current.run.runId,
    source, expectedHeadSha256: current.headSha256, event,
    fingerprint: sha256(serial(event)), writes: [
      `.ludory/ai/runs/${current.run.runId}/events/${String(event.index).padStart(6, '0')}.json`,
      `.ludory/ai/runs/${current.run.runId}/events/${String(event.index).padStart(6, '0')}.commit.json`,
    ] };
}

export function commitNativeEvent(plan) {
  if (!plan || plan.kind !== 'NATIVE_EVENT' || plan.status !== 'READY' ||
      sha256(serial(plan.event)) !== plan.fingerprint ||
      plan.project !== plan.source?.project) throw new Error('NATIVE_STALE_EVENT_PLAN');
  // A handcrafted plan must not create events from a retired producer, even if
  // the same schema remains readable while replaying signed historical runs.
  if (plan.event.kind === 'ACTION_REQUESTED' && plan.event.executor === 'image-gen') {
    validateImageRequest(plan.event.request);
  }
  if (plan.event.kind === 'IMAGE_IMPORTED') {
    validateImageManualImport(plan.event.manual, plan.runId, plan.event.index);
  }
  const result = verifyNativeSource(plan.source);
  if (!result.ok) throw new Error(`NATIVE_SOURCE_STALE: ${result.code}`);
  return withLock(plan.project, plan.source, () => {
    const current = readNativeRun(plan.project, plan.runId);
    if (current.headSha256 !== plan.expectedHeadSha256 ||
        current.nextStage !== plan.event.stage || plan.event.index !== current.events.length + 1 ||
        (current.pendingNarrativeReview && plan.event.kind !== 'NARRATIVE_REVIEW_RESULT') ||
        (current.pendingArtReview && plan.event.kind !== 'ART_REVIEW_RESULT') ||
        (plan.event.kind === 'ACTION_REQUESTED' && ['WAITING_FOR_EVIDENCE', 'EXECUTED_UNVERIFIED'].includes(current.status)) ||
        (plan.event.kind === 'ACTION_REQUESTED' && plan.event.executor === 'web-dev' &&
          plan.event.request?.taskKind === 'episode-script' && !!episodeDraftOfRun(current)) ||
        (plan.event.kind === 'CHECKPOINT' && (current.pendingExecutor || current.pendingNarrativeReview ||
          (plan.event.outcome === 'CONTINUE' && !reviewedEpisodeIsCurrent(current)))) ||
        (plan.event.kind === 'DRAFT_IMPORTED' && plan.event.manual?.taskKind === 'episode-script' &&
          !!episodeDraftOfRun(current)) ||
        (plan.event.kind === 'EXECUTION_RESULT' && (current.status !== 'WAITING_FOR_EVIDENCE' ||
          !['codex', 'web-dev', 'image-gen'].includes(current.pendingExecutor) ||
          plan.event.requestSha256 !== current.pendingRequestSha256)) ||
        (plan.event.kind === 'NARRATIVE_REVIEW_RESULT' &&
          plan.event.reviewRequestSha256 !== current.pendingNarrativeReview) ||
        (plan.event.kind === 'ART_REVIEW_RESULT' &&
          plan.event.artRequestSha256 !== current.pendingArtReview)) {
      throw new Error('NATIVE_STALE_EVENT_CONFLICT');
    }
    const fresh = verifyNativeSource(plan.source);
    if (!fresh.ok) throw new Error(`NATIVE_SOURCE_STALE: ${fresh.code}`);
    if (plan.event.kind === 'EXECUTION_RESULT' && current.pendingExecutor === 'web-dev') {
      validateDevResult(plan.event.result, current.run.runId, {
        ...current.events.at(-1).request, eventIndex: current.events.at(-1).index,
      });
      if (plan.event.result.ok) {
        verifyDraftInputs(plan.project, [current.events.at(-1).request.brief,
          ...current.events.at(-1).request.sources]);
        const item = snapshotArtifact(plan.project, plan.event.result.outputPath);
        if (item.sha256 !== plan.event.result.outputSha256 || item.size !== plan.event.result.outputSize) {
          throw new Error('NATIVE_STALE_ARTIFACT_HASH');
        }
      }
    }
    if (plan.event.kind === 'EXECUTION_RESULT' && current.pendingExecutor === 'image-gen') {
      const request = { ...current.events.at(-1).request, eventIndex: current.events.at(-1).index };
      const result = validateImageResult(plan.event.result, current.run.runId, request);
      if (result.ok) {
        verifyDraftInputs(plan.project, [request.brief]);
        for (const image of result.images) verifyStoredImage(plan.project, current.run.runId, image);
      }
    }
    if (plan.event.kind === 'DRAFT_IMPORTED') {
      if (current.pendingExecutor || !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status) ||
          current.events.some(event => event.kind === 'DRAFT_IMPORTED' &&
            event.manual.taskKind === plan.event.manual?.taskKind)) throw new Error('NATIVE_DEV_MANUAL_IMPORT_DUPLICATE');
      const item = validateManualImport(plan.event.manual, current.run.runId, plan.event.index);
      verifyDraftInputs(plan.project, [item.brief, item.source]);
      const snapshot = snapshotArtifact(plan.project, item.output.outputPath);
      if (snapshot.sha256 !== item.output.outputSha256 || snapshot.size !== item.output.outputSize) {
        throw new Error('NATIVE_STALE_ARTIFACT_HASH');
      }
    }
    if (plan.event.kind === 'IMAGE_IMPORTED') {
      if (current.pendingExecutor || !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status) ||
          current.events.some(event => event.kind === 'IMAGE_IMPORTED')) throw new Error('NATIVE_IMAGE_IMPORT_DUPLICATE');
      const imp = validateImageManualImport(plan.event.manual, current.run.runId, plan.event.index);
      verifyDraftInputs(plan.project, [imp.brief, imp.source]);
      verifyStoredImage(plan.project, current.run.runId, imp.output);
    }
    if (plan.event.kind === 'ACTION_REQUESTED' && plan.event.executor === 'web-dev') {
      verifyDraftInputs(plan.project, [plan.event.request.brief, ...plan.event.request.sources]);
    }
    if (plan.event.kind === 'ACTION_REQUESTED' && plan.event.executor === 'image-gen') {
      verifyDraftInputs(plan.project, [plan.event.request.brief]);
    }
    if (plan.event.kind === 'NARRATIVE_REVIEW_REQUESTED') {
      if (current.pendingExecutor || current.pendingNarrativeReview || current.narrativeReview ||
          !current.narrativeDraftPending) throw new Error('NATIVE_REVIEW_REQUEST_ALREADY_PENDING');
      validateNarrativeRequest(plan.event.review, episodeDraftOfRun(current));
      verifyNarrativeInputs(plan.project, plan.event.review);
    }
    if (plan.event.kind === 'NARRATIVE_REVIEW_RESULT') {
      if (!current.pendingNarrativeReview) throw new Error('NATIVE_REVIEW_RESULT_WITHOUT_REQUEST');
      validateNarrativeResult(plan.event.reviewResult, current.pendingNarrativeRequest,
        readBoundText(plan.project, current.pendingNarrativeRequest.draft));
    }
    if (plan.event.kind === 'ART_REVIEW_REQUESTED') {
      if (current.pendingExecutor || current.pendingNarrativeReview || current.pendingArtReview ||
          !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status)) {
        throw new Error('NATIVE_ART_REVIEW_ALREADY_PENDING');
      }
      validateArtRequest(plan.event.artReview, current);
      const imported = current.events.find(event => event.kind === 'IMAGE_IMPORTED').manual;
      verifyStoredImage(plan.project, current.run.runId, imported.output);
      verifyDraftInputs(plan.project, [plan.event.artReview.brief, ...plan.event.artReview.sources]);
    }
    if (plan.event.kind === 'ART_REVIEW_RESULT') {
      if (!current.pendingArtReview) throw new Error('NATIVE_ART_REVIEW_RESULT_WITHOUT_REQUEST');
      validateArtResult(plan.event.artReviewResult);
      if (plan.event.artReviewResult.code === 'ART_REVIEW_INTERRUPTED' &&
          readNativeArtReviews(plan.project, current.run.runId).some(item =>
            item.artRequestSha256 === current.pendingArtReview)) {
        throw new Error('NATIVE_ART_REVIEW_RESULT_STALE');
      }
      verifyArtResultReceipt(plan.project, current.run.runId, current.pendingArtReview,
        plan.event.artReviewResult);
    }
    for (const artifact of plan.event.artifacts) {
      const snapshot = snapshotArtifact(plan.project, artifact.path);
      if (snapshot.sha256 !== artifact.sha256 || snapshot.size !== artifact.size) {
        throw new Error('NATIVE_STALE_ARTIFACT_HASH');
      }
    }
    checkedRunDir(plan.project, plan.runId);
    withinDirectory(plan.runId, false, () => withinDirectory('events', false, () => {
      const prefix = String(plan.event.index).padStart(6, '0');
      const eventBytes = serial(plan.event);
      const receiptBytes = serial({ schemaVersion: 1, index: plan.event.index, eventSha256: sha256(eventBytes) });
      const tmpEvent = `.pending-${crypto.randomBytes(12).toString('hex')}`;
      const tmpReceipt = `.pending-${crypto.randomBytes(12).toString('hex')}`;
      const durableArtEvent = ['ART_REVIEW_REQUESTED', 'ART_REVIEW_RESULT'].includes(plan.event.kind);
      try {
        const eventFd = fs.openSync(tmpEvent, EXCLUSIVE, 0o600);
        try { fs.writeFileSync(eventFd, eventBytes); if (durableArtEvent) flushNativeFile(eventFd); }
        finally { fs.closeSync(eventFd); }
        const receiptFd = fs.openSync(tmpReceipt, EXCLUSIVE, 0o600);
        try { fs.writeFileSync(receiptFd, receiptBytes); if (durableArtEvent) flushNativeFile(receiptFd); }
        finally { fs.closeSync(receiptFd); }
        fs.linkSync(tmpEvent, `${prefix}.json`);
        // Commit marker published last: an interrupted event is never accepted.
        fs.linkSync(tmpReceipt, `${prefix}.commit.json`);
        // Persist both final names AND the removal of temporary aliases in one
        // directory barrier. No paid turn may start while pending names survive.
        fs.unlinkSync(tmpEvent);
        fs.unlinkSync(tmpReceipt);
        if (durableArtEvent) flushNativeDirectory();
      } catch (error) {
        if (error.message === 'NATIVE_STORAGE_DURABILITY_UNVERIFIED') throw error;
        throw new Error('NATIVE_EVENT_CONFLICT');
      }
      finally {
        // Only unique temporary files created by this operation may be removed.
        if (fs.existsSync(tmpEvent)) fs.unlinkSync(tmpEvent);
        if (fs.existsSync(tmpReceipt)) fs.unlinkSync(tmpReceipt);
      }
    }));
    return readNativeRun(plan.project, plan.runId);
  });
}

/** Pin unreviewed generated bytes beneath an already pending DEV request. */
export function commitNativeDraftArtifact(projectDir, runRef, requestSha256, text) {
  if (typeof text !== 'string' || !text.trim() || text.includes('\0') ||
      Buffer.byteLength(text, 'utf8') > 256 * 1024) throw new Error('NATIVE_DEV_DRAFT_INVALID');
  const source = inspectNativeProject(projectDir);
  return withLock(source.project, source, () => {
    const current = readNativeRun(source.project, runRef);
    if (current.pendingExecutor !== 'web-dev' || current.pendingRequestSha256 !== requestSha256) {
      throw new Error('NATIVE_DEV_REQUEST_STALE');
    }
    const file = `draft-${String(current.events.at(-1).index).padStart(6, '0')}.md`;
    const outputPath = `.ludory/ai/runs/${current.run.runId}/drafts/${file}`;
    const bytes = Buffer.from(text, 'utf8');
    checkedRunDir(source.project, current.run.runId);
    withinDirectory(current.run.runId, false, () => withinDirectory('drafts', true, () => {
      const fd = fs.openSync(file, EXCLUSIVE, 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
    }));
    return { outputPath, outputSha256: sha256(bytes), outputSize: bytes.length };
  });
}

/** Copy user-provided text under an anchored run directory without claiming a host origin. */
export function commitNativeManualDraftArtifact(projectDir, runRef, expectedHeadSha256,
  { taskKind, source: inputSnapshot }) {
  if (!DEV_TASKS.has(taskKind) || !inputSnapshot || !inputSnapshot.path) {
    throw new Error('NATIVE_DEV_MANUAL_IMPORT_INVALID');
  }
  const source = inspectNativeProject(projectDir);
  return withLock(source.project, source, () => {
    const current = readNativeRun(source.project, runRef);
    if (current.headSha256 !== expectedHeadSha256 || current.pendingExecutor || current.terminal ||
        !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status) ||
        current.events.some(event => event.kind === 'DRAFT_IMPORTED' && event.manual.taskKind === taskKind)) {
      throw new Error('NATIVE_DEV_MANUAL_IMPORT_STALE');
    }
    const checked = snapshotArtifact(source.project, inputSnapshot.path);
    if (checked.sha256 !== inputSnapshot.sha256 || checked.size !== inputSnapshot.size ||
        checked.size > 256 * 1024) throw new Error('NATIVE_DEV_MANUAL_IMPORT_STALE');
    const inputFile = path.join(source.project, ...inputSnapshot.path.split('/'));
    const inputFd = fs.openSync(inputFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let bytes;
    try {
      const inputStat = fs.fstatSync(inputFd);
      if (!inputStat.isFile() || inputStat.size !== checked.size) throw new Error('NATIVE_DEV_MANUAL_IMPORT_STALE');
      bytes = fs.readFileSync(inputFd);
    } finally { fs.closeSync(inputFd); }
    if (sha256(bytes) !== checked.sha256 || bytes.includes(0) ||
        new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim() === '') {
      throw new Error('NATIVE_DEV_MANUAL_IMPORT_STALE');
    }
    const file = `import-${String(current.events.length + 1).padStart(6, '0')}-${crypto.randomBytes(12).toString('hex')}.md`;
    const outputPath = `.ludory/ai/runs/${current.run.runId}/drafts/${file}`;
    checkedRunDir(source.project, current.run.runId);
    withinDirectory(current.run.runId, false, () => withinDirectory('drafts', true, () => {
      const fd = fs.openSync(file, EXCLUSIVE, 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
    }));
    return { outputPath, outputSha256: sha256(bytes), outputSize: bytes.length };
  });
}

/** Write validated producer bytes exclusively beneath the pending native run, not game assets. */
export function stageNativeImageArtifacts(projectDir, runRef, requestSha256, inputs) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 4) throw new Error('NATIVE_IMAGE_INPUT_INVALID');
  if (inputs.some(input => !(Buffer.isBuffer(input?.bytes) || input?.bytes instanceof Uint8Array) ||
      input.bytes.length === 0 || input.bytes.length > 10 * 1024 * 1024)) {
    throw new Error('NATIVE_IMAGE_INPUT_INVALID');
  }
  const inspected = inputs.map(input => ({
    bytes: Buffer.isBuffer(input?.bytes) || input?.bytes instanceof Uint8Array
      ? Buffer.from(input.bytes) : null,
    mediaType: input?.mediaType,
  }));
  const descriptors = inspected.map(input => inspectGeneratedImage(input.bytes, { mediaType: input.mediaType }));
  const source = inspectNativeProject(projectDir);
  return withLock(source.project, source, () => {
    const current = readNativeRun(source.project, runRef);
    if (current.pendingExecutor !== 'image-gen' || current.pendingRequestSha256 !== requestSha256) {
      throw new Error('NATIVE_IMAGE_REQUEST_STALE');
    }
    const request = current.events.at(-1);
    verifyDraftInputs(source.project, [request.request.brief]);
    const index = String(request.index).padStart(6, '0');
    const outputs = descriptors.map((info, order) => ({
      outputPath: `.ludory/ai/runs/${current.run.runId}/images/image-${index}-${order}.${info.mediaType === 'image/png' ? 'png' : info.mediaType === 'image/jpeg' ? 'jpg' : 'webp'}`,
      outputSha256: info.sha256, outputSize: info.size, mediaType: info.mediaType,
      width: info.width, height: info.height, modelObserved: request.request.modelObserved,
    }));
    checkedRunDir(source.project, current.run.runId);
    withinDirectory(current.run.runId, false, () => withinDirectory('images', true, () => {
      for (const [order, output] of outputs.entries()) {
        const file = path.basename(output.outputPath);
        const fd = fs.openSync(file, EXCLUSIVE, 0o600);
        try { fs.writeFileSync(fd, inspected[order].bytes); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
      }
    }));
    return outputs;
  });
}

/** Manual input is re-read through pinned project directories while the native lock is held. */
export function stageNativeManualImage(projectDir, runRef, expectedHeadSha256,
  { brief, source: inputSnapshot, requestedModel }) {
  const source = inspectNativeProject(projectDir);
  return withLock(source.project, source, () => {
    const current = readNativeRun(source.project, runRef);
    if (current.headSha256 !== expectedHeadSha256 || current.pendingExecutor || current.terminal ||
        !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status) ||
        current.events.some(event => event.kind === 'IMAGE_IMPORTED')) throw new Error('NATIVE_IMAGE_IMPORT_STALE');
    verifyDraftInputs(source.project, [brief, inputSnapshot]);
    const input = readProjectImageInput(source.project, inputSnapshot.path);
    if (input.source.sha256 !== inputSnapshot.sha256 || input.source.size !== inputSnapshot.size) {
      throw new Error('NATIVE_IMAGE_IMPORT_STALE');
    }
    const file = `import-${String(current.events.length + 1).padStart(6, '0')}-${crypto.randomBytes(12).toString('hex')}.${input.info.mediaType === 'image/png' ? 'png' : input.info.mediaType === 'image/jpeg' ? 'jpg' : 'webp'}`;
    const output = { outputPath: `.ludory/ai/runs/${current.run.runId}/images/${file}`,
      outputSha256: input.info.sha256, outputSize: input.info.size, mediaType: input.info.mediaType,
      width: input.info.width, height: input.info.height, modelObserved: null };
    validateImageManualImport({ taskKind: 'image', provenance: 'USER_DECLARED',
      reviewStatus: 'PENDING_REVIEW', requestedModel, brief, source: inputSnapshot, output },
    current.run.runId, current.events.length + 1);
    checkedRunDir(source.project, current.run.runId);
    withinDirectory(current.run.runId, false, () => withinDirectory('images', true, () => {
      const fd = fs.openSync(file, EXCLUSIVE, 0o600);
      try { fs.writeFileSync(fd, input.bytes); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
    }));
    return output;
  });
}
