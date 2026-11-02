import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planQaWebReview } from '../src/qa-review-contract.mjs';
import { beginQaJournal, appendQaJournal, inspectQaJournal } from '../src/qa-review-journal.mjs';
import { makeQaReviewFixture, qaObservedResponse } from './helpers/qa-review-fixture.mjs';
import { qaDirectoryDurabilityAvailable } from './helpers/qa-review-durability.mjs';

const durableTest = qaDirectoryDurabilityAvailable ? test : test.skip;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function appendPair(outputDir, image, imageIndex, sessionId, verdict = 'REVIEWED') {
  const traceId = `qa-${sessionId}-${imageIndex}`;
  appendQaJournal(outputDir, { type: 'REQUESTED', imageIndex, traceId, imageSha256: image.sha256 });
  const response = qaObservedResponse(image, traceId);
  appendQaJournal(outputDir, { type: 'OBSERVED', imageIndex, traceId, imageSha256: image.sha256,
    verdict, summary: 'Examined pixels', findings: verdict === 'ISSUES_FOUND' ? [
      { severity: 'P2', category: 'visual-ux', description: 'small mark', evidence: 'top edge',
        expected: 'large mark', observed: 'small mark', reproductionSteps: [],
        policyVerification: 'POLICY_SOURCE_UNVERIFIED' },
    ] : [], hostObservation: response.hostObservation });
}

durableTest('exclusive review journal is hash-linked, durable and always recorded-only', t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const beforeImage = fs.readFileSync(plan.images[0].file);
  const started = beginQaJournal(input.outputDir, plan);
  assert.match(started.sessionId, /^[a-f0-9-]{36}$/);
  assert.equal(started.outputDir, input.outputDir);
  assert.equal(inspectQaJournal(input.outputDir).status, 'PENDING_RECOVERY');
  for (let i = 0; i < 5; i++) appendPair(input.outputDir, plan.images[i], i, started.sessionId, i === 4 ? 'ISSUES_FOUND' : 'REVIEWED');
  const recorded = inspectQaJournal(input.outputDir);
  assert.equal(recorded.status, 'RECORDED_ISSUES_FOUND');
  assert.equal(recorded.recordedOnly, true);
  assert.equal(recorded.browserAttested, false);
  assert.equal(recorded.reviewProvenance, 'LOCAL_RECORD_ONLY');
  assert.equal(recorded.actualModeration, 'NOT_RUN');
  assert.equal(recorded.releaseReady, false);
  assert.equal(recorded.publicationAllowed, false);
  assert.equal(recorded.images.length, 5);
  assert.equal(recorded.images[4].verdict, 'ISSUES_FOUND');
  assert.ok(fs.readFileSync(plan.images[0].file).equals(beforeImage));
  assert.equal(fs.readdirSync(input.outputDir).length, 11);
  const all = fs.readdirSync(input.outputDir).map(name => fs.readFileSync(path.join(input.outputDir, name), 'utf8')).join('');
  assert.ok(!all.includes(beforeImage.toString('base64')));
});

durableTest('unfinished or changed review events never produce an aggregate reviewed outcome', t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const started = beginQaJournal(input.outputDir, plan);
  appendPair(input.outputDir, plan.images[0], 0, started.sessionId);
  const trace = `qa-${started.sessionId}-1`;
  appendQaJournal(input.outputDir, { type: 'REQUESTED', imageIndex: 1, traceId: trace,
    imageSha256: plan.images[1].sha256 });
  const partial = inspectQaJournal(input.outputDir);
  assert.equal(partial.status, 'PENDING_RECOVERY');
  assert.equal(partial.images.length, 1);
  const eventFile = path.join(input.outputDir, '000003.json');
  const event = JSON.parse(fs.readFileSync(eventFile, 'utf8'));
  event.payload.imageSha256 = 'f'.repeat(64);
  fs.writeFileSync(eventFile, JSON.stringify(event));
  assert.equal(inspectQaJournal(input.outputDir).status, 'BLOCKED');
});

durableTest('a self-consistent rewritten local report cannot claim live Web authority', t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const { sessionId } = beginQaJournal(input.outputDir, plan);
  for (let i = 0; i < 5; i++) appendPair(input.outputDir, plan.images[i], i, sessionId);
  const last = path.join(input.outputDir, '000010.json');
  const event = JSON.parse(fs.readFileSync(last, 'utf8'));
  event.payload.summary = 'Locally edited; false claim';
  // The hash chain is not a signature. A local editor can rewrite the final link.
  event.sha256 = hash(JSON.stringify({ schemaVersion: event.schemaVersion, index: event.index,
    previousSha256: event.previousSha256, payload: event.payload }));
  fs.writeFileSync(last, JSON.stringify(event));
  const result = inspectQaJournal(input.outputDir);
  assert.ok(['BLOCKED', 'RECORDED_REVIEWED'].includes(result.status));
  assert.notEqual(result.status, 'REVIEWED');
  assert.equal(result.browserAttested, false);
  assert.equal(result.reviewProvenance, 'LOCAL_RECORD_ONLY');
});

