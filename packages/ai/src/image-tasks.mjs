import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { inspectNativeProject, verifyNativeSource, snapshotArtifact } from './source.mjs';
import { readNativeRun, planNativeEvent, commitNativeEvent, stageNativeImageArtifacts,
  stageNativeManualImage } from './store.mjs';
import { hasStudioCreationReceipt } from './executor.mjs';
import { ownData } from './capabilities.mjs';
import { validateImageCapability, discoverImageHost } from './image-host.mjs';
import { inspectGeneratedImage, readProjectImageInput } from './image-artifacts.mjs';

const MAX_BRIEF = 64 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const imagePath = file => typeof file === 'string' && file.length > 0 && file.length <= 200 &&
  !/[\\:\0]/.test(file) && !file.startsWith('/') &&
  file.split('/').every(part => part && part !== '.' && part !== '..');

function boundedBrief(project, file) {
  const snapshot = snapshotArtifact(project, file, { maxBytes: MAX_BRIEF });
  if (!snapshot.size) throw new Error('IMAGE_BRIEF_EMPTY');
  const fd = fs.openSync(path.join(project, ...file.split('/')),
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > MAX_BRIEF) throw new Error('IMAGE_BRIEF_UNSAFE');
    bytes = fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
  if (bytes.length !== snapshot.size || hash(bytes) !== snapshot.sha256 ||
      !equal(snapshotArtifact(project, file, { maxBytes: MAX_BRIEF }), snapshot)) {
    throw new Error('IMAGE_BRIEF_STALE');
  }
  let value;
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('IMAGE_BRIEF_INVALID_TEXT'); }
  if (!value.trim() || value.includes('\0')) throw new Error('IMAGE_BRIEF_INVALID_TEXT');
  return { snapshot, text: value };
}

function blocked(project, run, code) {
  return { engine: 'ludory-ai', operation: 'image', project, runId: run, taskKind: 'image',
    status: 'BLOCKED', selectedRoute: null, reasonCode: code, writes: [], conflicts: [],
    nextAction: { kind: 'STOP', executable: false } };
}

/** Read-only planning: discovery is an explicitly injected, trusted host capability probe. */
export async function planImageTask(projectDir, options = {}, { discover = async () => null } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['run', 'brief', 'model'].includes(key)) ||
      typeof options.run !== 'string' || !options.run.trim() || options.run.length > 180 ||
      !imagePath(options.brief) || !['auto', 'terra', 'sol'].includes(options.model ?? 'auto')) {
    throw new Error('IMAGE_TASK_INVALID');
  }
  const { run, brief, model = 'auto' } = options;
  const sourceBinding = inspectNativeProject(projectDir);
  const project = sourceBinding.project;
  if (!hasStudioCreationReceipt(project)) return blocked(project, run, 'IMAGE_STUDIO_GAME_REQUIRED');
  let current;
  try { current = readNativeRun(project, run); }
  catch { return blocked(project, run, 'IMAGE_RUN_UNAVAILABLE'); }
  if (current.terminal || current.pendingExecutor ||
      !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status)) {
    return blocked(project, run, 'IMAGE_RUN_NOT_ACTIVE');
  }
  let briefFile;
  try { briefFile = boundedBrief(project, brief); }
  catch (error) { return blocked(project, run, error.message.startsWith('IMAGE_')
    ? error.message : 'IMAGE_BRIEF_UNSAFE'); }
  let found;
  try { found = await discover(project); }
  catch { found = null; }
  const terra = validateImageCapability(ownData(found, 'imageTerra'), 'terra');
  const sol = validateImageCapability(ownData(found, 'imageSol'), 'sol');
  const selected = model !== 'sol' && terra.available ? 'terra'
    : model !== 'terra' && sol.available ? 'sol' : null;
  const capability = selected === 'terra' ? terra : selected === 'sol' ? sol : null;
  const ready = Boolean(selected);
  return { engine: 'ludory-ai', operation: 'image', project, runId: current.run.runId,
    taskKind: 'image', requestedModel: model, preferredRoute: model === 'sol' ? 'image-sol' : 'image-terra',
    sourceBinding, runHeadSha256: current.headSha256, stage: current.nextStage,
    brief: briefFile.snapshot, status: ready ? 'READY' : 'NEEDS_USER_ACTION',
    selectedRoute: ready ? `image-${selected}` : 'manual',
    ...(ready && { modelObserved: capability.modelObserved }),
    reasonCode: ready ? 'IMAGE_ROUTE_VERIFIED'
      : model === 'auto' ? 'IMAGE_HOST_CAPABILITY_UNVERIFIED' : 'IMAGE_PINNED_MODEL_UNAVAILABLE',
    capabilityReasons: { terra: terra.reasonCode, sol: sol.reasonCode },
    writes: [], conflicts: [],
    manualPacket: { taskKind: 'image', runId: current.run.runId,
      brief: { ...briefFile.snapshot, text: briefFile.text }, requestedModel: model,
      output: 'PNG, JPEG or WebP originals for explicit review-only import; never Release PASS' },
    nextAction: { kind: ready ? 'REVIEW_IMAGE_ROUTE' : 'MANUAL_HANDOFF', executable: false } };
}

