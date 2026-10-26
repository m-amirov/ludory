import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { game } from './helpers/image-game.mjs';
import { readNativeRun, planNativeEvent,
  stageNativeManualImage } from '../src/store.mjs';
import { planImageTask, executeImageTask, planImageImport, executeImageImport } from '../src/image-tasks.mjs';
import { planWorkflow, executeWorkflow } from '../src/workflows.mjs';
import { png, jpeg } from './helpers/images.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const terra = { available: true, reasonCode: 'AVAILABLE', transportVerified: true,
  entitlementVerified: true, imageGenCallable: true, routeObserved: 'image-gen',
  attestationScope: 'live-execution-context', modelObserved: 'gpt-6-terra' };
export const sol = { ...terra, modelObserved: 'gpt-6-sol' };

test('image preview is read-only, source-bound, built-in skill handoff by default and blocks frozen games', async t => {
  const { project, run } = game(t);
  const before = fs.readdirSync(path.join(project, '.ludory', 'ai', 'runs', run));
  const plan = await planImageTask(project, { run, brief: 'image-brief.md' });
  assert.equal(plan.status, 'NEEDS_AGENT_ACTION');
  assert.equal(plan.selectedRoute, 'codex-imagegen');
  assert.equal(plan.manualPacket.brief.sha256, sha('Scene: lighthouse over a winter sea.'));
  assert.deepEqual(fs.readdirSync(path.join(project, '.ludory', 'ai', 'runs', run)), before);
  const frozen = game(t, false);
  let called = false;
  const blocked = await planImageTask(frozen.project, { run: frozen.run, brief: 'image-brief.md' },
    { discover: () => { called = true; } });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(called, false);
});

test('legacy Terra/SOL producer is supported only with an explicit pin', async t => {
  const { project, run } = game(t);
  const found = async () => ({ imageTerra: terra, imageSol: sol });
  assert.equal((await planImageTask(project, { run, brief: 'image-brief.md' }, { discover: found })).selectedRoute, 'codex-imagegen');
  assert.equal((await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover: found })).selectedRoute, 'image-terra');
  const fallback = async () => ({ imageTerra: { available: false }, imageSol: sol });
  assert.equal((await planImageTask(project, { run, brief: 'image-brief.md', model: 'sol' }, { discover: fallback })).selectedRoute, 'image-sol');
  const pin = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover: fallback });
  assert.equal(pin.status, 'NEEDS_USER_ACTION');
  assert.equal(pin.selectedRoute, 'manual');
  assert.equal(pin.reasonCode, 'IMAGE_PINNED_MODEL_UNAVAILABLE');
  assert.equal((await planImageTask(project, { run, brief: 'image-brief.md', model: 'sol' }, { discover: found })).selectedRoute, 'image-sol');
});

test('image plan rejects symlinked, oversized, binary briefs and stale paths', async t => {
  const { project, run } = game(t);
  await assert.rejects(planImageTask(project, { run, brief: '../secret' }), /IMAGE_TASK_INVALID/);
  fs.symlinkSync(path.join(project, 'image-brief.md'), path.join(project, 'link.md'));
  assert.equal((await planImageTask(project, { run, brief: 'link.md' })).status, 'BLOCKED');
  fs.writeFileSync(path.join(project, 'huge.md'), 'x'.repeat(64 * 1024 + 1));
  assert.equal((await planImageTask(project, { run, brief: 'huge.md' })).status, 'BLOCKED');
  fs.writeFileSync(path.join(project, 'binary.md'), Buffer.from([0xff, 0x00]));
  assert.equal((await planImageTask(project, { run, brief: 'binary.md' })).status, 'BLOCKED');
});

const route = ({ terraReady = true, solReady = true } = {}) => ({
  probe: async () => ({ terra: terraReady ? terra : null, sol: solReady ? sol : null }),
  generate: async () => { throw new Error('not configured'); },
});
const discover = async () => ({ imageTerra: terra, imageSol: sol });

test('an image generation attempt is journaled before invocation; timeout cannot silently retry via SOL', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  let calls = 0;
  const host = { ...route(), generate: async ({ model, requestSha256 }) => {
    calls++;
    assert.equal(model, 'terra');
    assert.match(requestSha256, /^[0-9a-f]{64}$/);
    assert.equal(readNativeRun(project, run).pendingExecutor, 'image-gen');
    throw new Error('IMAGE_HOST_TIMEOUT');
  } };
  await assert.rejects(executeImageTask(plan, { apply: true, host }), /IMAGE_HOST_TIMEOUT/);
  assert.equal(calls, 1);
  assert.equal(readNativeRun(project, run).pendingExecutor, 'image-gen');
  assert.equal(readNativeRun(project, run).events.length, 1);
  await assert.rejects(executeImageTask(plan, { apply: true, host }), /STALE|PENDING/);
  assert.equal(calls, 1);
});

