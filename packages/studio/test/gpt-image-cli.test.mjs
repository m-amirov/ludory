import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { createOpenAIImageHost } from '../../ai/src/image-host.mjs';
import { planNewRun, commitNewRun, readNativeRun } from '../../ai/src/store.mjs';
import { png } from '../../ai/test/helpers/images.mjs';

function setup(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-gpt-cli-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const create = runCli(['create', '--project', project, '--id', 'gpt-cli-game', '--title', 'GPT Game',
    '--lang', 'en', '--profile', 'web-game', '--template', 'web-basic',
    '--targets', 'vk-games', '--apply', '--json'], { out: () => {} });
  assert.equal(create, 0);
  fs.writeFileSync(path.join(project, 'brief.md'), 'approved, source-aware cinematic lighthouse');
  const run = commitNewRun(planNewRun(project, { pipeline: 'production-art', scope: {
    target: 'Art', inScope: ['brief.md'], acceptanceContract: 'Review',
    mutationBoundary: 'image originals only',
  } })).run.runId;
  return { project, run };
}

async function cli(args, injection = {}) {
  let output = '', error = '';
  const code = await runCli(args, { ...injection,
    out: chunk => { output += chunk; }, err: chunk => { error += chunk; } });
  return { code, result: output.trim().startsWith('{') ? JSON.parse(output) : null, error };
}

test('CLI GPT Image uses independently selected Flare provider through real adapter and records review-only bytes', async t => {
  const { project, run } = setup(t);
  let providerCalls = 0;
  const imageHost = () => createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: true,
    fetchImpl: async (_url, opts) => {
      providerCalls++;
      assert.equal(JSON.parse(opts.body).model, 'gpt-image-2.5-flare');
      return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png.toString('base64') }] }) };
    } });
  const base = ['workflow', 'image', '--project', project, '--run', run, '--brief', 'brief.md',
    '--model', 'flare', '--json'];
  assert.equal((await cli(base, { imageHost: () => { throw new Error('must not create provider during preview'); } })).result.status,
    'NEEDS_USER_ACTION');
  assert.equal(providerCalls, 0);
  const executed = await cli([...base, '--apply'], { imageHost });
  assert.equal(executed.code, 0, executed.error);
  assert.equal(executed.result.status, 'PENDING_REVIEW');
  assert.equal(executed.result.modelRequested, 'gpt-image-2.5-flare');
  assert.equal(executed.result.modelObserved, null);
  assert.equal(providerCalls, 1);
  assert.equal(readNativeRun(project, run).reviewPending, true);
  assert.equal(fs.existsSync(path.join(project, 'assets')), false, 'no runtime assets published');
});

test('CLI image --apply refuses absent provider and never journals billable request', async t => {
  const { project, run } = setup(t);
  const args = ['workflow', 'image', '--project', project, '--run', run, '--brief', 'brief.md', '--apply', '--json'];
  const response = await cli(args, { imageHost: () => createOpenAIImageHost({ apiKey: 'sk-test', allowPaid: false }) });
  assert.equal(response.code, 2);
  assert.equal(response.result.status, 'NEEDS_USER_ACTION');
  assert.equal(readNativeRun(project, run).events.length, 0);
});
