import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { game } from './helpers/image-game.mjs';
import { png } from './helpers/images.mjs';
import { planImageTask, planImageImport, executeImageImport } from '../src/image-tasks.mjs';
import { planArtReview, verifyArtReviewPlan, interpretArtReview, executeArtReview } from '../src/art-review.mjs';
import { readNativeRun, readNativeArtReviews, planNativeEvent, commitNativeEvent,
  recordNativeArtReview } from '../src/store.mjs';
import { planWorkflow, executeWorkflow } from '../src/workflows.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const observedWeb = { available: true, reasonCode: 'AVAILABLE', routeAvailable: 'web-dev',
  modelRouteAvailable: 'chatgpt-web/gpt-6-sol', browserObservationV2Available: true,
  reasoningRequired: 'high', preflight: { authenticated: true, newChat: true,
    url: 'https://chatgpt.com/', solAvailable: true, extraHighAvailable: false, proAvailable: false } };

function sources(project) {
  const inputs = [
    ['scene', 'scene.md', 'At winter dusk the lighthouse shines over the sea.'],
    ['characters', 'characters.md', 'No characters appear in this landscape shot.'],
    ['location', 'location.md', 'Rocky Icelandic coast and lighthouse.'],
    ['style', 'style.md', 'Painterly, high clarity, cinematic wide composition.'],
  ];
  for (const [, filename, text] of inputs) fs.writeFileSync(path.join(project, filename), text);
  return inputs.map(([role, filename]) => `${role}:${filename}`);
}

async function imported(t) {
  const { project, run } = game(t);
  fs.writeFileSync(path.join(project, 'candidate.png'), png);
  const handoff = await planImageTask(project, { run, brief: 'image-brief.md' });
  const preview = await planImageImport(project, { run, brief: 'image-brief.md', file: 'candidate.png',
    handoffSha256: handoff.handoffSha256 });
  const output = (await executeImageImport(preview, { apply: true })).output;
  return { project, run, output, source: sources(project) };
}

const options = input => ({ run: input.run, image: input.output.outputPath,
  sources: input.source, contextReviewed: true });
const discovered = { discover: () => observedWeb };

function witnessedArt(plan) {
  const traceId = `art-${plan.runId}`;
  const hostObservation = { protocolVersion: 2, source: 'browser-ui', traceId,
    selectedModel: 'gpt-6-sol', reasoning: 'high',
    image: { ref: plan.image.ref, sha256: plan.image.sha256, bytes: plan.image.size },
    upload: { creationRequestObserved: true, processingRequestObserved: true,
      processingRequestKind: 'process_upload_stream', processingEvent: 'file.processing.completed',
      processingCompleted: true, visibleAttachmentChip: true } };
  return { status: 'HOST_OBSERVED', routeObserved: 'web-dev', modelObserved: 'gpt-6-sol',
    imageInputObserved: true, traceId, imageRef: plan.image.ref, imageSha256: plan.image.sha256,
    imageBytes: plan.image.size, hostObservation,
    text: JSON.stringify({ schemaVersion: 1, imageVisible: true, imageSha256: plan.image.sha256,
      verdict: 'PASS_ART', summary: 'Scene matches source.', findings: [] }) };
}

test('a timed-out art host leaves durable intent and never silently resubmits a paid review', async t => {
  const item = await imported(t);
  const plan = planArtReview(item.project, options(item), discovered);
  let calls = 0;
  const host = { probe: async () => observedWeb, turn: async () => {
    calls++;
    throw new Error('SIMULATED_HOST_TIMEOUT_AFTER_SUBMIT');
  } };
  await assert.rejects(executeArtReview(plan, { apply: true, host }), /SIMULATED_HOST_TIMEOUT_AFTER_SUBMIT/);
  const pending = readNativeRun(item.project, item.run);
  assert.match(pending.pendingArtReview ?? '', /^[a-f0-9]{64}$/);
  assert.equal(pending.events.at(-1).kind, 'ART_REVIEW_REQUESTED');
  assert.equal(pending.status, 'ART_REVIEW_PENDING');
  assert.equal(readNativeArtReviews(item.project, item.run).length, 0);
  const repeated = planArtReview(item.project, options(item), discovered);
  assert.equal(repeated.status, 'BLOCKED');
  assert.equal(repeated.reasonCode, 'ART_REVIEW_PENDING');
  await executeArtReview(repeated, { apply: true, host });
  assert.equal(calls, 1, 'no implicit second paid browser submission');
});

