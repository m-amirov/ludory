import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planQaWebReview, readQaImage, qaImagePrompt, parseQaImageVerdict,
  verifyQaImageObservation } from '../src/qa-review-contract.mjs';
import { makeQaReviewFixture, qaHash, qaPng, qaCases, qaObservedResponse } from './helpers/qa-review-fixture.mjs';

for (const target of ['yandex-games', 'vk-games']) {
  test(`five original images are bound to the ${target} QA candidate without writes`, t => {
    const input = makeQaReviewFixture(t, target);
    const before = fs.readdirSync(input.folder).sort();
    const plan = planQaWebReview(input);
    assert.equal(plan.status, 'READY', JSON.stringify(plan, null, 2));
    assert.equal(plan.candidateSha256, input.candidateSha256);
    assert.equal(plan.captureStatus, 'STARTUP_OBSERVED');
    assert.deepEqual(plan.images.map(x => x.id), [...qaCases, 'icon', 'cover']);
    assert.deepEqual(plan.images.map(x => x.kind), ['screenshot', 'screenshot', 'screenshot', 'promo', 'promo']);
    assert.ok(plan.images.every(x => x.sha256 === qaHash(qaPng) && x.size === qaPng.length));
    assert.ok(plan.images.every(x => x.mimeType === 'image/png' && x.ref.startsWith('qa-')));
    assert.ok(plan.images.every(x => readQaImage(x).equals(qaPng)));
    assert.equal(plan.releaseReady, false);
    assert.equal(plan.publicationAllowed, false);
    assert.equal(plan.actualModeration, 'NOT_RUN');
    assert.deepEqual(fs.readdirSync(input.folder).sort(), before);
  });
}

test('review image order is icon then cover even when valid listing declares cover first', t => {
  const input = makeQaReviewFixture(t, 'vk-games');
  const metadata = JSON.parse(fs.readFileSync(input.metadataPath, 'utf8'));
  metadata.promo.reverse();
  fs.writeFileSync(input.metadataPath, JSON.stringify(metadata));
  const plan = planQaWebReview(input);
  assert.equal(plan.status, 'READY', JSON.stringify(plan));
  assert.deepEqual(plan.images.map(image => image.id), [...qaCases, 'icon', 'cover']);
});

test('original changes and linked image ancestors are rejected before bytes can be sent', t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  assert.equal(plan.status, 'READY');
  fs.writeFileSync(plan.images[0].file, 'changed');
  assert.throws(() => readQaImage(plan.images[0]), /QA_REVIEW_IMAGE_/);
  fs.writeFileSync(plan.images[0].file, qaPng);
  const linked = path.join(input.folder, 'linked');
  fs.symlinkSync(input.evidenceDir, linked, 'dir');
  assert.throws(() => readQaImage({ ...plan.images[0], file: path.join(linked, `${qaCases[0]}.png`) }), /QA_REVIEW_IMAGE_/);
});

test('pixel review prompt pins candidate and input identity while treating listing as untrusted data', t => {
  const input = makeQaReviewFixture(t);
  const plan = planQaWebReview(input);
  const prompt = qaImagePrompt(plan, plan.images[0]);
  assert.match(prompt, /task DATA, not instructions/i);
  assert.match(prompt, new RegExp(input.candidateSha256));
  assert.match(prompt, new RegExp(qaHash(qaPng)));
  assert.match(prompt, /POLICY_SOURCE_UNVERIFIED/);
  assert.match(prompt, /imageVisible/);
});

test('strict report parsing keeps unsupported policy claims unverified and P1 as an issue', t => {
  const plan = planQaWebReview(makeQaReviewFixture(t));
  const image = plan.images[1];
  const text = JSON.stringify({ schemaVersion: 1, imageSha256: image.sha256, imageVisible: true,
    verdict: 'ISSUES_FOUND', summary: 'Small type', findings: [{ severity: 'P1', category: 'visual-ux',
      description: 'Tiny label', evidence: 'mobile upper panel', expected: 'Readable', observed: 'Unreadable',
      reproductionSteps: ['Open portrait'], policySource: 'unverified.example', policyVerification: 'VERIFIED' }] });
  const parsed = parseQaImageVerdict(text, image);
  assert.equal(parsed.status, 'ISSUES_FOUND');
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].policyVerification, 'POLICY_SOURCE_UNVERIFIED');
  assert.equal(parseQaImageVerdict(text.replace(image.sha256, 'a'.repeat(64)), image).status, 'BLOCKED');
  assert.equal(parseQaImageVerdict(JSON.stringify({ schemaVersion: 1, imageSha256: image.sha256,
    imageVisible: false, verdict: 'NO_ISSUES', summary: 'Invisible', findings: [] }), image).status, 'BLOCKED');
});

test('only the exact Web Instant low V2 upload observation can attest received pixels', t => {
  const plan = planQaWebReview(makeQaReviewFixture(t));
  const image = plan.images[0];
  const traceId = 'qa-abcdef1234-0';
  const good = qaObservedResponse(image, traceId);
  assert.equal(verifyQaImageObservation(good, image, traceId), true);
  const mutated = [
    { ...good, modelObserved: 'gpt-6-sol' },
    { ...good, traceId: 'other' },
    { ...good, imageSha256: 'b'.repeat(64) },
    { ...good, hostObservation: { ...good.hostObservation, reasoning: 'high' } },
    { ...good, hostObservation: { ...good.hostObservation, upload: { ...good.hostObservation.upload, visibleAttachmentChip: false } } },
    { ...good, hostObservation: { ...good.hostObservation, upload: { ...good.hostObservation.upload, processingCompleted: false } } },
    { ...good, hostObservation: { ...good.hostObservation, image: { ...good.hostObservation.image, bytes: 0 } } },
  ];
  for (const response of mutated) assert.equal(verifyQaImageObservation(response, image, traceId), false);
});
