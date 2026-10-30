import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runCli } from '../src/cli.mjs';
import { game } from '../../ai/test/helpers/image-game.mjs';
import { png } from '../../ai/test/helpers/images.mjs';
import { planImageTask, planImageImport, executeImageImport } from '../../ai/src/image-tasks.mjs';
import { readNativeArtReviews, readNativeRun } from '../../ai/src/store.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const capability = { available: true, reasonCode: 'AVAILABLE', routeAvailable: 'web-dev',
  modelRouteAvailable: 'chatgpt-web/gpt-6-sol', browserObservationV2Available: true,
  reasoningRequired: 'high', preflight: { authenticated: true, newChat: true,
    url: 'https://chatgpt.com/', solAvailable: true, extraHighAvailable: false, proAvailable: false } };

async function setup(t) {
  const { project, run } = game(t);
  fs.writeFileSync(path.join(project, 'candidate.png'), png);
  const handoff = await planImageTask(project, { run, brief: 'image-brief.md' });
  const preview = await planImageImport(project, { run, brief: 'image-brief.md', file: 'candidate.png',
    handoffSha256: handoff.handoffSha256 });
  const output = (await executeImageImport(preview, { apply: true })).output;
  const parts = [
    ['scene', 'scene.md', 'A solitary lighthouse over the Icelandic coast.'],
    ['characters', 'characters.md', 'This view has no characters.'],
    ['location', 'location.md', 'Iceland, rocky coastal cliffs.'],
    ['style', 'style.md', 'Cinematic wide, painterly light.'],
  ];
  for (const [, file, text] of parts) fs.writeFileSync(path.join(project, file), text);
  const args = ['workflow', 'art-review', '--project', project, '--run', run,
    '--image', output.outputPath, '--source', parts.map(([role, file]) => `${role}:${file}`).join(';'),
    '--context-reviewed', '--json'];
  return { project, run, args };
}

async function cli(args, injection = {}) {
  let stdout = '', stderr = '';
  const code = await runCli(args, { ...injection,
    out: text => { stdout += text; }, err: text => { stderr += text; } });
  return { code, stderr, result: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null };
}

function host(verdict = 'PASS_ART', findings = [], mutate = () => {}) {
  let calls = 0;
  const instance = { probe: async () => capability, close: async () => {},
    turn: async ({ images, taskId }) => {
      calls++;
      assert.equal(images.length, 1);
      assert.deepEqual(images[0].bytes, png);
      mutate();
      return { status: 'HOST_OBSERVED', routeObserved: 'web-dev', traceId: taskId, modelObserved: 'gpt-6-sol',
        imageInputObserved: true, imageRef: images[0].ref, imageSha256: hash(png), imageBytes: images[0].bytes.length,
        hostObservation: { protocolVersion: 2, source: 'browser-ui', selectedModel: 'gpt-6-sol',
          reasoning: 'high', traceId: taskId, image: { ref: images[0].ref, sha256: hash(png), bytes: images[0].bytes.length },
          upload: { creationRequestObserved: true, processingRequestObserved: true, processingRequestKind: 'process_upload_stream',
            processingEvent: 'file.processing.completed', processingCompleted: true, visibleAttachmentChip: true } },
        text: JSON.stringify({ schemaVersion: 1, imageVisible: true, imageSha256: hash(png),
          verdict, summary: 'Independent scene inspection.', findings }) };
    } };
  return { instance, get calls() { return calls; } };
}

test('CLI reports uncertain visual timeout as pending recovery and never starts a second host turn', async t => {
  const item = await setup(t);
  let calls = 0;
  const broken = { probe: async () => capability, close: async () => {},
    turn: async () => { calls++; throw new Error('BROWSER_TIMED_OUT'); } };
  const first = await cli([...item.args, '--apply'], { devHost: () => broken });
  assert.equal(first.code, 3);
  assert.equal(first.result.status, 'PENDING_RECOVERY');
  assert.equal(first.result.reasonCode, 'ART_REVIEW_OUTCOME_UNKNOWN');
  assert.match(readNativeRun(item.project, item.run).pendingArtReview, /^[a-f0-9]{64}$/);
  const second = await cli([...item.args, '--apply'], { devHost: () => broken });
  assert.equal(second.code, 2);
  assert.equal(second.result.reasonCode, 'ART_REVIEW_PENDING');
  assert.equal(calls, 1);
});

test('CLI storage recovery requires explicit stop confirmation and preserves orphan bytes', async t => {
  const item = await setup(t);
  const events = path.join(item.project, '.ludory', 'ai', 'runs', item.run, 'events');
  const orphan = path.join(events, '.pending-1234567890abcdef12345678');
  fs.writeFileSync(orphan, 'crash bytes');
  const args = ['workflow', 'recover-storage', '--project', item.project, '--run', item.run, '--json'];
  const preview = await cli(args);
  assert.equal(preview.result.status, 'NEEDS_CONFIRMATION');
  const blocked = await cli([...args, '--apply']);
  assert.equal(blocked.code, 2);
  assert.equal(fs.existsSync(orphan), true);
  const fixed = await cli([...args, '--confirm-no-executor', '--apply']);
  assert.equal(fixed.result.status, 'RECOVERED');
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.readFileSync(fixed.result.quarantinedFiles.find(x => x.endsWith('event-pending-1234567890abcdef12345678')), 'utf8'), 'crash bytes');
});

