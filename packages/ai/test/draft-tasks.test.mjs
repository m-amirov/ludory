import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { nativeProject } from './helpers/project.mjs';
import { planNewRun, commitNewRun } from '../src/store.mjs';
import { planDevDraft, verifyDevDraftPlan, executeDevDraft,
  planDevDraftImport, executeDevDraftImport } from '../src/draft-tasks.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function game(t, { receipt = true } = {}) {
  const project = nativeProject(t);
  if (receipt) fs.writeFileSync(path.join(project, 'ludory.studio.json'), JSON.stringify({
    schemaVersion: 1, profile: { id: 'narrative-game' }, template: { id: 'starter' },
    files: { 'ludory.project.json': sha256(fs.readFileSync(path.join(project, 'ludory.project.json'))) },
  }));
  fs.writeFileSync(path.join(project, 'brief.md'), 'Episode 1: the boat reaches the port.');
  const start = planNewRun(project, { pipeline: 'production-art', scope: {
    target: 'EP1', inScope: ['brief.md'], outOfScope: [],
    acceptanceContract: 'Narrative draft requires review', mutationBoundary: 'Draft only',
  } });
  const run = commitNewRun(start).run.runId;
  return { project, run };
}

const observedDev = { available: true, reasonCode: 'AVAILABLE', transportVerified: true,
  entitlementVerified: true, routeObserved: 'web-dev', modelObserved: 'gpt-6-sol' };

test('a new Studio game prepares a hash-bound manual draft packet without writes', t => {
  const { project, run } = game(t);
  const before = fs.readdirSync(path.join(project, '.ludory', 'ai', 'runs', run)).sort();
  const result = planDevDraft(project, { run, taskKind: 'episode-script', brief: 'brief.md',
    sources: ['src/main.js'] });
  assert.equal(result.status, 'NEEDS_USER_ACTION');
  assert.equal(result.selectedRoute, 'manual');
  assert.equal(result.nextAction.kind, 'MANUAL_HANDOFF');
  assert.equal(result.brief.sha256, sha256('Episode 1: the boat reaches the port.'));
  assert.equal(result.sources.length, 1);
  assert.equal(result.writes.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(project, '.ludory', 'ai', 'runs', run)).sort(), before);
});

test('a witnessed DEV capability makes a reviewable art-concept task ready', t => {
  const { project, run } = game(t);
  const result = planDevDraft(project, { run, taskKind: 'art-concept', brief: 'brief.md' },
    { discover: () => observedDev });
  assert.equal(result.status, 'READY');
  assert.equal(result.selectedRoute, 'web-dev');
  assert.equal(result.modelObserved, 'gpt-6-sol');
  assert.equal(result.nextAction.kind, 'REVIEW_DRAFT_ROUTE');
});

