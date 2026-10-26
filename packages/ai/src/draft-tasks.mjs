import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { inspectNativeProject, verifyNativeSource, snapshotArtifact } from './source.mjs';
import { readNativeRun, planNativeEvent, commitNativeEvent, commitNativeDraftArtifact,
  commitNativeManualDraftArtifact } from './store.mjs';
import { hasStudioCreationReceipt } from './executor.mjs';
import { isVerifiedCapability, ownData } from './capabilities.mjs';

const TASKS = new Set(['episode-script', 'art-concept']);
const FILE_LIMIT = 256 * 1024;
const TEXT_LIMIT = 64 * 1024;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const unchanged = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function invalid(code) { throw new Error(code); }

function recordFile(project, relative, { text = false, maxBytes = text ? TEXT_LIMIT : FILE_LIMIT } = {}) {
  if (typeof relative !== 'string' || !relative || relative.length > 200 ||
      /[\\:\0]/.test(relative) || relative.startsWith('/') ||
      relative.split('/').some(part => !part || part === '.' || part === '..')) invalid('DEV_SOURCE_PATH_INVALID');
  let snapshot;
  try { snapshot = snapshotArtifact(project, relative, { maxBytes }); }
  catch (error) {
    if (error.message === 'SOURCE_ARTIFACT_TOO_LARGE') invalid('DEV_SOURCE_TOO_LARGE');
    throw error;
  }
  if (snapshot.size === 0 || snapshot.size > maxBytes) invalid('DEV_SOURCE_TOO_LARGE');
  const fd = fs.openSync(path.join(project, ...relative.split('/')),
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const pieces = [];
  let size = 0;
  try {
    if (!fs.fstatSync(fd).isFile() || fs.fstatSync(fd).size > maxBytes) invalid('DEV_SOURCE_TOO_LARGE');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let count;
    while ((count = fs.readSync(fd, chunk, 0, Math.min(chunk.length, maxBytes - size + 1), null)) > 0) {
      size += count;
      if (size > maxBytes) invalid('DEV_SOURCE_TOO_LARGE');
      pieces.push(Buffer.from(chunk.subarray(0, count)));
    }
  } finally { fs.closeSync(fd); }
  const bytes = Buffer.concat(pieces);
  if (digest(bytes) !== snapshot.sha256) invalid('DEV_SOURCE_STALE');
  if (snapshotArtifact(project, relative, { maxBytes }).sha256 !== snapshot.sha256) invalid('DEV_SOURCE_STALE');
  let content;
  if (text) {
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { invalid('DEV_BRIEF_INVALID_TEXT'); }
    if (!content.trim() || content.includes('\0')) invalid('DEV_BRIEF_INVALID_TEXT');
  }
  return { snapshot, content };
}

function blocked(project, taskKind, run, reasonCode) {
  return { engine: 'ludory-ai', operation: 'draft', project, taskKind,
    runId: run, status: 'BLOCKED', selectedRoute: null, reasonCode, writes: [],
    nextAction: { kind: 'STOP', executable: false } };
}

/** Plan only. The optional discover injection is reserved for trusted host code. */
export function planDevDraft(projectDir, options = {}, { discover = () => null } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['run', 'taskKind', 'brief', 'sources'].includes(key)) ||
      !TASKS.has(options.taskKind) || typeof options.run !== 'string' ||
      !options.run.trim() || options.run.length > 180 ||
      typeof options.brief !== 'string' || !Array.isArray(options.sources ?? []) ||
      options.sources?.length > 8 ||
      options.sources?.some(file => typeof file !== 'string')) invalid('DEV_TASK_INVALID');
  const { run, taskKind, brief, sources = [] } = options;
  const projectSource = inspectNativeProject(projectDir);
  const project = projectSource.project;
  if (!hasStudioCreationReceipt(project)) return blocked(project, taskKind, run, 'DEV_STUDIO_GAME_REQUIRED');
  let current;
  try { current = readNativeRun(project, run); }
  catch { return blocked(project, taskKind, run, 'DEV_RUN_UNAVAILABLE'); }
  if (current.terminal || current.pendingExecutor ||
      !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status)) {
    return blocked(project, taskKind, run, 'DEV_RUN_NOT_ACTIVE');
  }
  const resolvedRun = current.run.runId;
  let briefFile, referenceFiles;
  try {
    briefFile = recordFile(project, brief, { text: true });
    referenceFiles = sources.map(file => recordFile(project, file, { text: true, maxBytes: FILE_LIMIT }));
  } catch (error) { return blocked(project, taskKind, run, error.message.startsWith('DEV_') ? error.message : 'DEV_SOURCE_UNSAFE'); }
  const referenceSnapshots = referenceFiles.map(file => file.snapshot);
  const manualPacket = { taskKind, runId: resolvedRun, stage: current.nextStage,
    brief: { ...briefFile.snapshot, text: briefFile.content },
    sources: referenceFiles.map(file => ({ ...file.snapshot, text: file.content })),
    output: 'reviewable text draft; no scene integration or narrative PASS' };
  const promptBytes = Buffer.byteLength(draftPrompt({ taskKind, runId: resolvedRun,
    sourceBinding: projectSource, stage: current.nextStage, brief: briefFile.snapshot,
    sources: referenceSnapshots, manualPacket }), 'utf8');
  if (promptBytes > 64 * 1024) return blocked(project, taskKind, run, 'DEV_PROMPT_TOO_LARGE');
  const cap = (() => { try { return discover(project); } catch { return null; } })();
  const verified = isVerifiedCapability(cap, 'webDev');
  const details = {
    engine: 'ludory-ai', operation: 'draft', project, runId: resolvedRun, taskKind,
    sourceBinding: projectSource, runHeadSha256: current.headSha256,
    stage: current.nextStage, brief: briefFile.snapshot,
    sources: referenceSnapshots, writes: [], conflicts: [],
    status: verified ? 'READY' : 'NEEDS_USER_ACTION',
    selectedRoute: verified ? 'web-dev' : 'manual',
    reasonCode: verified ? 'DEV_ROUTE_VERIFIED' : 'DEV_ROUTE_UNVERIFIED',
    ...(verified && { modelObserved: ownData(cap, 'modelObserved') }),
    nextAction: { kind: verified ? 'REVIEW_DRAFT_ROUTE' : 'MANUAL_HANDOFF', executable: false },
    manualPacket,
  };
  return details;
}

