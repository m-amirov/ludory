import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planQaWebReview } from '../src/qa-review-contract.mjs';
import { inspectQaJournal } from '../src/qa-review-journal.mjs';
import { executeQaWebReview, restartQaWebReview } from '../src/qa-review.mjs';
import { makeQaReviewFixture, qaHash, qaPng, qaObservedResponse } from './helpers/qa-review-fixture.mjs';
import { qaDirectoryDurabilityAvailable } from './helpers/qa-review-durability.mjs';

const durableTest = qaDirectoryDurabilityAvailable ? test : test.skip;

const readyCap = () => ({ available: true, reasonCode: 'AVAILABLE', routeAvailable: 'web-dev',
  modelRouteAvailable: 'chatgpt-web/gpt-6-sol-instant', reasoningRequired: 'low',
  browserObservationV2Available: true,
  preflight: { authenticated: true, newChat: true, solAvailable: true,
    url: 'https://chatgpt.com/c/isolated-test' } });

function fakeWeb(plan, onTurn = () => {}) {
  const calls = [];
  let probes = 0;
  let closes = 0;
  return { calls, get probes() { return probes; }, get closes() { return closes; },
    async probe() { probes++; return readyCap(); },
    async turn(request) {
      calls.push(request);
      const image = plan.images.find(x => x.ref === request.images?.[0]?.ref);
      assert.ok(image, 'One planned image per Web turn');
      assert.equal(request.images.length, 1);
      assert.equal(request.images[0].sha256, image.sha256);
      assert.equal(qaHash(request.images[0].bytes), image.sha256);
      assert.ok(request.images[0].bytes.equals(qaPng));
      assert.match(request.prompt, new RegExp(image.sha256));
      return onTurn({ request, image, index: calls.length - 1 }) ?? qaObservedResponse(image, request.taskId);
    },
    async close() { closes++; },
  };
}

test('preview never probes Web or writes local review files', async t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const host = fakeWeb(plan);
  const output = await executeQaWebReview(plan, { apply: false, outputDir: input.outputDir, host });
  assert.equal(output.status, 'READY');
  assert.equal(host.probes, 0);
  assert.equal(host.calls.length, 0);
  assert.equal(fs.existsSync(input.outputDir), false);
});

durableTest('explicit apply sends five original images in order with separate trusted upload traces', async t => {
  const input = makeQaReviewFixture(t, 'vk-games');
  const plan = planQaWebReview(input);
  const host = fakeWeb(plan);
  const result = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host });
  assert.equal(result.status, 'REVIEWED', JSON.stringify(result, null, 2));
  assert.equal(result.reviewProvenance, 'HOST_OBSERVED');
  assert.equal(result.browserAttested, true);
  assert.equal(result.captureStatus, 'STARTUP_OBSERVED');
  assert.equal(result.actualModeration, 'NOT_RUN');
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(host.probes, 1);
  assert.equal(host.closes, 1);
  assert.equal(host.calls.length, 5);
  assert.deepEqual(host.calls.map(x => x.images[0].ref), plan.images.map(x => x.ref));
  assert.equal(new Set(host.calls.map(x => x.taskId)).size, 5);
  assert.equal(inspectQaJournal(input.outputDir).status, 'RECORDED_REVIEWED');
  assert.equal(inspectQaJournal(input.outputDir).browserAttested, false);
});

durableTest('P0/P1/P2 findings remain findings; they never grant platform moderation or release', async t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const host = fakeWeb(plan, ({ image, request, index }) => {
    const response = qaObservedResponse(image, request.taskId);
    if (index === 2) response.text = JSON.stringify({ schemaVersion: 1,
      imageSha256: image.sha256, imageVisible: true, verdict: 'ISSUES_FOUND',
      summary: 'Low contrast', findings: [{ severity: 'P1', category: 'visual-ux',
        description: 'Text not readable', evidence: 'Mobile scene',
        expected: 'Readable text', observed: 'Text blends into background',
        reproductionSteps: ['Open narrow view'] }] });
    return response;
  });
  const result = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host });
  assert.equal(result.status, 'ISSUES_FOUND');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].policyVerification, 'POLICY_SOURCE_UNVERIFIED');
  assert.equal(result.releaseReady, false);
  assert.equal(inspectQaJournal(input.outputDir).status, 'RECORDED_ISSUES_FOUND');
});

test('unverified host probe cannot create a journal or transmit pixels', async t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const host = fakeWeb(plan);
  host.probe = async () => ({ ...readyCap(), modelRouteAvailable: 'chatgpt-web/gpt-6-sol' });
  const result = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reasonCode, 'QA_REVIEW_HOST_UNVERIFIED');
  assert.equal(host.calls.length, 0);
  assert.equal(fs.existsSync(input.outputDir), false);
});