test('owner-confirmed recovery closes pending visual intent without touching partial owner edits', async t => {
  const item = await imported(t);
  const original = planArtReview(item.project, options(item), discovered);
  await assert.rejects(executeArtReview(original, { apply: true, host: {
    probe: async () => observedWeb, turn: async () => { throw new Error('HELPER_TIMED_OUT'); },
  } }), /HELPER_TIMED_OUT/);
  fs.writeFileSync(path.join(item.project, 'owner-note.txt'), 'preserve this untracked note');
  fs.writeFileSync(path.join(item.project, 'scene.md'), 'Owner edited while review may be running');
  const preview = planWorkflow(item.project, 'recover', { run: item.run });
  assert.equal(preview.status, 'READY');
  assert.equal(preview.nativePlan.event.kind, 'ART_REVIEW_RESULT');
  assert.equal(preview.nativePlan.event.artReviewResult.code, 'ART_REVIEW_INTERRUPTED');
  const noConfirm = executeWorkflow(preview, { apply: true });
  assert.equal(noConfirm.status, 'BLOCKED');
  assert.match(noConfirm.conflicts.join(' '), /NATIVE_RECOVERY_CONFIRMATION_REQUIRED/);
  assert.match(readNativeRun(item.project, item.run).pendingArtReview, /^[a-f0-9]{64}$/);
  const confirmed = planWorkflow(item.project, 'recover', { run: item.run, confirmNoExecutor: true });
  const recovered = executeWorkflow(confirmed, { apply: true });
  assert.equal(recovered.status, 'APPLIED');
  assert.equal(readNativeRun(item.project, item.run).pendingArtReview, null);
  assert.equal(readNativeArtReviews(item.project, item.run).length, 0);
  assert.equal(fs.readFileSync(path.join(item.project, 'owner-note.txt'), 'utf8'), 'preserve this untracked note');
  assert.equal(fs.readFileSync(path.join(item.project, 'scene.md'), 'utf8'),
    'Owner edited while review may be running');
});

test('recover preserves a witnessed art receipt when the final native event was lost', async t => {
  const item = await imported(t);
  const original = planArtReview(item.project, options(item), discovered);
  const requested = commitNativeEvent(planNativeEvent(item.project, item.run, {
    kind: 'ART_REVIEW_REQUESTED', stage: original.stage,
    artReview: { image: original.image, brief: original.brief, sources: original.sources,
      modelObserved: 'gpt-6-sol' },
  }));
  const report = witnessedArt(original);
  const receipt = recordNativeArtReview(item.project, item.run, requested.headSha256, {
    provenance: 'HOST_OBSERVED', modelObserved: 'gpt-6-sol', visualInputObserved: true,
    artRequestSha256: requested.pendingArtReview, verdict: 'PASS_ART',
    reasonCode: 'ART_REPORT_STRUCTURED', summary: 'Scene matches source.', findings: [],
    hostObservation: report.hostObservation, image: original.image,
    brief: original.brief, sources: original.sources,
  });
  const candidate = planWorkflow(item.project, 'recover', { run: item.run, confirmNoExecutor: true });
  assert.equal(candidate.status, 'READY');
  assert.equal(candidate.nativePlan.event.artReviewResult.code, 'ART_REVIEW_OBSERVED');
  assert.equal(candidate.nativePlan.event.artReviewResult.receiptSha256, receipt.receiptSha256);
  assert.equal(executeWorkflow(candidate, { apply: true }).status, 'APPLIED');
  assert.equal(readNativeRun(item.project, item.run).pendingArtReview, null);
  assert.equal(readNativeArtReviews(item.project, item.run)[0].verdict, 'PASS_ART');
  assert.equal(planArtReview(item.project, options(item), discovered).reasonCode, 'ART_ALREADY_ACCEPTED');
});

test('the same pending visual request cannot produce two REWORK receipts', async t => {
  const item = await imported(t);
  const original = planArtReview(item.project, options(item), discovered);
  const requested = commitNativeEvent(planNativeEvent(item.project, item.run, {
    kind: 'ART_REVIEW_REQUESTED', stage: original.stage,
    artReview: { image: original.image, brief: original.brief, sources: original.sources,
      modelObserved: 'gpt-6-sol' },
  }));
  const report = { provenance: 'HOST_OBSERVED', modelObserved: 'gpt-6-sol',
    visualInputObserved: true, artRequestSha256: requested.pendingArtReview,
    verdict: 'REWORK', reasonCode: 'ART_REPORT_STRUCTURED',
    summary: 'Wrong location.', findings: [{ severity: 'P1', category: 'location',
      description: 'Wrong coast.', evidence: 'Cliff is missing.' }],
    hostObservation: witnessedArt(original).hostObservation,
    image: original.image, brief: original.brief, sources: original.sources };
  recordNativeArtReview(item.project, item.run, requested.headSha256, report);
  assert.throws(() => recordNativeArtReview(item.project, item.run, requested.headSha256, report),
    /ART_REVIEW_REQUEST_ALREADY_RECORDED/);
  assert.equal(readNativeArtReviews(item.project, item.run).length, 1);
});