export function verifyImagePlan(plan) {
  if (!plan || plan.operation !== 'image' || !verifyNativeSource(plan.sourceBinding ?? {}).ok) {
    return { ok: false, code: 'IMAGE_SOURCE_STALE' };
  }
  try {
    const current = readNativeRun(plan.project, plan.runId);
    if (current.headSha256 !== plan.runHeadSha256 || current.nextStage !== plan.stage ||
        current.terminal || current.pendingExecutor ||
        !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status) ||
        !equal(snapshotArtifact(plan.project, plan.brief.path, { maxBytes: MAX_BRIEF }), plan.brief)) {
      return { ok: false, code: 'IMAGE_SOURCE_STALE' };
    }
    return { ok: true };
  } catch { return { ok: false, code: 'IMAGE_SOURCE_STALE' }; }
}

export async function executeImageTask(plan, { apply = false, host = null, timeoutMs = 90_000 } = {}) {
  if (!plan || plan.operation !== 'image') throw new Error('IMAGE_PLAN_INVALID');
  if (!apply || plan.status !== 'READY') return plan;
  const verified = verifyImagePlan(plan);
  if (!verified.ok) throw new Error(verified.code);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('IMAGE_TIMEOUT_INVALID');
  }
  const live = await discoverImageHost(host);
  const model = plan.selectedRoute === 'image-terra' ? 'terra' : plan.selectedRoute === 'image-sol' ? 'sol' : null;
  const capability = model === 'terra' ? live.imageTerra : live.imageSol;
  if (!model || !capability.available || capability.modelObserved !== plan.modelObserved) {
    throw new Error('IMAGE_ROUTE_UNVERIFIED');
  }
  const fresh = await planImageTask(plan.project, { run: plan.runId, brief: plan.brief.path,
    model: plan.requestedModel }, { discover: async () => live });
  if (fresh.status !== 'READY' || fresh.selectedRoute !== plan.selectedRoute ||
      fresh.modelObserved !== plan.modelObserved || fresh.stage !== plan.stage ||
      fresh.runHeadSha256 !== plan.runHeadSha256 ||
      !equal(fresh.brief, plan.brief) || !equal(fresh.sourceBinding, plan.sourceBinding)) {
    throw new Error('IMAGE_PLAN_TAMPERED_OR_STALE');
  }
  const requested = commitNativeEvent(planNativeEvent(plan.project, plan.runId, {
    kind: 'ACTION_REQUESTED', stage: plan.stage, executor: 'image-gen',
    request: { taskKind: 'image', route: plan.selectedRoute, requestedModel: plan.requestedModel,
      modelObserved: plan.modelObserved, brief: plan.brief },
  }));
  const requestSha256 = requested.pendingRequestSha256;
  const abort = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(new Error('IMAGE_HOST_TIMEOUT')); }, timeoutMs);
  });
  // A timeout is uncertain: the host may still finish. Leave the request pending for manual recovery.
  let response;
  try {
    response = await Promise.race([Promise.resolve().then(() => host.generate({
      model, modelObserved: plan.modelObserved, route: plan.selectedRoute,
      taskId: plan.runId, requestSha256, briefSha256: plan.brief.sha256,
      prompt: fresh.manualPacket.brief.text, maxImages: 4, signal: abort.signal,
    })), timeout]);
  } finally { clearTimeout(timer); }
  const imageInputs = ownData(response, 'images');
  const acceptedEnvelope = ownData(response, 'status') === 'HOST_OBSERVED' &&
    ownData(response, 'modelObserved') === plan.modelObserved &&
    ownData(response, 'routeObserved') === 'image-gen' &&
    ownData(response, 'attestationScope') === 'live-execution-context' &&
    ownData(response, 'imageGenCalled') === true && Array.isArray(imageInputs) &&
    imageInputs.length > 0 && imageInputs.length <= 4;
  const sourceValid = verifyNativeSource(plan.sourceBinding).ok && (() => {
    try { return equal(snapshotArtifact(plan.project, plan.brief.path, { maxBytes: MAX_BRIEF }), plan.brief); }
    catch { return false; }
  })();
  let outputs = [];
  if (acceptedEnvelope && sourceValid) {
    try {
      for (const input of imageInputs) inspectGeneratedImage(ownData(input, 'bytes'),
        { mediaType: ownData(input, 'mediaType') });
      outputs = stageNativeImageArtifacts(plan.project, plan.runId, requestSha256,
        imageInputs.map(input => ({ bytes: ownData(input, 'bytes'), mediaType: ownData(input, 'mediaType') })));
    } catch (error) {
      // A malformed host payload is definitive. An unexpected staging/storage error is not:
      // the generated files may have been partially published, so preserve the pending request.
      if (!error.message.startsWith('IMAGE_ARTIFACT_')) throw error;
    }
  }
  const ok = acceptedEnvelope && sourceValid && outputs.length === imageInputs.length;
  const result = { ok, code: ok ? 'HOST_OBSERVED' : 'IMAGE_EXECUTOR_UNVERIFIED',
    reviewStatus: 'PENDING_REVIEW', modelObserved: ok ? plan.modelObserved : null, images: ok ? outputs : [] };
  const end = commitNativeEvent(planNativeEvent(plan.project, plan.runId,
    { kind: 'EXECUTION_RESULT', stage: plan.stage, result }));
  return { engine: 'ludory-ai', operation: 'image', project: plan.project, runId: plan.runId,
    status: ok ? 'PENDING_REVIEW' : 'BLOCKED', nativeStatus: end.status,
    reasonCode: ok ? 'IMAGE_REVIEW_REQUIRED' : 'IMAGE_EXECUTOR_UNVERIFIED',
    provenance: ok ? 'HOST_OBSERVED' : 'UNVERIFIED', writes: outputs.map(item => item.outputPath),
    ...(ok && { images: outputs, modelObserved: plan.modelObserved }),
    nextAction: { kind: ok ? 'REVIEW_IMAGES' : 'STOP', executable: false } };
}