test('art-review dry-run does not launch Web host or mutate candidate/run', async t => {
  const item = await setup(t);
  const before = fs.readdirSync(path.join(item.project, '.ludory', 'ai', 'runs', item.run)).sort();
  const preview = await cli(item.args, { devHost: () => { throw Error('must not launch'); } });
  assert.equal(preview.code, 0);
  assert.equal(preview.result.status, 'NEEDS_USER_ACTION');
  assert.equal(preview.result.reasonCode, 'ART_WEB_VISUAL_UNVERIFIED');
  assert.deepEqual(fs.readdirSync(path.join(item.project, '.ludory', 'ai', 'runs', item.run)).sort(), before);
});

test('art-review observed Web image yields immutable, source-locked artistic receipt', async t => {
  const item = await setup(t);
  const web = host('PASS_ART', [{ severity: 'P2', category: 'style',
    description: 'Mild shadow variation.', evidence: 'Small luminance difference.' }]);
  const applied = await cli([...item.args, '--apply'], { devHost: () => web.instance });
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(applied.result.verdict, 'PASS_ART');
  assert.equal(applied.result.status, 'REVIEWED');
  assert.equal(applied.result.provenance, 'HOST_OBSERVED');
  assert.equal(web.calls, 1);
  const receipts = readNativeArtReviews(item.project, item.run);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].verdict, 'PASS_ART');
  assert.equal(receipts[0].modelObserved, 'gpt-6-sol');
  assert.equal(receipts[0].image.sha256, hash(png));
  assert.deepEqual(receipts[0].sources.map(x => x.role), ['scene', 'characters', 'location', 'style']);
  const file = path.join(item.project, '.ludory', 'ai', 'runs', item.run, 'reviews', '000001.json');
  assert.throws(() => fs.writeFileSync(file, 'changed', { flag: 'wx' }), { code: 'EEXIST' });
  const repeated = await cli([...item.args, '--apply'], { devHost: () => web.instance });
  assert.equal(repeated.code, 2);
  assert.equal(repeated.result.reasonCode, 'ART_ALREADY_ACCEPTED');
  assert.equal(web.calls, 1);
});

test('permuted valid reference roles are canonicalized before committing the receipt', async t => {
  const item = await setup(t);
  const sourceFlag = item.args.indexOf('--source') + 1;
  item.args[sourceFlag] = item.args[sourceFlag].split(';').reverse().join(';');
  const result = await cli([...item.args, '--apply'], { devHost: () => host().instance });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(readNativeArtReviews(item.project, item.run)[0].sources.map(x => x.role),
    ['scene', 'characters', 'location', 'style']);
});

test('two serious rework reviews escalate and do not permit a third call', async t => {
  const item = await setup(t);
  const web = host('REWORK', [{ severity: 'P1', category: 'location',
    description: 'Wrong lighthouse.', evidence: 'Architecture conflicts with location brief.' }]);
  const first = await cli([...item.args, '--apply'], { devHost: () => web.instance });
  assert.equal(first.result.verdict, 'REWORK');
  const second = await cli([...item.args, '--apply'], { devHost: () => web.instance });
  assert.equal(second.result.status, 'ESCALATE');
  assert.equal(second.code, 3);
  const third = await cli([...item.args, '--apply'], { devHost: () => web.instance });
  assert.equal(third.result.status, 'ESCALATE');
  assert.equal(third.code, 3);
  assert.equal(web.calls, 2);
  assert.equal(readNativeArtReviews(item.project, item.run).length, 2);
});

test('a REWORK may not silently change any source reference binding in the same run', async t => {
  const item = await setup(t);
  const web = host('REWORK', [{ severity: 'P1', category: 'character',
    description: 'Scene has an unexpected person.', evidence: 'Silhouette present at the coast.' }]);
  assert.equal((await cli([...item.args, '--apply'], { devHost: () => web.instance })).code, 0);
  fs.writeFileSync(path.join(item.project, 'characters.md'), 'A named person is now present.');
  const retry = await cli([...item.args, '--apply'], { devHost: () => web.instance });
  assert.equal(retry.code, 2);
  assert.equal(retry.result.reasonCode, 'ART_REVIEW_CONTEXT_CHANGED');
  assert.equal(web.calls, 1);
  assert.equal(readNativeArtReviews(item.project, item.run).length, 1);
});

test('receipt tampering, unsafe reviews directory and post-turn source edits fail closed', async t => {
  const item = await setup(t);
  const first = await cli([...item.args, '--apply'], { devHost: () => host().instance });
  assert.equal(first.code, 0);
  const file = path.join(item.project, '.ludory', 'ai', 'runs', item.run, 'reviews', '000001.json');
  fs.writeFileSync(file, JSON.stringify({ invalid: true }));
  // With cross-ledger replay checks, corruption is detected at the native
  // result boundary before the standalone artistic ledger can be returned.
  assert.throws(() => readNativeArtReviews(item.project, item.run),
    /ART_REVIEW_INTEGRITY|NATIVE_INTEGRITY_ART_REVIEW_RESULT/);
  const blocked = await cli([...item.args, '--apply'], { devHost: () => host().instance });
  assert.notEqual(blocked.code, 0);
  // Separate project for a storage-link attack; no existing receipt is overwritten.
  const other = await setup(t);
  const directory = path.join(other.project, '.ludory', 'ai', 'runs', other.run, 'reviews');
  fs.symlinkSync(path.dirname(directory), directory, 'dir');
  const unsafe = await cli([...other.args, '--apply'], { devHost: () => host().instance });
  assert.notEqual(unsafe.code, 0);
  const mutated = await setup(t);
  const edit = host('PASS_ART', [], () => fs.writeFileSync(path.join(mutated.project, 'scene.md'), 'Changed after turn'));
  const stale = await cli([...mutated.args, '--apply'], { devHost: () => edit.instance });
  assert.notEqual(stale.code, 0);
  assert.equal(readNativeArtReviews(mutated.project, mutated.run).length, 0);
});