test('existing output, linked parents and output inside evidence are rejected without source writes', t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  fs.mkdirSync(input.outputDir);
  const sentinel = path.join(input.outputDir, 'keep.txt');
  fs.writeFileSync(sentinel, 'owner');
  assert.throws(() => beginQaJournal(input.outputDir, plan), /QA_JOURNAL_/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'owner');
  assert.throws(() => beginQaJournal(path.join(input.evidenceDir, 'review'), plan), /QA_JOURNAL_/);
  assert.equal(fs.existsSync(path.join(input.evidenceDir, 'review')), false);
  const linked = path.join(input.folder, 'linked');
  fs.symlinkSync(input.folder, linked, 'dir');
  assert.throws(() => beginQaJournal(path.join(linked, 'review'), plan), /QA_JOURNAL_/);
  assert.equal(fs.existsSync(path.join(input.folder, 'review')), false);
});

test('new directory and REQUESTED event names are synced before an image may be sent', t => {
  if (process.platform !== 'linux') return t.skip('Directory fd mapping uses Linux /proc');
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const original = fs.fsyncSync;
  const dirSyncs = [];
  fs.fsyncSync = function (fd) {
    if (fs.fstatSync(fd).isDirectory()) dirSyncs.push(fs.realpathSync(`/proc/self/fd/${fd}`));
    return original.call(this, fd);
  };
  try {
    const started = beginQaJournal(input.outputDir, plan);
    assert.ok(dirSyncs.includes(input.folder), 'mkdir is committed in parent directory');
    assert.ok(dirSyncs.includes(input.outputDir), 'session name is committed in output directory');
    dirSyncs.length = 0;
    appendQaJournal(input.outputDir, { type: 'REQUESTED', imageIndex: 0,
      traceId: `qa-${started.sessionId}-0`, imageSha256: plan.images[0].sha256 });
    assert.ok(dirSyncs.includes(input.outputDir), 'intent filename is durable before return');
  } finally { fs.fsyncSync = original; }
});

test('hosts without verified directory durability refuse journal creation before any request', t => {
  if (qaDirectoryDurabilityAvailable) return t.skip('Host supports verified directory fsync');
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  assert.throws(() => beginQaJournal(input.outputDir, plan), /QA_JOURNAL_DIRECTORY_DURABILITY_UNVERIFIED/);
  assert.equal(inspectQaJournal(input.outputDir).status, 'BLOCKED');
});

test('an output-path swap at session or event creation never redirects a write into source evidence', t => {
  if (process.platform !== 'linux') return t.skip('Swap timing is modeled against Linux pinned cwd');
  for (const stage of ['session', 'event']) {
    const input = makeQaReviewFixture(t);
    const plan = planQaWebReview(input);
    const started = stage === 'event' ? beginQaJournal(input.outputDir, plan) : null;
    const original = fs.openSync;
    const moved = `${input.outputDir}.moved`;
    let triggered = false;
    fs.openSync = function (filename, ...args) {
      if (!triggered && String(filename).endsWith(stage === 'event' ? '000001.json' : 'session.json')) {
        triggered = true;
        fs.renameSync(input.outputDir, moved);
        fs.symlinkSync(input.evidenceDir, input.outputDir, 'dir');
      }
      return original.call(this, filename, ...args);
    };
    try {
      if (stage === 'session') assert.throws(() => beginQaJournal(input.outputDir, plan), /QA_JOURNAL_/);
      else assert.throws(() => appendQaJournal(input.outputDir, { type: 'REQUESTED', imageIndex: 0,
        traceId: `qa-${started.sessionId}-0`, imageSha256: plan.images[0].sha256 }), /QA_JOURNAL_/);
    } finally { fs.openSync = original; }
    assert.ok(triggered);
    assert.equal(fs.existsSync(path.join(input.evidenceDir, stage === 'event' ? '000001.json' : 'session.json')), false);
  }
});

test('swapping output parent during mkdir cannot create files through the replacement symlink', t => {
  if (process.platform !== 'linux') return t.skip('Swap timing is modeled against Linux pinned cwd');
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const original = fs.mkdirSync;
  const moved = `${input.folder}.moved`;
  let swapped = false;
  t.after(() => {
    if (fs.existsSync(moved)) fs.rmSync(moved, { recursive: true, force: true });
  });
  fs.mkdirSync = function (filename, ...args) {
    if (!swapped && filename === path.basename(input.outputDir)) {
      swapped = true;
      fs.renameSync(input.folder, moved);
      fs.symlinkSync(path.join(moved, 'evidence'), input.folder, 'dir');
    }
    return original.call(this, filename, ...args);
  };
  try { assert.throws(() => beginQaJournal(input.outputDir, plan), /QA_JOURNAL_/); }
  finally { fs.mkdirSync = original; }
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(path.join(moved, 'evidence', 'review-record')), false);
});