test('a host that never settles still reaches the bounded timeout without relying on external event-loop activity', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  await assert.rejects(executeImageTask(plan, { apply: true, timeoutMs: 25, host: {
    ...route(), generate: async () => new Promise(() => {}),
  } }), /IMAGE_HOST_TIMEOUT/);
  assert.equal(readNativeRun(project, run).pendingExecutor, 'image-gen');
});

test('invalid or partial host response records failure without a second model attempt', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  const calls = [];
  const result = await executeImageTask(plan, { apply: true, host: { ...route(),
    generate: async request => { calls.push(request.model); return { status: 'PARTIAL', images: [] }; },
  } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reasonCode, 'IMAGE_EXECUTOR_UNVERIFIED');
  assert.deepEqual(calls, ['terra']);
  const state = readNativeRun(project, run);
  assert.equal(state.pendingExecutor, null);
  assert.equal(state.status, 'EXECUTION_FAILED');
  assert.equal(state.events[1].result.code, 'IMAGE_EXECUTOR_UNVERIFIED');
});

test('a changed brief or forged plan cannot launch or commit image production', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  const host = { ...route(), generate: async () => { throw new Error('unexpected generate'); } };
  fs.writeFileSync(path.join(project, 'image-brief.md'), 'modified');
  await assert.rejects(executeImageTask(plan, { apply: true, host }), /STALE/);
  assert.equal(readNativeRun(project, run).events.length, 0);
});

test('verified producer retains exact original bytes and review-only hash-bound receipt', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  const result = await executeImageTask(plan, { apply: true, host: { ...route(),
    generate: async request => ({ status: 'HOST_OBSERVED', routeObserved: 'image-gen',
      attestationScope: 'live-execution-context', imageGenCalled: true,
      modelObserved: request.modelObserved, images: [{ bytes: png, mediaType: 'image/png' }] }),
  } });
  assert.equal(result.status, 'PENDING_REVIEW');
  assert.equal(result.provenance, 'HOST_OBSERVED');
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].outputSha256, sha(png));
  assert.deepEqual(fs.readFileSync(path.join(project, result.images[0].outputPath)), png);
  const current = readNativeRun(project, run);
  assert.equal(current.pendingExecutor, null);
  assert.equal(current.reviewPending, true);
  assert.equal(current.status, 'EXECUTED_UNVERIFIED');
  assert.equal(current.events[1].result.images[0].modelObserved, 'gpt-6-terra');
  assert.equal(fs.readFileSync(path.join(project, 'src/main.js'), 'utf8'), '// Original user code\n');
  assert.equal(fs.existsSync(path.join(project, 'assets')), false);
  fs.writeFileSync(path.join(project, result.images[0].outputPath), 'corrupt');
  assert.throws(() => readNativeRun(project, run), /INTEGRITY/);
});