test('old art host response cannot commit a review after owner has recovered the request', async t => {
  const item = await imported(t);
  const original = planArtReview(item.project, options(item), discovered);
  let started, finish;
  const entered = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { finish = resolve; });
  const execution = executeArtReview(original, { apply: true, host: {
    probe: async () => observedWeb,
    turn: async () => { started(); await held; return witnessedArt(original); },
  } });
  await entered;
  assert.match(readNativeRun(item.project, item.run).pendingArtReview, /^[a-f0-9]{64}$/);
  const recovery = planWorkflow(item.project, 'recover', { run: item.run, confirmNoExecutor: true });
  assert.equal(executeWorkflow(recovery, { apply: true }).status, 'APPLIED');
  finish();
  await assert.rejects(execution, /ART_REVIEW_STALE/);
  assert.equal(readNativeRun(item.project, item.run).pendingArtReview, null);
  assert.equal(readNativeArtReviews(item.project, item.run).length, 0);
});

test('art review preview only accepts a recorded original and carries exact image/source hashes without writes', async t => {
  const item = await imported(t);
  const runDir = path.join(item.project, '.ludory', 'ai', 'runs', item.run);
  const before = fs.readdirSync(runDir).sort();
  const preview = planArtReview(item.project, options(item), discovered);
  assert.equal(preview.status, 'READY');
  assert.equal(preview.selectedRoute, 'web-dev');
  assert.equal(preview.modelObserved, 'gpt-6-sol');
  assert.equal(preview.image.sha256, sha(png));
  assert.equal(preview.brief.path, 'image-brief.md');
  assert.deepEqual(preview.sources.map(x => x.role), ['scene', 'characters', 'location', 'style']);
  assert.deepEqual(preview.writes, []);
  assert.deepEqual(fs.readdirSync(runDir).sort(), before);
  assert.deepEqual(verifyArtReviewPlan(preview), { ok: true });
});

test('art review requires explicit context and verified Web image route', async t => {
  const item = await imported(t);
  assert.equal(planArtReview(item.project, { ...options(item), contextReviewed: false }, discovered).status, 'BLOCKED');
  assert.equal(planArtReview(item.project, { ...options(item), sources: item.source.slice(1) }, discovered).status, 'BLOCKED');
  assert.equal(planArtReview(item.project, options(item)).status, 'NEEDS_USER_ACTION');
  assert.equal(planArtReview(item.project, options(item),
    { discover: () => ({ ...observedWeb, modelRouteAvailable: 'chatgpt-web/gpt-5.6-sol' }) }).status, 'NEEDS_USER_ACTION');
  assert.equal(planArtReview(item.project, options(item),
    { discover: () => ({ ...observedWeb, browserObservationV2Available: false }) }).status, 'NEEDS_USER_ACTION');
});

test('art review refuses unimported candidates, image corruption, linked text and edited context before the host', async t => {
  const item = await imported(t);
  assert.equal(planArtReview(item.project, { ...options(item), image: 'candidate.png' }, discovered).status, 'BLOCKED');
  const ready = planArtReview(item.project, options(item), discovered);
  fs.writeFileSync(path.join(item.project, 'style.md'), 'Unreviewed new art direction.');
  assert.equal(verifyArtReviewPlan(ready).ok, false);
  fs.symlinkSync(path.join(item.project, 'style.md'), path.join(item.project, 'style-link.md'));
  assert.equal(planArtReview(item.project,
    { ...options(item), sources: [...item.source.slice(0, 3), 'style:style-link.md'] }, discovered).status, 'BLOCKED');
  fs.writeFileSync(path.join(item.project, item.output.outputPath), 'not a PNG');
  assert.equal(planArtReview(item.project, options(item), discovered).status, 'BLOCKED');
});

