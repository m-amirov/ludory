import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { game } from './helpers/image-game.mjs';
import { inspectNativeProject, snapshotArtifact } from '../src/source.mjs';
import { readNativeRun, planNativeEvent, commitNativeEvent, stageNativeManualImage,
  stageNativeImageArtifacts } from '../src/store.mjs';
import { png } from './helpers/images.mjs';

// Seed faithful hash-chained historical events independently of current writers:
// new native API calls must refuse these retired routes while replay accepts them.
function appendHistoricalEvent(project, run, kind, details) {
  const current = readNativeRun(project, run);
  const source = inspectNativeProject(project);
  const index = current.events.length + 1;
  const event = { schemaVersion: 1, index, prevSha256: current.headSha256,
    kind, stage: current.nextStage, outcome: null, artifacts: [],
    at: '2026-10-26T00:00:00.000Z',
    sourceAtCheckpoint: { gitHead: source.gitHead, manifestSha256: source.manifestSha256 },
    ...details };
  const bytes = `${JSON.stringify(event, null, 2)}\n`;
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const directory = path.join(project, '.ludory', 'ai', 'runs', run, 'events');
  const prefix = String(index).padStart(6, '0');
  fs.writeFileSync(path.join(directory, `${prefix}.json`), bytes, { flag: 'wx' });
  fs.writeFileSync(path.join(directory, `${prefix}.commit.json`), `${JSON.stringify({
    schemaVersion: 1, index, eventSha256: digest,
  }, null, 2)}\n`, { flag: 'wx' });
}

test('new native requests cannot reopen a retired image producer', t => {
  const { project, run } = game(t);
  const current = readNativeRun(project, run);
  assert.throws(() => planNativeEvent(project, run, { kind: 'ACTION_REQUESTED',
    stage: current.nextStage, executor: 'image-gen', request: {
      taskKind: 'image', route: 'gpt-image', requestedModel: 'auto',
      modelRequested: 'gpt-image-2.5-sunburst', modelObserved: null,
      brief: snapshotArtifact(project, 'image-brief.md'),
    } }), /NATIVE_IMAGE_REQUEST_INVALID/);
});

test('previously committed GPT Image action requests remain readable after the API adapter is removed', t => {
  const { project, run } = game(t);
  const state = readNativeRun(project, run);
  const request = { taskKind: 'image', route: 'gpt-image', requestedModel: 'auto',
    modelRequested: 'gpt-image-2.5-sunburst', modelObserved: null,
    brief: snapshotArtifact(project, 'image-brief.md') };
  appendHistoricalEvent(project, run, 'ACTION_REQUESTED', { executor: 'image-gen', request });
  const archived = readNativeRun(project, run);
  assert.equal(archived.events[0].request.modelRequested, 'gpt-image-2.5-sunburst');
  assert.equal(archived.pendingExecutor, 'image-gen');
  assert.equal(archived.integrity.ok, true);
  commitNativeEvent(planNativeEvent(project, run, { kind: 'EXECUTION_RESULT', stage: state.nextStage,
    result: { ok: false, code: 'IMAGE_EXECUTOR_UNVERIFIED', reviewStatus: 'PENDING_REVIEW',
      modelObserved: null, images: [] } }));
  assert.equal(readNativeRun(project, run).status, 'EXECUTION_FAILED');
});

test('legacy manual imports with retired API model pins remain verifiable and review-only', t => {
  const { project, run } = game(t);
  fs.writeFileSync(path.join(project, 'legacy-original.png'), png);
  const current = readNativeRun(project, run);
  const brief = snapshotArtifact(project, 'image-brief.md');
  const source = snapshotArtifact(project, 'legacy-original.png');
  const output = stageNativeManualImage(project, run, current.headSha256, {
    brief, source, requestedModel: 'auto',
  });
  appendHistoricalEvent(project, run, 'IMAGE_IMPORTED', {
    manual: { taskKind: 'image', provenance: 'USER_DECLARED', reviewStatus: 'PENDING_REVIEW',
      requestedModel: 'flare', brief, source, output },
  });
  const archived = readNativeRun(project, run);
  assert.equal(archived.reviewPending, true);
  assert.equal(archived.events[0].manual.requestedModel, 'flare');
  assert.equal(archived.integrity.ok, true);
});

test('previously completed image request receipts remain readable without restoring their producer', t => {
  const { project, run } = game(t);
  const current = readNativeRun(project, run);
  appendHistoricalEvent(project, run, 'ACTION_REQUESTED', { executor: 'image-gen', request: {
      taskKind: 'image', route: 'gpt-image', requestedModel: 'flare',
      modelRequested: 'gpt-image-2.5-flare', modelObserved: null,
      brief: snapshotArtifact(project, 'image-brief.md'),
    } });
  const pending = readNativeRun(project, run);
  const images = stageNativeImageArtifacts(project, run, pending.pendingRequestSha256,
    [{ bytes: png, mediaType: 'image/png' }]);
  appendHistoricalEvent(project, run, 'EXECUTION_RESULT', {
    requestSha256: pending.pendingRequestSha256,
    result: { ok: true, code: 'HOST_OBSERVED', reviewStatus: 'PENDING_REVIEW',
      modelObserved: null, images },
  });
  const archived = readNativeRun(project, run);
  assert.equal(archived.pendingExecutor, null);
  assert.equal(archived.reviewPending, true);
  assert.equal(archived.status, 'EXECUTED_UNVERIFIED');
  assert.equal(archived.events[1].result.images[0].modelObserved, null);
  assert.equal(archived.integrity.ok, true);
});
