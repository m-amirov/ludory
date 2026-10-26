import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPipeline, checkTransition } from './pipelines.mjs';
import { inspectNativeProject, verifyNativeSource, snapshotArtifact } from './source.mjs';
import { inspectGeneratedImage, readProjectImageInput } from './image-artifacts.mjs';
import { canonicalPhysicalDirectory } from '@ludory/core';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serial = value => `${JSON.stringify(value, null, 2)}\n`;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/;
const EXCLUSIVE = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
const EXECUTION_CODES = new Set(['EXECUTED_UNVERIFIED', 'EXECUTOR_INCOMPLETE', 'EXECUTOR_UNAVAILABLE',
  'EXECUTOR_TIMEOUT', 'EXECUTOR_OUTPUT_LIMIT', 'EXECUTOR_SPAWN_FAILED', 'EXECUTOR_NONZERO_EXIT',
  'EXECUTOR_MALFORMED_JSONL', 'EXECUTOR_TURN_FAILED', 'EXECUTOR_WRAPPER_UNSUPPORTED',
  'EXECUTOR_INTERRUPTED', 'EXECUTOR_CHECKS_FAILED']);
const DEV_TASKS = new Set(['episode-script', 'art-concept']);
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
    if (event.kind === 'CHECKPOINT') {
      if (pendingExecutor) throw new Error('NATIVE_INTEGRITY_EXECUTOR_PENDING_RESULT');
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
      if (['web-dev', 'image-gen'].includes(pendingExecutor) && event.result.ok) reviewPending = true;
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
        reviewPending = true;
      } catch { throw new Error('NATIVE_INTEGRITY_DEV_MANUAL_IMPORT'); }
    } else if (event.kind === 'IMAGE_IMPORTED') {
      if (pendingExecutor || event.outcome !== null || event.artifacts?.length || manualImageImported) {
        throw new Error('NATIVE_INTEGRITY_IMAGE_IMPORT');
      }
      try {
        const imp = validateImageManualImport(event.manual, runId, event.index, { allowArchived: true });
        verifyStoredImage(project, runId, imp.output);
        manualImageImported = true;
        reviewPending = true;
      } catch { throw new Error('NATIVE_INTEGRITY_IMAGE_IMPORT'); }
    } else throw new Error('NATIVE_INTEGRITY_EVENT_KIND');
    precedingHash = sha256(bytes);
    events.push(event);
  }
  return { run, events, status, nextStage: next, terminal, headSha256: precedingHash,
    pendingExecutor, pendingRequestSha256, reviewPending,
    integrity: { ok: true, issues: [] } };
}

export function planNativeEvent(projectDir, runRef, input) {
  const project = path.resolve(projectDir);
  const current = readNativeRun(project, runRef);
  const source = inspectNativeProject(project);
  if (current.terminal) throw new Error('NATIVE_TERMINAL_RUN');
  if (!input || !['CHECKPOINT', 'ACTION_REQUESTED', 'EXECUTION_RESULT', 'DRAFT_IMPORTED', 'IMAGE_IMPORTED'].includes(input.kind)) throw new Error('NATIVE_EVENT_KIND_INVALID');
  if (input.stage !== current.nextStage) throw new Error(`NATIVE_INVALID_STAGE: expected ${current.nextStage}`);
  let artifacts = [];
  let outcome = null;
  let result = null;
  let manual = null;
  if (input.kind === 'CHECKPOINT') {
    if (current.pendingExecutor) throw new Error('NATIVE_EXECUTOR_PENDING_RESULT');
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
  } else if (input.kind === 'IMAGE_IMPORTED') {
    if (current.pendingExecutor || !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status) ||
        current.events.some(event => event.kind === 'IMAGE_IMPORTED')) throw new Error('NATIVE_IMAGE_IMPORT_DUPLICATE');
    manual = validateImageManualImport(input.manual, current.run.runId, current.events.length + 1);
    verifyStoredImage(project, current.run.runId, manual.output);
  } else if (input.kind === 'DRAFT_IMPORTED') {
    if (current.pendingExecutor || !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status) ||
        current.events.some(event => event.kind === 'DRAFT_IMPORTED' &&
          event.manual.taskKind === input.manual?.taskKind)) throw new Error('NATIVE_DEV_MANUAL_IMPORT_DUPLICATE');
    manual = validateManualImport(input.manual, current.run.runId, current.events.length + 1);
    const file = snapshotArtifact(project, manual.output.outputPath);
    if (file.sha256 !== manual.output.outputSha256 || file.size !== manual.output.outputSize) {
      throw new Error('NATIVE_DEV_MANUAL_IMPORT_STALE');
    }
  } else {
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
        (plan.event.kind === 'ACTION_REQUESTED' && ['WAITING_FOR_EVIDENCE', 'EXECUTED_UNVERIFIED'].includes(current.status)) ||
        (plan.event.kind === 'CHECKPOINT' && current.pendingExecutor) ||
        (plan.event.kind === 'EXECUTION_RESULT' && (current.status !== 'WAITING_FOR_EVIDENCE' ||
          !['codex', 'web-dev', 'image-gen'].includes(current.pendingExecutor) ||
          plan.event.requestSha256 !== current.pendingRequestSha256))) {
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
      const eventFd = fs.openSync(tmpEvent, EXCLUSIVE, 0o600);
      try { fs.writeFileSync(eventFd, eventBytes); } finally { fs.closeSync(eventFd); }
      try {
        const receiptFd = fs.openSync(tmpReceipt, EXCLUSIVE, 0o600);
        try { fs.writeFileSync(receiptFd, receiptBytes); } finally { fs.closeSync(receiptFd); }
        fs.linkSync(tmpEvent, `${prefix}.json`);
        // Commit marker published last: an interrupted event is never accepted.
        fs.linkSync(tmpReceipt, `${prefix}.commit.json`);
      } catch { throw new Error('NATIVE_EVENT_CONFLICT'); }
      finally {
        // Only unique temporary files created by this operation may be removed.
        fs.unlinkSync(tmpEvent);
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