durableTest('missing actual upload confirmation leaves durable pending intent and never retries', async t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const host = fakeWeb(plan, ({ image, request }) => {
    const response = qaObservedResponse(image, request.taskId);
    response.hostObservation.upload.visibleAttachmentChip = false;
    return response;
  });
  const result = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host });
  assert.equal(result.status, 'PENDING_RECOVERY');
  assert.equal(result.reasonCode, 'QA_REVIEW_VISUAL_ATTESTATION_MISSING');
  assert.equal(host.calls.length, 1);
  const recorded = inspectQaJournal(input.outputDir);
  assert.equal(recorded.status, 'PENDING_RECOVERY');
  assert.equal(recorded.pending.imageIndex, 0);
  assert.equal(recorded.images.length, 0);
  const duplicate = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host: fakeWeb(plan) });
  assert.equal(duplicate.status, 'BLOCKED');
});

durableTest('host failure after intent publication leaves PENDING_RECOVERY and no second image call', async t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const host = fakeWeb(plan, () => { throw new Error('browser timeout'); });
  const result = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host });
  assert.equal(result.status, 'PENDING_RECOVERY');
  assert.equal(host.calls.length, 1);
  assert.equal(inspectQaJournal(input.outputDir).pending.imageIndex, 0);
});

test('REQUESTED directory flush failure prevents Web upload even when event file exists', async t => {
  if (!qaDirectoryDurabilityAvailable) return t.skip('Verified directory fsync is unavailable');
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const host = fakeWeb(plan);
  const original = fs.fsyncSync;
  let denied = false;
  fs.fsyncSync = function (fd) {
    if (!denied && fs.fstatSync(fd).isDirectory() &&
        fs.existsSync(path.join(input.outputDir, '000001.json'))) {
      denied = true;
      throw new Error('directory flush denied');
    }
    return original.call(this, fd);
  };
  let result;
  try { result = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host }); }
  finally { fs.fsyncSync = original; }
  assert.equal(denied, true);
  assert.equal(result.status, 'PENDING_RECOVERY');
  assert.equal(host.calls.length, 0);
  assert.equal(inspectQaJournal(input.outputDir).pending.imageIndex, 0);
});

durableTest('source changes between observed turns prevent any further Web upload', async t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const host = fakeWeb(plan, ({ image, request, index }) => {
    if (index === 0) fs.writeFileSync(plan.images[1].file, 'modified by owner');
    return qaObservedResponse(image, request.taskId);
  });
  const result = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host });
  assert.equal(result.status, 'PENDING_RECOVERY');
  assert.equal(host.calls.length, 1);
  assert.equal(inspectQaJournal(input.outputDir).images.length, 1);
});

durableTest('owner-confirmed restart rechecks source, uses new traces and reviews all five again', async t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const failedHost = fakeWeb(plan, () => { throw new Error('lost browser response'); });
  const failed = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host: failedHost });
  assert.equal(failed.status, 'PENDING_RECOVERY');
  const newOutput = path.join(input.folder, 'restart-session');
  const nextHost = fakeWeb(plan);
  const noConfirm = await restartQaWebReview(input, { previousOutput: input.outputDir,
    outputDir: newOutput, apply: true, host: nextHost });
  assert.equal(noConfirm.status, 'PENDING_RECOVERY');
  assert.equal(fs.existsSync(newOutput), false);
  assert.equal(nextHost.calls.length, 0);
  const result = await restartQaWebReview(input, { previousOutput: input.outputDir,
    outputDir: newOutput, confirmReviewerStopped: true, apply: true, host: nextHost });
  assert.equal(result.status, 'REVIEWED', JSON.stringify(result, null, 2));
  assert.equal(nextHost.calls.length, 5);
  const previous = inspectQaJournal(input.outputDir);
  const restarted = inspectQaJournal(newOutput);
  assert.notEqual(previous.sessionId, restarted.sessionId);
  assert.equal(previous.status, 'PENDING_RECOVERY');
  assert.equal(restarted.status, 'RECORDED_REVIEWED');
  assert.notEqual(previous.pending.traceId, nextHost.calls[0].taskId);
  assert.equal(result.actualModeration, 'NOT_RUN');
});

test('unsupported host directory fsync blocks before any Web pixel transmission', async t => {
  if (qaDirectoryDurabilityAvailable) return t.skip('Host supports directory durability');
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const host = fakeWeb(plan);
  const output = await executeQaWebReview(plan, { apply: true, outputDir: input.outputDir, host });
  assert.equal(output.status, 'BLOCKED');
  assert.equal(output.reasonCode, 'QA_JOURNAL_DIRECTORY_DURABILITY_UNVERIFIED');
  assert.equal(host.calls.length, 0);
});