test('malformed generated image bytes never enter a trusted receipt', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  const result = await executeImageTask(plan, { apply: true, host: { ...route(),
    generate: async request => ({ status: 'HOST_OBSERVED', routeObserved: 'image-gen',
      attestationScope: 'live-execution-context', imageGenCalled: true,
      modelObserved: request.modelObserved, images: [{ bytes: png.subarray(0, -3), mediaType: 'image/png' }] }),
  } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(readNativeRun(project, run).status, 'EXECUTION_FAILED');
  assert.equal(fs.existsSync(path.join(project, '.ludory', 'ai', 'runs', run, 'images')), false);
});

test('a replaced image output parent never receives host bytes; request stays pending', async t => {
  const { project, run } = game(t);
  const outside = fs.mkdtempSync(path.join(project, 'offscope-'));
  const images = path.join(project, '.ludory', 'ai', 'runs', run, 'images');
  fs.symlinkSync(outside, images, 'dir');
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  await assert.rejects(executeImageTask(plan, { apply: true, host: { ...route(),
    generate: async request => ({ status: 'HOST_OBSERVED', routeObserved: 'image-gen',
      attestationScope: 'live-execution-context', imageGenCalled: true,
      modelObserved: request.modelObserved, images: [{ bytes: png, mediaType: 'image/png' }] }),
  } }), /NATIVE_STORAGE_FOREIGN_PATH/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(readNativeRun(project, run).pendingExecutor, 'image-gen');
});

test('a preexisting output filename cannot be replaced by a new producer receipt', async t => {
  const { project, run } = game(t);
  const images = path.join(project, '.ludory', 'ai', 'runs', run, 'images');
  fs.mkdirSync(images);
  const collision = path.join(images, 'image-000001-0.png');
  fs.writeFileSync(collision, 'owned by a different writer');
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  await assert.rejects(executeImageTask(plan, { apply: true, host: { ...route(),
    generate: async request => ({ status: 'HOST_OBSERVED', routeObserved: 'image-gen',
      attestationScope: 'live-execution-context', imageGenCalled: true,
      modelObserved: request.modelObserved, images: [{ bytes: png, mediaType: 'image/png' }] }),
  } }), /EEXIST/);
  assert.equal(fs.readFileSync(collision, 'utf8'), 'owned by a different writer');
  assert.equal(readNativeRun(project, run).pendingExecutor, 'image-gen');
});

test('manual image import preserves original bytes with USER_DECLARED provenance and no inferred model', async t => {
  const { project, run } = game(t);
  fs.writeFileSync(path.join(project, 'candidate.png'), png);
  const preview = await planImageImport(project, { run, brief: 'image-brief.md', file: 'candidate.png' });
  assert.equal(preview.status, 'READY');
  assert.equal(readNativeRun(project, run).events.length, 0);
  const result = await executeImageImport(preview, { apply: true });
  assert.equal(result.status, 'PENDING_REVIEW');
  assert.equal(result.provenance, 'USER_DECLARED');
  assert.equal(result.output.modelObserved, null);
  assert.deepEqual(fs.readFileSync(path.join(project, result.output.outputPath)), png);
  assert.equal(result.output.outputSha256, sha(png));
  const current = readNativeRun(project, run);
  assert.equal(current.reviewPending, true);
  assert.equal(current.events.at(-1).kind, 'IMAGE_IMPORTED');
  assert.equal(current.events.at(-1).manual.provenance, 'USER_DECLARED');
  assert.equal(fs.readFileSync(path.join(project, 'src/main.js'), 'utf8'), '// Original user code\n');
  const repeated = await planImageImport(project, { run, brief: 'image-brief.md', file: 'candidate.png' });
  assert.equal(repeated.status, 'BLOCKED');
});

test('manual import refuses hardlink, symlink, corrupt bytes, stale input and parent link', async t => {
  const { project, run } = game(t);
  const candidate = path.join(project, 'candidate.png');
  fs.writeFileSync(candidate, png);
  fs.symlinkSync(candidate, path.join(project, 'link.png'));
  assert.equal((await planImageImport(project, { run, brief: 'image-brief.md', file: 'link.png' })).status, 'BLOCKED');
  fs.linkSync(candidate, path.join(project, 'hard.png'));
  assert.equal((await planImageImport(project, { run, brief: 'image-brief.md', file: 'hard.png' })).status, 'BLOCKED');
  fs.unlinkSync(path.join(project, 'hard.png'));
  fs.mkdirSync(path.join(project, 'input-dir'));
  fs.symlinkSync(path.join(project, 'input-dir'), path.join(project, 'parent'), 'dir');
  assert.equal((await planImageImport(project, { run, brief: 'image-brief.md', file: 'parent/image.png' })).status, 'BLOCKED');
  fs.writeFileSync(path.join(project, 'corrupt.png'), png.subarray(0, -4));
  assert.equal((await planImageImport(project, { run, brief: 'image-brief.md', file: 'corrupt.png' })).status, 'BLOCKED');
  const ready = await planImageImport(project, { run, brief: 'image-brief.md', file: 'candidate.png' });
  assert.equal(ready.status, 'READY');
  fs.writeFileSync(candidate, png.subarray(0, -3));
  await assert.rejects(executeImageImport(ready, { apply: true }), /STALE|UNSAFE/);
  assert.equal(readNativeRun(project, run).events.length, 0);
});

test('image timeout only recovers after explicit owner confirmation; accepted image asks for art review', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  await assert.rejects(executeImageTask(plan, { apply: true, host: {
    ...route(), generate: async () => { throw new Error('IMAGE_HOST_TIMEOUT'); },
  } }), /TIMEOUT/);
  const blocked = planWorkflow(project, 'recover', { run });
  assert.equal(blocked.status, 'READY');
  assert.match(blocked.warning, /image/i);
  assert.equal(executeWorkflow(blocked, { apply: true }).status, 'BLOCKED');
  const permitted = planWorkflow(project, 'recover', { run, confirmNoExecutor: true });
  executeWorkflow(permitted, { apply: true });
  assert.equal(readNativeRun(project, run).status, 'EXECUTION_FAILED');
  assert.equal(planWorkflow(project, 'next', { run }).nextAction.kind === 'REVIEW_IMAGES', false);
});

test('native event rejects a forged MIME to extension mismatch even when image hash is valid', async t => {
  const { project, run } = game(t);
  fs.writeFileSync(path.join(project, 'candidate.png'), png);
  const plan = await planImageImport(project, { run, brief: 'image-brief.md', file: 'candidate.png' });
  const output = stageNativeManualImage(project, run, plan.runHeadSha256,
    { brief: plan.brief, source: plan.source, requestedModel: 'auto' });
  assert.throws(() => planNativeEvent(project, run, {
    kind: 'IMAGE_IMPORTED', stage: plan.stage,
    manual: { taskKind: 'image', provenance: 'USER_DECLARED', reviewStatus: 'PENDING_REVIEW',
      requestedModel: 'auto', brief: plan.brief, source: plan.source,
      output: { ...output, mediaType: 'image/jpeg' } },
  }), /NATIVE_IMAGE_IMPORT_INVALID|NATIVE_IMAGE_OUTPUT_INVALID/);
});

test('native image result cannot attest a fabricated image file with only matching bytes/hash metadata', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md', model: 'terra' }, { discover });
  const request = planNativeEvent(project, run, { kind: 'ACTION_REQUESTED', stage: plan.stage,
    executor: 'image-gen', request: { taskKind: 'image', route: 'image-terra', requestedModel: 'auto',
      modelObserved: plan.modelObserved, brief: plan.brief },
  });
  const { commitNativeEvent } = await import('../src/store.mjs');
  commitNativeEvent(request);
  const target = `.ludory/ai/runs/${run}/images/image-000001-0.png`;
  fs.mkdirSync(path.join(project, '.ludory', 'ai', 'runs', run, 'images'));
  fs.writeFileSync(path.join(project, target), 'NOT AN IMAGE');
  assert.throws(() => planNativeEvent(project, run, { kind: 'EXECUTION_RESULT', stage: plan.stage,
    result: { ok: true, code: 'HOST_OBSERVED', reviewStatus: 'PENDING_REVIEW',
      modelObserved: plan.modelObserved,
      images: [{ outputPath: target, outputSha256: sha('NOT AN IMAGE'), outputSize: 12,
        mediaType: 'image/png', width: 1, height: 1, modelObserved: plan.modelObserved }] },
  }), /NATIVE_IMAGE_OUTPUT_INVALID|IMAGE_ARTIFACT_/);
});

