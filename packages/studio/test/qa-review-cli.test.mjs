import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { planQaWebReview } from '../src/qa-review-contract.mjs';
import { inspectQaJournal } from '../src/qa-review-journal.mjs';
import { makeQaReviewFixture, qaObservedResponse, qaHash } from './helpers/qa-review-fixture.mjs';
import { qaDirectoryDurabilityAvailable } from './helpers/qa-review-durability.mjs';

const durableTest = qaDirectoryDurabilityAvailable ? test : test.skip;

const cap = { available: true, reasonCode: 'AVAILABLE', routeAvailable: 'web-dev',
  modelRouteAvailable: 'chatgpt-web/gpt-6-sol-instant', reasoningRequired: 'low',
  browserObservationV2Available: true,
  preflight: { authenticated: true, newChat: true, solAvailable: true,
    url: 'https://chatgpt.com/c/fake-cli-test' } };

const reviewArgs = input => [
  '--target', input.target, '--archive', input.archivePath, '--receipt', input.receiptPath,
  '--metadata', input.metadataPath, '--promo-root', input.promoRoot,
  '--evidence-dir', input.evidenceDir, '--sdk-evidence', input.sdkEvidencePath,
  '--rights', input.rightsPath,
];

async function invoke(argv, devHost = () => { throw new Error('unexpected Web invocation'); }) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, { out: part => { stdout += part; },
    err: part => { stderr += part; }, devHost });
  return { code, stdout, stderr, data: argv.includes('--json') ? JSON.parse(stdout) : undefined };
}

function fakeHost(plan) {
  const calls = [];
  let closed = 0;
  return { calls, get closed() { return closed; },
    async probe() { return cap; },
    async turn(request) {
      calls.push(request);
      assert.equal(request.images.length, 1);
      const image = plan.images.find(item => item.ref === request.images[0].ref);
      assert.ok(image);
      assert.equal(qaHash(request.images[0].bytes), image.sha256);
      return qaObservedResponse(image, request.taskId);
    },
    async close() { closed++; },
  };
}

test('help advertises explicit sequential Web review, status and owner-confirmed restart', async () => {
  const { code, stdout } = await invoke(['help']);
  assert.equal(code, 0);
  assert.match(stdout, /qa review --target/);
  assert.match(stdout, /qa review-status --output/);
  assert.match(stdout, /qa review-restart --target/);
});

test('qa review JSON preview is read-only and never discovers a Web host', async t => {
  const input = makeQaReviewFixture(t);
  const preview = await invoke(['qa', 'review', ...reviewArgs(input), '--output', input.outputDir, '--json']);
  assert.equal(preview.code, 0, preview.stderr);
  assert.equal(preview.data.status, 'READY');
  assert.equal(preview.data.images.length, 5);
  assert.equal(preview.data.reviewerModel, 'chatgpt-web/gpt-6-sol-instant');
  assert.equal(preview.data.releaseReady, false);
  assert.equal(fs.existsSync(input.outputDir), false);
});

test('human preview names each original and its digest, plus selected Web model and effort', async t => {
  const input = makeQaReviewFixture(t);
  const result = await invoke(['qa', 'review', ...reviewArgs(input), '--output', input.outputDir]);
  assert.equal(result.code, 0);
  for (const name of ['desktop-1000x720', 'mobile-390x844', 'landscape-667x375', 'icon', 'cover']) {
    assert.match(result.stdout, new RegExp(name));
  }
  assert.match(result.stdout, /gpt-6-sol-instant/);
  assert.match(result.stdout, /low/);
  assert.match(result.stdout, /[a-f0-9]{64}/);
});

durableTest('CLI normalizes relative output paths, including help-documented restart/status workflow', async t => {
  const input = makeQaReviewFixture(t);
  const relativeOutput = path.relative(process.cwd(), input.outputDir);
  const plan = planQaWebReview(input);
  const host = fakeHost(plan);
  const run = await invoke(['qa', 'review', ...reviewArgs(input), '--output', relativeOutput,
    '--apply', '--json'], () => host);
  assert.equal(run.code, 0, JSON.stringify(run.data));
  assert.equal(run.data.status, 'REVIEWED');
  const status = await invoke(['qa', 'review-status', '--output', relativeOutput, '--json']);
  assert.equal(status.code, 0, JSON.stringify(status.data));
  assert.equal(status.data.status, 'RECORDED_REVIEWED');
});

