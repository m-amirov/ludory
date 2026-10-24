import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPipeline, checkTransition } from './pipelines.mjs';
import { inspectNativeProject, verifyNativeSource, snapshotArtifact } from './source.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serial = value => `${JSON.stringify(value, null, 2)}\n`;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/;
const EXCLUSIVE = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);

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
  const project = path.resolve(projectDir);
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
      if (status === 'WAITING_FOR_EVIDENCE' || event.outcome !== null || event.artifacts?.length) {
        throw new Error('NATIVE_INTEGRITY_DUPLICATE_REQUEST');
      }
      status = 'WAITING_FOR_EVIDENCE';
    } else throw new Error('NATIVE_INTEGRITY_EVENT_KIND');
    precedingHash = sha256(bytes);
    events.push(event);
  }
  return { run, events, status, nextStage: next, terminal, headSha256: precedingHash,
    integrity: { ok: true, issues: [] } };
}

export function planNativeEvent(projectDir, runRef, input) {
  const project = path.resolve(projectDir);
  const current = readNativeRun(project, runRef);
  const source = inspectNativeProject(project);
  if (current.terminal) throw new Error('NATIVE_TERMINAL_RUN');
  if (!input || !['CHECKPOINT', 'ACTION_REQUESTED'].includes(input.kind)) throw new Error('NATIVE_EVENT_KIND_INVALID');
  if (input.stage !== current.nextStage) throw new Error(`NATIVE_INVALID_STAGE: expected ${current.nextStage}`);
  let artifacts = [];
  let outcome = null;
  if (input.kind === 'CHECKPOINT') {
    if (!Array.isArray(input.artifacts)) throw new Error('NATIVE_ARTIFACTS_INVALID');
    artifacts = input.artifacts.map(relative => snapshotArtifact(project, relative));
    outcome = input.outcome ?? 'CONTINUE';
    const decision = checkTransition(current.run.pipeline, input.stage, outcome, { hasEvidence: artifacts.length > 0 });
    if (!decision.ok) throw new Error(`NATIVE_CHECKPOINT_BLOCKED: ${decision.code}`);
  } else if (current.status === 'WAITING_FOR_EVIDENCE') {
    throw new Error('NATIVE_ACTION_ALREADY_REQUESTED');
  }
  const event = { schemaVersion: 1, index: current.events.length + 1, prevSha256: current.headSha256,
    kind: input.kind, stage: input.stage, outcome, artifacts, at: new Date().toISOString(),
    sourceAtCheckpoint: { gitHead: source.gitHead, manifestSha256: source.manifestSha256 } };
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
  const result = verifyNativeSource(plan.source);
  if (!result.ok) throw new Error(`NATIVE_SOURCE_STALE: ${result.code}`);
  return withLock(plan.project, plan.source, () => {
    const current = readNativeRun(plan.project, plan.runId);
    if (current.headSha256 !== plan.expectedHeadSha256 ||
        current.nextStage !== plan.event.stage || plan.event.index !== current.events.length + 1 ||
        (plan.event.kind === 'ACTION_REQUESTED' && current.status === 'WAITING_FOR_EVIDENCE')) {
      throw new Error('NATIVE_STALE_EVENT_CONFLICT');
    }
    const fresh = verifyNativeSource(plan.source);
    if (!fresh.ok) throw new Error(`NATIVE_SOURCE_STALE: ${fresh.code}`);
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