test('manual native event rejects forged image dimensions and source/output mismatches', async t => {
  const { project, run } = game(t);
  fs.writeFileSync(path.join(project, 'candidate.png'), png);
  fs.writeFileSync(path.join(project, 'other.jpg'), jpeg);
  const plan = await planImageImport(project, { run, brief: 'image-brief.md', file: 'candidate.png' });
  const second = await planImageImport(project, { run, brief: 'image-brief.md', file: 'other.jpg' });
  const output = stageNativeManualImage(project, run, plan.runHeadSha256,
    { brief: plan.brief, source: plan.source, requestedModel: 'auto' });
  const manual = { taskKind: 'image', provenance: 'USER_DECLARED', reviewStatus: 'PENDING_REVIEW',
    requestedModel: 'auto', brief: plan.brief, source: plan.source, output };
  assert.throws(() => planNativeEvent(project, run, { kind: 'IMAGE_IMPORTED', stage: plan.stage,
    manual: { ...manual, output: { ...output, width: 999 } },
  }), /NATIVE_IMAGE_IMPORT_INVALID|NATIVE_IMAGE_OUTPUT_INVALID/);
  assert.throws(() => planNativeEvent(project, run, { kind: 'IMAGE_IMPORTED', stage: plan.stage,
    manual: { ...manual, source: second.source },
  }), /NATIVE_IMAGE_IMPORT_INVALID/);
});