test('a frozen game blocks before consulting any external host', t => {
  const { project, run } = game(t, { receipt: false });
  let called = false;
  const result = planDevDraft(project, { run, taskKind: 'art-concept', brief: 'brief.md' },
    { discover: () => { called = true; return observedDev; } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(called, false);
});

test('invalid task, linked source and stale brief fail before execution', t => {
  const { project, run } = game(t);
  assert.throws(() => planDevDraft(project, { run, taskKind: 'image', brief: 'brief.md' }),
    /DEV_TASK_INVALID/);
  assert.throws(() => planDevDraft(project, { run: '', taskKind: 'episode-script', brief: 'brief.md' }),
    /DEV_TASK_INVALID/);
  const resolved = planDevDraft(project, { run: 'latest', taskKind: 'episode-script', brief: 'brief.md' });
  assert.equal(resolved.runId, run);
  assert.equal(resolved.manualPacket.runId, run);
  fs.symlinkSync(path.join(project, 'brief.md'), path.join(project, 'link.md'));
  assert.equal(planDevDraft(project, { run, taskKind: 'episode-script', brief: 'link.md' }).status, 'BLOCKED');
  const plan = planDevDraft(project, { run, taskKind: 'episode-script', brief: 'brief.md' });
  fs.writeFileSync(path.join(project, 'brief.md'), 'Changed after preview');
  assert.deepEqual(verifyDevDraftPlan(plan), { ok: false, code: 'DEV_SOURCE_STALE' });
});

test('missing, oversized, binary and linked-parent source files are rejected without a host call', t => {
  const { project, run } = game(t);
  let calls = 0;
  const attempt = brief => planDevDraft(project, { run, taskKind: 'episode-script', brief },
    { discover: () => { calls++; return observedDev; } });
  assert.equal(attempt('missing.md').status, 'BLOCKED');
  fs.writeFileSync(path.join(project, 'huge.md'), 'X'.repeat(64 * 1024 + 1));
  assert.equal(attempt('huge.md').reasonCode, 'DEV_SOURCE_TOO_LARGE');
  fs.writeFileSync(path.join(project, 'binary.md'), Buffer.from([0xff, 0xfe, 0x00]));
  assert.equal(attempt('binary.md').reasonCode, 'DEV_BRIEF_INVALID_TEXT');
  fs.symlinkSync(project, path.join(project, 'linked'), 'dir');
  assert.equal(attempt('linked/brief.md').status, 'BLOCKED');
  assert.equal(calls, 0);
});

test('a near-limit brief cannot overflow the helper prompt after journaling intent', t => {
  const { project, run } = game(t);
  fs.writeFileSync(path.join(project, 'brief.md'), 'x'.repeat(64 * 1024 - 16));
  let discovered = false;
  const plan = planDevDraft(project, { run, taskKind: 'episode-script', brief: 'brief.md' },
    { discover: () => { discovered = true; return observedDev; } });
  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.reasonCode, 'DEV_PROMPT_TOO_LARGE');
  assert.equal(discovered, false);
  assert.equal((fs.readdirSync(path.join(project, '.ludory', 'ai', 'runs', run))).includes('drafts'), false);
});

test('selected reference text is actually present in the source-bound host envelope', async t => {
  const { project, run } = game(t);
  const plan = planDevDraft(project, { run, taskKind: 'episode-script', brief: 'brief.md',
    sources: ['src/main.js'] }, { discover: () => observedDev });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.manualPacket.sources[0].text, '// Original user code\n');
  const result = await executeDevDraft(plan, { apply: true, host: observedHost(async request => {
    assert.match(request.prompt, /Original user code/);
    return { status: 'HOST_OBSERVED', text: 'Scene draft, unreviewed',
      modelObserved: 'gpt-6-sol', routeObserved: 'web-dev' };
  }) });
  assert.equal(result.status, 'PENDING_REVIEW');
});

test('forged or inaccessible host capability is never treated as host-observed', t => {
  const { project, run } = game(t);
  const inherited = Object.create(observedDev);
  for (const host of [inherited, { ...observedDev, routeObserved: 'manual' },
    { ...observedDev, modelObserved: null },
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('revoked'); } })]) {
    const result = planDevDraft(project, { run, taskKind: 'art-concept', brief: 'brief.md' },
      { discover: () => host });
    assert.equal(result.status, 'NEEDS_USER_ACTION');
    assert.equal(result.selectedRoute, 'manual');
    assert.equal(result.modelObserved, undefined);
  }
});

function readyDraft(project, run) {
  return planDevDraft(project, { run, taskKind: 'episode-script', brief: 'brief.md' },
    { discover: () => observedDev });
}

const observedHost = (turn = async () => ({ status: 'HOST_OBSERVED', text: 'Draft dialogue\nNot reviewed.',
  modelObserved: 'gpt-6-sol', routeObserved: 'web-dev' })) => ({
  probe: async () => observedDev, turn,
});

test('explicit DEV apply journals a request before host turn and preserves an unapproved immutable draft', async t => {
  const { project, run } = game(t);
  const plan = readyDraft(project, run);
  const preview = await executeDevDraft(plan, { host: observedHost() });
  assert.equal(preview.status, 'READY');
  assert.equal(fs.existsSync(path.join(project, '.ludory', 'ai', 'runs', run, 'drafts')), false);
  let called = 0;
  const result = await executeDevDraft(plan, { apply: true, host: observedHost(async request => {
    called++;
    const state = (await import('../src/store.mjs')).readNativeRun(project, run);
    assert.equal(state.pendingExecutor, 'web-dev');
    assert.equal(state.events.at(-1).request.taskKind, 'episode-script');
    assert.equal(request.taskId, run);
    assert.match(request.prompt, /boat reaches the port/);
    return { status: 'HOST_OBSERVED', text: 'Draft dialogue\nNot reviewed.',
      modelObserved: 'gpt-6-sol', routeObserved: 'web-dev' };
  }) });
  assert.equal(called, 1);
  assert.equal(result.status, 'PENDING_REVIEW');
  assert.equal(result.provenance, 'HOST_OBSERVED');
  assert.equal(result.modelObserved, 'gpt-6-sol');
  const state = (await import('../src/store.mjs')).readNativeRun(project, run);
  assert.equal(state.status, 'EXECUTED_UNVERIFIED');
  assert.equal(state.pendingExecutor, null);
  assert.equal(state.events.at(-1).result.code, 'HOST_OBSERVED');
  assert.equal(state.events.at(-1).result.outputSha256, sha256('Draft dialogue\nNot reviewed.'));
  assert.equal(fs.readFileSync(path.join(project, state.events.at(-1).result.outputPath), 'utf8'),
    'Draft dialogue\nNot reviewed.');
  assert.equal(state.nextStage, plan.stage);
  await assert.rejects(executeDevDraft(plan, { apply: true, host: observedHost() }), /STALE|REQUEST|BLOCKED/);
});