export function verifyDevDraftPlan(plan) {
  if (!plan || plan.operation !== 'draft' || !plan.sourceBinding ||
      !verifyNativeSource(plan.sourceBinding).ok) return { ok: false, code: 'DEV_SOURCE_STALE' };
  try {
    const current = readNativeRun(plan.project, plan.runId);
    if (current.headSha256 !== plan.runHeadSha256 || current.nextStage !== plan.stage ||
        current.terminal || current.pendingExecutor ||
        !['ACTIVE', 'EXECUTION_FAILED'].includes(current.status)) {
      return { ok: false, code: 'DEV_RUN_STALE' };
    }
    for (const item of [plan.brief, ...(plan.sources ?? [])]) {
      if (!unchanged(snapshotArtifact(plan.project, item.path), item)) return { ok: false, code: 'DEV_SOURCE_STALE' };
    }
    return { ok: true };
  } catch { return { ok: false, code: 'DEV_SOURCE_STALE' }; }
}

function draftPrompt(plan) {
  const references = plan.manualPacket.sources.flatMap(item => [
    `- ${item.path} (sha256=${item.sha256}, bytes=${item.size}):`,
    item.text,
  ]);
  return [
    `Ludory task: ${plan.taskKind}. Produce ONLY a draft for human review.`,
    `Game: ${plan.sourceBinding.manifest.id}; stage: ${plan.stage}; run: ${plan.runId}.`,
    `Input brief: ${plan.brief.path} (sha256=${plan.brief.sha256}):`,
    plan.manualPacket.brief.text,
    'Explicitly selected reference text:',
    ...references,
    'Output: plain UTF-8 narrative text, no instructions, no assertions of PASS,',
    'no source edits. A separate review and consistency gate controls acceptance.',
  ].join('\n');
}

