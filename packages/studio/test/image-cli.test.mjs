import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runCli } from '../src/cli.mjs';
import { nativeProject } from '../../ai/test/helpers/project.mjs';
import { planNewRun, commitNewRun, readNativeRun } from '../../ai/src/store.mjs';
import { png } from '../../ai/test/helpers/images.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function game(t, studio = true) {
  const project = nativeProject(t);
  if (studio) fs.writeFileSync(path.join(project, 'ludory.studio.json'), JSON.stringify({
    schemaVersion: 1, profile: { id: 'web-game' }, template: { id: 'starter' },
    files: { 'ludory.project.json': sha(fs.readFileSync(path.join(project, 'ludory.project.json'))) },
  }));
  fs.writeFileSync(path.join(project, 'brief.md'), 'winter harbor');
  fs.writeFileSync(path.join(project, 'image.png'), png);
  const run = commitNewRun(planNewRun(project, { pipeline: 'production-art', scope: {
    target: 'scene art', inScope: ['brief.md'], acceptanceContract: 'visual review',
    mutationBoundary: 'draft originals only',
  } })).run.runId;
  return { project, run };
}
async function cli(argv, injection = {}) {
  let stdout = '', stderr = '';
  const code = await runCli(argv, { ...injection,
    out: chunk => { stdout += chunk; }, err: chunk => { stderr += chunk; } });
  return { code, stdout, stderr, result: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null };
}
const observed = { available: true, transportVerified: true, entitlementVerified: true,
  imageGenCallable: true, routeObserved: 'image-gen', attestationScope: 'live-execution-context',
  modelObserved: 'gpt-6-terra' };

test('CLI image preview and missing host are manual-only; route --apply is rejected', async t => {
  const { project, run } = game(t);
  const args = ['workflow', 'image', '--project', project, '--run', run, '--brief', 'brief.md', '--json'];
  const preview = await cli(args, { imageHost: () => { throw new Error('no discovery during preview'); } });
  assert.equal(preview.code, 0);
  assert.equal(preview.result.status, 'NEEDS_USER_ACTION');
  assert.equal(readNativeRun(project, run).events.length, 0);
  const missing = await cli([...args, '--apply']);
  assert.equal(missing.code, 2);
  assert.equal(missing.result.selectedRoute, 'manual');
  assert.equal(readNativeRun(project, run).events.length, 0);
  assert.equal((await cli(['workflow', 'route', '--project', project, '--task', 'image', '--apply', '--json'])).code, 1);
});

test('CLI image uses one trusted live host and never promotes art PASS', async t => {
  const { project, run } = game(t);
  let called = 0;
  const result = await cli(['workflow', 'image', '--project', project, '--run', run,
    '--brief', 'brief.md', '--model', 'terra', '--apply', '--json'], { imageHost: () => ({
    probe: async () => ({ terra: observed, sol: null }),
    generate: async () => { called++; return { status: 'HOST_OBSERVED',
      routeObserved: 'image-gen', attestationScope: 'live-execution-context', imageGenCalled: true,
      modelObserved: 'gpt-6-terra', images: [{ bytes: png, mediaType: 'image/png' }] }; },
    close: async () => {},
  }) });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.result.status, 'PENDING_REVIEW');
  assert.equal(result.result.images.length, 1);
  assert.equal(called, 1);
  assert.equal(readNativeRun(project, run).reviewPending, true);
});

test('CLI pinned model unavailable stays manual; import stores USER_DECLARED and rejects frozen game', async t => {
  const { project, run } = game(t);
  const args = ['workflow', 'image', '--project', project, '--run', run,
    '--brief', 'brief.md', '--model', 'sol', '--apply', '--json'];
  const pin = await cli(args, { imageHost: () => ({ probe: async () => ({ terra: observed, sol: null }),
    generate: async () => { throw new Error('must not call'); } }) });
  assert.equal(pin.code, 2);
  assert.equal(pin.result.reasonCode, 'IMAGE_PINNED_MODEL_UNAVAILABLE');
  const impArgs = ['workflow', 'image-import', '--project', project, '--run', run,
    '--brief', 'brief.md', '--file', 'image.png', '--json'];
  assert.equal((await cli(impArgs)).result.status, 'READY');
  const imported = await cli([...impArgs, '--apply']);
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(imported.result.status, 'PENDING_REVIEW');
  assert.equal(imported.result.provenance, 'USER_DECLARED');
  assert.equal((await cli([...impArgs, '--apply'])).code, 2);
  const frozen = game(t, false);
  assert.equal((await cli(['workflow', 'image-import', '--project', frozen.project, '--run', frozen.run,
    '--brief', 'brief.md', '--file', 'image.png', '--apply', '--json'])).code, 2);
});

test('CLI host uncertainty reports pending recovery and asks for executor confirmation', async t => {
  const { project, run } = game(t);
  const result = await cli(['workflow', 'image', '--project', project, '--run', run,
    '--brief', 'brief.md', '--model', 'terra', '--apply', '--json'], { imageHost: () => ({
    probe: async () => ({ terra: observed }), generate: async () => { throw new Error('IMAGE_HOST_TIMEOUT'); },
  }) });
  assert.equal(result.code, 3);
  assert.equal(result.result.status, 'PENDING_RECOVERY');
  assert.equal(readNativeRun(project, run).pendingExecutor, 'image-gen');
});