test('unwitnessed host route is rejected before request; stale source cannot reach the helper', async t => {
  const { project, run } = game(t);
  const plan = readyDraft(project, run);
  let called = false;
  // Set a forged-looking probe result; a host turn must remain unreachable.
  const forged = { ...observedDev, modelObserved: 'gpt-6-terra' };
  await assert.rejects(executeDevDraft(plan, { apply: true, host: { probe: async () => forged,
    turn: async () => { called = true; } } }), /DEV_ROUTE_UNVERIFIED/);
  assert.equal(called, false);
  fs.writeFileSync(path.join(project, 'brief.md'), 'Changed since preview');
  await assert.rejects(executeDevDraft(plan, { apply: true, host: observedHost() }), /DEV_SOURCE_STALE/);
  assert.equal((await import('../src/store.mjs')).readNativeRun(project, run).events.length, 0);
});

test('uncertain host timeout remains pending, blocks duplicate invocation and checkpoint', async t => {
  const { project, run } = game(t);
  const plan = readyDraft(project, run);
  await assert.rejects(executeDevDraft(plan, { apply: true, host: observedHost(async () => {
    throw new Error('DEV_HELPER_TIMEOUT');
  }) }), /DEV_HELPER_TIMEOUT/);
  const { readNativeRun, planNativeEvent } = await import('../src/store.mjs');
  const state = readNativeRun(project, run);
  assert.equal(state.pendingExecutor, 'web-dev');
  assert.equal(state.status, 'WAITING_FOR_EVIDENCE');
  assert.throws(() => planNativeEvent(project, run,
    { kind: 'CHECKPOINT', stage: state.nextStage, artifacts: [], outcome: 'CONTINUE' }), /PENDING/);
  await assert.rejects(executeDevDraft(plan, { apply: true, host: observedHost() }), /STALE|PENDING/);
});

test('invalid host text and model mismatch do not create accepted drafts', async t => {
  for (const response of [
    { status: 'HOST_OBSERVED', text: ' ', modelObserved: 'gpt-6-sol', routeObserved: 'web-dev' },
    { status: 'HOST_OBSERVED', text: 'x'.repeat(262145), modelObserved: 'gpt-6-sol', routeObserved: 'web-dev' },
    { status: 'HOST_OBSERVED', text: 'Narrative PASS', modelObserved: 'gpt-6-terra', routeObserved: 'web-dev' },
  ]) {
    const { project, run } = game(t);
    const result = await executeDevDraft(readyDraft(project, run), { apply: true,
      host: observedHost(async () => response) });
    assert.equal(result.status, 'BLOCKED');
    const state = (await import('../src/store.mjs')).readNativeRun(project, run);
    assert.equal(state.status, 'EXECUTION_FAILED');
    assert.equal(state.events.at(-1).result.code, 'DEV_EXECUTOR_UNVERIFIED');
    assert.equal(fs.existsSync(path.join(project, '.ludory', 'ai', 'runs', run, 'drafts')), false);
  }
});

test('draft bytes remain integrity-bound; altered stored output is not accepted on reread', async t => {
  const { project, run } = game(t);
  const accepted = await executeDevDraft(readyDraft(project, run),
    { apply: true, host: observedHost() });
  fs.writeFileSync(path.join(project, accepted.output.outputPath), 'Replaced draft');
  const { readNativeRun } = await import('../src/store.mjs');
  assert.throws(() => readNativeRun(project, run), /NATIVE_INTEGRITY_EXECUTION_RESULT/);
});