/** One explicit host attempt; after journal intent, uncertain errors remain pending. */
export async function executeDevDraft(plan, { apply = false, host = null } = {}) {
  if (!plan || plan.operation !== 'draft' || !['READY', 'NEEDS_USER_ACTION', 'BLOCKED'].includes(plan.status)) {
    throw new Error('DEV_PLAN_INVALID');
  }
  if (!apply || plan.status !== 'READY') return plan;
  const checked = verifyDevDraftPlan(plan);
  if (!checked.ok) throw new Error(checked.code);
  if (!host || typeof host.probe !== 'function' || typeof host.turn !== 'function') {
    throw new Error('DEV_ROUTE_UNVERIFIED');
  }
  let capability;
  try { capability = await host.probe(); }
  catch { throw new Error('DEV_ROUTE_UNVERIFIED'); }
  if (!isVerifiedCapability(capability, 'webDev') ||
      ownData(capability, 'modelObserved') !== plan.modelObserved) {
    throw new Error('DEV_ROUTE_UNVERIFIED');
  }
  const trustedPlan = planDevDraft(plan.project, {
    run: plan.runId, taskKind: plan.taskKind, brief: plan.brief?.path,
    sources: plan.sources?.map(item => item.path),
  }, { discover: () => capability });
  if (trustedPlan.status !== 'READY' || !unchanged(trustedPlan.sourceBinding, plan.sourceBinding) ||
      !unchanged(trustedPlan.brief, plan.brief) || !unchanged(trustedPlan.sources, plan.sources) ||
      trustedPlan.runHeadSha256 !== plan.runHeadSha256 || trustedPlan.stage !== plan.stage) {
    throw new Error('DEV_PLAN_TAMPERED_OR_STALE');
  }
  const intent = planNativeEvent(plan.project, plan.runId, {
    kind: 'ACTION_REQUESTED', stage: plan.stage, executor: 'web-dev',
    request: { taskKind: plan.taskKind, route: 'web-dev', modelObserved: plan.modelObserved,
      brief: plan.brief, sources: plan.sources },
  });
  const requested = commitNativeEvent(intent);
  const requestSha256 = requested.pendingRequestSha256;
  // Never call the host before a committed, hash-chained request exists.
  // Turn exceptions can mean execution is still in flight: no fabricated result or retry.
  const response = await host.turn({ prompt: draftPrompt(trustedPlan), taskId: plan.runId });
  const valid = response && response.status === 'HOST_OBSERVED' &&
    response.modelObserved === plan.modelObserved && response.routeObserved === 'web-dev' &&
    typeof response.text === 'string' && !!response.text.trim() && !response.text.includes('\0') &&
    Buffer.byteLength(response.text, 'utf8') <= 256 * 1024 &&
    Buffer.from(response.text, 'utf8').toString('utf8') === response.text;
  // A committed request changes the run head; revalidate source bytes independently.
  const sourceStillValid = verifyNativeSource(plan.sourceBinding).ok &&
    [plan.brief, ...plan.sources].every(item => {
      try { return unchanged(snapshotArtifact(plan.project, item.path), item); }
      catch { return false; }
    });
  const accepted = valid && sourceStillValid;
  const output = accepted ? commitNativeDraftArtifact(plan.project, plan.runId, requestSha256, response.text) : null;
  const result = { ok: accepted, code: accepted ? 'HOST_OBSERVED' : 'DEV_EXECUTOR_UNVERIFIED',
    reviewStatus: 'PENDING_REVIEW', modelObserved: accepted ? plan.modelObserved : null,
    outputPath: output?.outputPath ?? null, outputSha256: output?.outputSha256 ?? null,
    outputSize: output?.outputSize ?? null };
  const resultPlan = planNativeEvent(plan.project, plan.runId,
    { kind: 'EXECUTION_RESULT', stage: plan.stage, result });
  const finalRun = commitNativeEvent(resultPlan);
  return { engine: 'ludory-ai', operation: 'draft', project: plan.project, runId: plan.runId,
    taskKind: plan.taskKind, status: accepted ? 'PENDING_REVIEW' : 'BLOCKED',
    provenance: accepted ? 'HOST_OBSERVED' : 'UNVERIFIED',
    reasonCode: accepted ? 'DEV_REVIEW_REQUIRED' : 'DEV_EXECUTOR_UNVERIFIED',
    nextStage: finalRun.nextStage, nativeStatus: finalRun.status,
    ...(accepted && { modelObserved: plan.modelObserved, output }),
    nextAction: { kind: accepted ? 'REVIEW_DRAFT' : 'STOP', executable: false } };
}