durableTest('qa review --apply uses exactly five one-image attested turns and local status loses host authority', async t => {
  const input = makeQaReviewFixture(t, 'vk-games');
  const plan = planQaWebReview(input);
  const host = fakeHost(plan);
  let created = 0;
  const result = await invoke(['qa', 'review', ...reviewArgs(input), '--output', input.outputDir,
    '--apply', '--json'], () => { created++; return host; });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.data.status, 'REVIEWED');
  assert.equal(result.data.browserAttested, true);
  assert.equal(result.data.reviewProvenance, 'HOST_OBSERVED');
  assert.equal(result.data.actualModeration, 'NOT_RUN');
  assert.equal(result.data.publicationAllowed, false);
  assert.equal(created, 1);
  assert.equal(host.calls.length, 5);
  assert.equal(host.closed, 1);
  const recorded = await invoke(['qa', 'review-status', '--output', input.outputDir, '--json']);
  assert.equal(recorded.code, 0, recorded.stderr);
  assert.equal(recorded.data.status, 'RECORDED_REVIEWED');
  assert.equal(recorded.data.browserAttested, false);
  assert.equal(recorded.data.reviewProvenance, 'LOCAL_RECORD_ONLY');
  assert.equal(recorded.data.releaseReady, false);
});

durableTest('a reviewer timeout produces pending recovery; restart requires confirmation and fresh output', async t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const failingHost = fakeHost(plan);
  failingHost.turn = async request => {
    failingHost.calls.push(request);
    throw new Error('lost browser');
  };
  const first = await invoke(['qa', 'review', ...reviewArgs(input), '--output', input.outputDir,
    '--apply', '--json'], () => failingHost);
  assert.equal(first.code, 3);
  assert.equal(first.data.status, 'PENDING_RECOVERY');
  assert.equal(inspectQaJournal(input.outputDir).pending.imageIndex, 0);
  const replacement = path.join(input.folder, 'review-restart');
  const blocked = await invoke(['qa', 'review-restart', ...reviewArgs(input),
    '--previous', input.outputDir, '--output', replacement, '--apply', '--json']);
  assert.equal(blocked.code, 3);
  assert.equal(blocked.data.reasonCode, 'QA_REVIEW_RESTART_CONFIRMATION_REQUIRED');
  assert.equal(fs.existsSync(replacement), false);
  const successHost = fakeHost(plan);
  const restored = await invoke(['qa', 'review-restart', ...reviewArgs(input),
    '--previous', input.outputDir, '--output', replacement,
    '--confirm-reviewer-stopped', '--apply', '--json'], () => successHost);
  assert.equal(restored.code, 0, restored.stderr);
  assert.equal(restored.data.status, 'REVIEWED');
  assert.equal(successHost.calls.length, 5);
  assert.notEqual(inspectQaJournal(input.outputDir).sessionId, inspectQaJournal(replacement).sessionId);
});

test('unknown, duplicate or absent flags are rejected without Web calls or filesystem writes', async t => {
  const input = makeQaReviewFixture(t);
  for (const extra of [['--auto-retry'], ['--apply', '--apply'], ['--apply', '--unknown']]) {
    const bad = await invoke(['qa', 'review', ...reviewArgs(input), '--output', input.outputDir,
      ...extra, '--json']);
    assert.equal(bad.code, 1);
    assert.equal(bad.data.status, 'FAILED');
    assert.equal(fs.existsSync(input.outputDir), false);
  }
  const absent = await invoke(['qa', 'review', ...reviewArgs(input), '--apply', '--json']);
  assert.equal(absent.code, 1);
  assert.match(absent.data.conflicts[0], /--output/);
});