test('a swapped draft parent cannot receive generated text; request stays pending', async t => {
  const { project, run } = game(t);
  const outside = fs.mkdtempSync(path.join(project, 'foreign-'));
  const drafts = path.join(project, '.ludory', 'ai', 'runs', run, 'drafts');
  fs.symlinkSync(outside, drafts, 'dir');
  await assert.rejects(executeDevDraft(readyDraft(project, run),
    { apply: true, host: observedHost() }), /NATIVE_STORAGE_FOREIGN_PATH/);
  const { readNativeRun } = await import('../src/store.mjs');
  assert.equal(readNativeRun(project, run).pendingExecutor, 'web-dev');
  assert.equal(fs.readdirSync(outside).length, 0);
});

test('pending DEV timeout requires an explicit stopped-helper recovery, never an automatic retry', async t => {
  const { project, run } = game(t);
  await assert.rejects(executeDevDraft(readyDraft(project, run), { apply: true,
    host: observedHost(async () => { throw new Error('DEV_HELPER_TIMEOUT'); }) }), /DEV_HELPER_TIMEOUT/);
  const { planWorkflow, executeWorkflow } = await import('../src/workflows.mjs');
  const uncertain = planWorkflow(project, 'recover', { run });
  assert.equal(uncertain.status, 'READY');
  assert.equal(uncertain.requiresConfirmation, true);
  assert.equal(executeWorkflow(uncertain, { apply: true }).status, 'BLOCKED');
  const confirmed = planWorkflow(project, 'recover', { run, confirmNoExecutor: true });
  assert.match(confirmed.warning, /DEV/i);
  const recovered = executeWorkflow(confirmed, { apply: true });
  assert.equal(recovered.status, 'APPLIED');
  const state = (await import('../src/store.mjs')).readNativeRun(project, run);
  assert.equal(state.pendingExecutor, null);
  assert.equal(state.status, 'EXECUTION_FAILED');
  assert.equal(state.events.at(-1).result.code, 'DEV_EXECUTOR_INTERRUPTED');
  assert.equal(readyDraft(project, run).status, 'READY');
});

test('source edits between result preview and commit cannot forge a source-bound DEV receipt', async t => {
  const { project, run } = game(t);
  const plan = readyDraft(project, run);
  await executeDevDraft(plan, { apply: true, host: observedHost() });
  const { readNativeRun, planNativeEvent, commitNativeEvent } = await import('../src/store.mjs');
  const accepted = readNativeRun(project, run);
  assert.equal(accepted.reviewPending, true);
  // An existing, accepted draft cannot be silently relabelled after mutation.
  assert.equal(accepted.events.at(-1).result.code, 'HOST_OBSERVED');
  const retryGame = game(t);
  const retryPlan = readyDraft(retryGame.project, retryGame.run);
  const request = planNativeEvent(retryGame.project, retryGame.run, { kind: 'ACTION_REQUESTED',
    stage: retryPlan.stage, executor: 'web-dev', request: { taskKind: retryPlan.taskKind,
      route: 'web-dev', modelObserved: retryPlan.modelObserved,
      brief: retryPlan.brief, sources: retryPlan.sources } });
  fs.writeFileSync(path.join(retryGame.project, 'brief.md'), 'Changed after event preview');
  assert.throws(() => commitNativeEvent(request), /NATIVE_DEV_SOURCE_STALE/);
  assert.equal(readNativeRun(retryGame.project, retryGame.run).events.length, 0);
});

test('manual draft staging collision never strands future legitimate imports', async t => {
  const { project, run } = game(t);
  const { commitNativeManualDraftArtifact, readNativeRun } = await import('../src/store.mjs');
  fs.writeFileSync(path.join(project, 'my-draft.md'), 'Declared draft content');
  const plan = planDevDraftImport(project, { run, taskKind: 'episode-script',
    brief: 'brief.md', file: 'my-draft.md' });
  const before = readNativeRun(project, run).headSha256;
  const first = commitNativeManualDraftArtifact(project, run, before,
    { taskKind: 'episode-script', source: plan.source });
  const second = commitNativeManualDraftArtifact(project, run, before,
    { taskKind: 'episode-script', source: plan.source });
  assert.notEqual(first.outputPath, second.outputPath);
  const applied = executeDevDraftImport(plan, { apply: true });
  assert.equal(applied.provenance, 'USER_DECLARED');
  assert.equal(readNativeRun(project, run).events.length, 1);
});