test('report parser computes P0/P1 rework and ignores P2 cosmetic polish for the acceptance gate', () => {
  const expected = { imageSha256: 'a'.repeat(64) };
  const response = findings => JSON.stringify({
    schemaVersion: 1, imageSha256: expected.imageSha256, imageVisible: true,
    verdict: 'PASS_ART', summary: 'Visual check of scene.',
    findings,
  });
  const minor = interpretArtReview(response([{
    severity: 'P2', category: 'composition', description: 'Minor shadow nuance.',
    evidence: 'Slightly uneven penumbra.',
  }]), expected);
  assert.equal(minor.verdict, 'PASS_ART');
  assert.equal(minor.findings.length, 1);
  const major = interpretArtReview(response([{
    severity: 'P1', category: 'location', description: 'Lighthouse is missing.',
    evidence: 'Image has only open sea.',
  }]), expected);
  assert.equal(major.verdict, 'REWORK');
  assert.equal(interpretArtReview(response([]).replace('"imageVisible":true', '"imageVisible":false'), expected).verdict, 'BLOCKED');
  const escapedArray = response([]).replace('"findings":[]', '"findings":\\[\\]');
  assert.equal(interpretArtReview(escapedArray, expected).verdict, 'PASS_ART');
  const escapedVerdict = response([]).replace('"verdict":"PASS_ART"', '"verdict":"PASS\\_ART"');
  assert.equal(interpretArtReview(escapedVerdict, expected).verdict, 'PASS_ART');
  const rework = response([{
    severity: 'P1', category: 'location', description: 'The required coast is absent.',
    evidence: 'Only open water is visible.',
  }]).replace('"verdict":"PASS_ART"', '"verdict":"REWORK"');
  assert.equal(interpretArtReview(rework, expected).verdict, 'REWORK');
  const unknownEscape = response([]).replace('"summary":"Visual check of scene."',
    String.raw`"summary":"Visual check\q of scene."`);
  assert.equal(interpretArtReview(unknownEscape, expected).verdict, 'BLOCKED');
  assert.equal(interpretArtReview(response([]).replace('a'.repeat(64), 'b'.repeat(64)), expected).verdict, 'BLOCKED');
  assert.equal(interpretArtReview(response([]).replace('"schemaVersion":1', '"schemaVersion":2'), expected).verdict, 'BLOCKED');
  const sourceBoundSha = response([]).replace(`"imageSha256":"${expected.imageSha256}"`,
    `"imageSha256":"${'b'.repeat(64)}"`);
  assert.equal(interpretArtReview(sourceBoundSha, expected).verdict, 'BLOCKED');
  assert.equal(interpretArtReview('PASS. Looks great!', expected).verdict, 'BLOCKED');
  assert.equal(interpretArtReview(response([]).replace('"verdict":"PASS_ART"', '"verdict":"REWORK"'),
    expected).verdict, 'BLOCKED');
});

test('visual review passes only one attested imported image into independent Web turn', async t => {
  const item = await imported(t);
  const plan = planArtReview(item.project, options(item), discovered);
  let calls = 0;
  const result = await executeArtReview(plan, { apply: true, host: {
    probe: async () => observedWeb,
    turn: async ({ prompt, images }) => {
      calls++;
      assert.match(prompt, /lighthouse/);
      assert.match(prompt, /characters/i);
      assert.equal(images.length, 1);
      assert.deepEqual(images[0].bytes, png);
      return { status: 'HOST_OBSERVED', routeObserved: 'web-dev', traceId: `art-${item.run}`,
        modelObserved: 'gpt-6-sol', imageInputObserved: true,
        imageRef: images[0].ref, imageSha256: sha(png), imageBytes: images[0].bytes.length,
        hostObservation: { protocolVersion: 2, source: 'browser-ui', selectedModel: 'gpt-6-sol',
          reasoning: 'high', traceId: `art-${item.run}`, image: { ref: images[0].ref, sha256: sha(png), bytes: images[0].bytes.length },
          upload: { creationRequestObserved: true, processingRequestObserved: true, processingRequestKind: 'process_upload_stream',
            processingEvent: 'file.processing.completed', processingCompleted: true, visibleAttachmentChip: true } },
        text: JSON.stringify({ schemaVersion: 1, imageSha256: sha(png), imageVisible: true,
          verdict: 'PASS_ART', summary: 'No serious discrepancies.', findings: [] }) };
    },
  } });
  assert.equal(result.verdict, 'PASS_ART');
  assert.equal(result.provenance, 'HOST_OBSERVED');
  assert.equal(calls, 1);
});

test('art review blocks declared host fields without a matching browser observation', async t => {
  const item = await imported(t);
  const plan = planArtReview(item.project, options(item), discovered);
  const result = await executeArtReview(plan, { apply: true, host: {
    probe: async () => observedWeb,
    turn: async ({ images }) => ({ status: 'HOST_OBSERVED', routeObserved: 'web-dev', traceId: `art-${item.run}`,
      modelObserved: 'gpt-6-sol', imageInputObserved: true, imageRef: images[0].ref,
      imageSha256: sha(png), imageBytes: images[0].bytes.length, text: JSON.stringify({ schemaVersion: 1, imageSha256: sha(png),
        imageVisible: true, verdict: 'PASS_ART', summary: 'Declared only.', findings: [] }) }),
  } });
  assert.equal(result.status, 'PENDING_RECOVERY');
  assert.equal(result.reasonCode, 'ART_VISUAL_ATTESTATION_MISSING');
  assert.match(readNativeRun(item.project, item.run).pendingArtReview, /^[a-f0-9]{64}$/);
  assert.equal(readNativeArtReviews(item.project, item.run).length, 0);
});
