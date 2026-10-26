import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { game } from './helpers/image-game.mjs';
import { png } from './helpers/images.mjs';
import { planImageTask, executeImageTask } from '../src/image-tasks.mjs';
import { readNativeRun } from '../src/store.mjs';

const gpt = model => ({ available: true, reasonCode: 'IMAGE_PROVIDER_CONFIGURED',
  provider: 'openai', routeObserved: 'gpt-image', transportConfigured: true,
  paidAuthorized: true, imageGenCallable: true, modelRequested: model, modelObserved: null });
const provider = (generate = async request => ({ status: 'HOST_OBSERVED', provider: 'openai',
  routeObserved: 'gpt-image', modelRequested: request.model, modelObserved: null,
  images: [{ bytes: png, mediaType: 'image/png' }] })) => ({
  probe: async ({ model }) => ({ gptImage: gpt(model) }), generate,
});

test('GPT Image is selected independently from the Web DEV / primary task model, with requested rather than observed model', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md' },
    { discover: async () => ({ imageGpt: gpt('gpt-image-2.5-sunburst') }) });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.selectedRoute, 'gpt-image');
  assert.equal(plan.modelRequested, 'gpt-image-2.5-sunburst');
  assert.equal(plan.modelObserved, null);
  assert.equal(plan.brief.path, 'image-brief.md');
  assert.equal(readNativeRun(project, run).events.length, 0);
});

test('one GPT Image call produces immutable PNG originals, preserves unknown effective model and requires separate art review', async t => {
  const { project, run } = game(t);
  const host = provider(async request => {
    assert.equal(request.model, 'gpt-image-2.5-sunburst');
    assert.equal(request.prompt, 'Scene: lighthouse over a winter sea.');
    assert.equal(readNativeRun(project, run).pendingExecutor, 'image-gen');
    return { status: 'HOST_OBSERVED', provider: 'openai', routeObserved: 'gpt-image',
      modelRequested: request.model, modelObserved: null,
      images: [{ bytes: png, mediaType: 'image/png' }] };
  });
  const plan = await planImageTask(project, { run, brief: 'image-brief.md' },
    { discover: async () => ({ imageGpt: gpt('gpt-image-2.5-sunburst') }) });
  const result = await executeImageTask(plan, { apply: true, host });
  assert.equal(result.status, 'PENDING_REVIEW');
  assert.equal(result.modelObserved, null);
  assert.deepEqual(fs.readFileSync(path.join(project, result.images[0].outputPath)), png);
  const receipt = readNativeRun(project, run);
  assert.equal(receipt.events[0].request.modelRequested, 'gpt-image-2.5-sunburst');
  assert.equal(receipt.events[0].request.modelObserved, null);
  assert.equal(receipt.events[1].result.images[0].modelObserved, null);
  assert.equal(receipt.reviewPending, true);
  assert.equal(fs.readFileSync(path.join(project, 'src/main.js'), 'utf8'), '// Original user code\n');
});

test('pinned Flare cannot silently change to Sunburst on host probe', async t => {
  const { project, run } = game(t);
  const pinned = await planImageTask(project, { run, brief: 'image-brief.md', model: 'flare' },
    { discover: async () => ({ imageGpt: gpt('gpt-image-2.5-sunburst') }) });
  assert.equal(pinned.status, 'NEEDS_USER_ACTION');
  assert.equal(pinned.selectedRoute, 'manual');
});

test('legacy Terra/SOL pins cannot silently switch to the configured GPT Image producer', async t => {
  const { project, run } = game(t);
  const gptOnly = async () => ({ imageGpt: gpt('gpt-image-2.5-sunburst') });
  for (const model of ['terra', 'sol']) {
    const plan = await planImageTask(project, { run, brief: 'image-brief.md', model },
      { discover: gptOnly });
    assert.equal(plan.status, 'NEEDS_USER_ACTION', `${model} must remain pinned`);
    assert.equal(plan.selectedRoute, 'manual');
    assert.equal(plan.preferredRoute, `image-${model}`);
  }
});

test('a GPT Image prompt beyond the API limit is blocked before journaling or provider invocation', async t => {
  const { project, run } = game(t);
  fs.writeFileSync(path.join(project, 'image-brief.md'), 'X'.repeat(32_001));
  const plan = await planImageTask(project, { run, brief: 'image-brief.md' },
    { discover: async () => ({ imageGpt: gpt('gpt-image-2.5-sunburst') }) });
  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.reasonCode, 'IMAGE_BRIEF_PROVIDER_LIMIT');
  assert.equal(readNativeRun(project, run).events.length, 0);
});

test('changed brief blocks GPT Image call before paid request and journal', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md' },
    { discover: async () => ({ imageGpt: gpt('gpt-image-2.5-sunburst') }) });
  fs.writeFileSync(path.join(project, 'image-brief.md'), 'unapproved mutation');
  await assert.rejects(executeImageTask(plan, { apply: true, host: provider(() => {
    throw new Error('unexpected paid call');
  }) }), /STALE/);
  assert.equal(readNativeRun(project, run).events.length, 0);
});

test('failed GPT Image HTTP attempt leaves a pending request and prevents automatic retries', async t => {
  const { project, run } = game(t);
  let calls = 0;
  const host = provider(async () => { calls++; throw new Error('IMAGE_PROVIDER_HTTP_FAILED'); });
  const plan = await planImageTask(project, { run, brief: 'image-brief.md' },
    { discover: async () => ({ imageGpt: gpt('gpt-image-2.5-sunburst') }) });
  await assert.rejects(executeImageTask(plan, { apply: true, host }), /IMAGE_PROVIDER_HTTP_FAILED/);
  assert.equal(readNativeRun(project, run).pendingExecutor, 'image-gen');
  await assert.rejects(executeImageTask(plan, { apply: true, host }), /STALE|PENDING/);
  assert.equal(calls, 1);
});

test('a forged host response claiming a different model cannot grant HOST_OBSERVED', async t => {
  const { project, run } = game(t);
  const plan = await planImageTask(project, { run, brief: 'image-brief.md' },
    { discover: async () => ({ imageGpt: gpt('gpt-image-2.5-sunburst') }) });
  const result = await executeImageTask(plan, { apply: true, host: provider(async () => ({
    status: 'HOST_OBSERVED', routeObserved: 'gpt-image', provider: 'openai',
    modelRequested: 'gpt-image-2.5-flare', modelObserved: 'gpt-image-2.5-sunburst',
    images: [{ bytes: png, mediaType: 'image/png' }],
  })) });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(readNativeRun(project, run).status, 'EXECUTION_FAILED');
});
