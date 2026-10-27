import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { game } from './helpers/image-game.mjs';
import { png } from './helpers/images.mjs';
import { planImageTask, planImageImport, executeImageImport } from '../src/image-tasks.mjs';
import { planArtReview, verifyArtReviewPlan, interpretArtReview, executeArtReview } from '../src/art-review.mjs';

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
  assert.equal(interpretArtReview(response([]).replace('a'.repeat(64), 'b'.repeat(64)), expected).verdict, 'BLOCKED');
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
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reasonCode, 'ART_VISUAL_ATTESTATION_MISSING');
});