export async function planImageImport(projectDir, { run, brief, file } = {}) {
  const plan = await planImageTask(projectDir, { run, brief });
  if (plan.status === 'BLOCKED') return { ...plan, operation: 'image-import' };
  if (!imagePath(file) || file === brief) throw new Error('IMAGE_IMPORT_FILE_INVALID');
  const current = readNativeRun(plan.project, plan.runId);
  if (current.events.some(event => event.kind === 'IMAGE_IMPORTED')) {
    return { ...blocked(plan.project, plan.runId, 'IMAGE_IMPORT_ALREADY_EXISTS'), operation: 'image-import' };
  }
  let input;
  try { input = readProjectImageInput(plan.project, file); }
  catch (error) { return { ...blocked(plan.project, plan.runId, error.message.startsWith('IMAGE_ARTIFACT_')
    ? error.message : 'IMAGE_IMPORT_FILE_UNSAFE'), operation: 'image-import' }; }
  return { ...plan, operation: 'image-import', status: 'READY', selectedRoute: 'manual',
    provenance: 'USER_DECLARED', reasonCode: 'IMAGE_MANUAL_IMPORT_REQUIRES_REVIEW',
    source: input.source, info: input.info, manualPacket: undefined,
    writes: [`.ludory/ai/runs/${plan.runId}/images/import-<unique>.${path.extname(file).slice(1)}`,
      'native immutable USER_DECLARED image event'],
    nextAction: { kind: 'IMPORT_DECLARED_IMAGE', executable: false } };
}

export async function executeImageImport(plan, { apply = false } = {}) {
  if (!plan || plan.operation !== 'image-import') throw new Error('IMAGE_IMPORT_PLAN_INVALID');
  if (plan.status !== 'READY' || !apply) return plan;
  const fresh = await planImageImport(plan.project, { run: plan.runId, brief: plan.brief?.path,
    file: plan.source?.path });
  if (fresh.status !== 'READY' || fresh.runHeadSha256 !== plan.runHeadSha256 ||
      fresh.stage !== plan.stage || !equal(fresh.brief, plan.brief) ||
      !equal(fresh.sourceBinding, plan.sourceBinding) || !equal(fresh.source, plan.source) ||
      !equal(fresh.info, plan.info)) throw new Error('IMAGE_IMPORT_PLAN_TAMPERED_OR_STALE');
  const output = stageNativeManualImage(plan.project, plan.runId, plan.runHeadSha256,
    { brief: plan.brief, source: plan.source, requestedModel: plan.requestedModel });
  const finished = commitNativeEvent(planNativeEvent(plan.project, plan.runId, {
    kind: 'IMAGE_IMPORTED', stage: plan.stage,
    manual: { taskKind: 'image', provenance: 'USER_DECLARED', reviewStatus: 'PENDING_REVIEW',
      requestedModel: plan.requestedModel, brief: plan.brief, source: plan.source, output },
  }));
  return { engine: 'ludory-ai', operation: 'image-import', project: plan.project,
    runId: plan.runId, taskKind: 'image', status: 'PENDING_REVIEW',
    provenance: 'USER_DECLARED', output, nextStage: finished.nextStage,
    nativeStatus: finished.status, writes: [output.outputPath],
    nextAction: { kind: 'REVIEW_IMAGES', executable: false } };
}