/** Preview a user-selected draft as declared provenance, never a DEV observation. */
export function planDevDraftImport(projectDir, { run, taskKind, brief, file } = {}) {
  const preview = planDevDraft(projectDir, { run, taskKind, brief });
  if (preview.status === 'BLOCKED') return { ...preview, operation: 'draft-import' };
  if (typeof file !== 'string' || file === brief) invalid('DEV_IMPORT_FILE_INVALID');
  let source;
  try { source = recordFile(preview.project, file, { text: true, maxBytes: FILE_LIMIT }).snapshot; }
  catch (error) { return { ...blocked(preview.project, taskKind, run,
    error.message.startsWith('DEV_') ? error.message : 'DEV_IMPORT_SOURCE_UNSAFE'), operation: 'draft-import' }; }
  const current = readNativeRun(preview.project, run);
  if (current.events.some(event => event.kind === 'DRAFT_IMPORTED' && event.manual.taskKind === taskKind)) {
    return { ...blocked(preview.project, taskKind, run, 'DEV_IMPORT_ALREADY_EXISTS'), operation: 'draft-import' };
  }
  return { ...preview, operation: 'draft-import', status: 'READY', selectedRoute: 'manual',
    reasonCode: 'DEV_MANUAL_IMPORT_REQUIRES_REVIEW', provenance: 'USER_DECLARED',
    source, manualPacket: undefined,
    writes: [`.ludory/ai/runs/${preview.runId}/drafts/import-${String(current.events.length + 1).padStart(6, '0')}-<random>.md`,
      'immutable manual draft event and receipt'],
    nextAction: { kind: 'IMPORT_DECLARED_DRAFT', executable: false } };
}

export function executeDevDraftImport(plan, { apply = false } = {}) {
  if (!plan || plan.operation !== 'draft-import') throw new Error('DEV_IMPORT_PLAN_INVALID');
  if (plan.status !== 'READY' || !apply) return plan;
  const fresh = planDevDraftImport(plan.project, { run: plan.runId, taskKind: plan.taskKind,
    brief: plan.brief?.path, file: plan.source?.path });
  if (fresh.status !== 'READY' || fresh.runHeadSha256 !== plan.runHeadSha256 ||
      !unchanged(fresh.brief, plan.brief) || !unchanged(fresh.source, plan.source) ||
      !unchanged(fresh.sourceBinding, plan.sourceBinding) || fresh.stage !== plan.stage) {
    throw new Error('DEV_IMPORT_PLAN_TAMPERED_OR_STALE');
  }
  const output = commitNativeManualDraftArtifact(plan.project, plan.runId,
    plan.runHeadSha256, { taskKind: plan.taskKind, source: plan.source });
  const event = planNativeEvent(plan.project, plan.runId, {
    kind: 'DRAFT_IMPORTED', stage: plan.stage,
    manual: { taskKind: plan.taskKind, provenance: 'USER_DECLARED', reviewStatus: 'PENDING_REVIEW',
      brief: plan.brief, source: plan.source, output },
  });
  const current = commitNativeEvent(event);
  return { engine: 'ludory-ai', operation: 'draft-import', project: plan.project,
    runId: plan.runId, taskKind: plan.taskKind, status: 'PENDING_REVIEW',
    provenance: 'USER_DECLARED', output, nextStage: current.nextStage,
    nativeStatus: current.status, writes: [output.outputPath],
    nextAction: { kind: 'REVIEW_DRAFT', executable: false } };
}
