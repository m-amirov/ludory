import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { planNewRun, commitNewRun, readNativeRun } from '../../ai/src/store.mjs';
import { png } from '../../ai/test/helpers/images.mjs';

async function cli(argv, injections = {}) {
  let stdout = '', stderr = '';
  const code = await runCli(argv, { ...injections,
    out: text => { stdout += text; }, err: text => { stderr += text; } });
  return { code, result: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null, stderr };
}

test('CLI image apply hands generation to the Codex built-in skill; import retains review-only bytes', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-imagegen-cli-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  assert.equal((await cli(['create', '--project', project, '--id', 'builtin-game', '--title', 'Built-in',
    '--lang', 'en', '--profile', 'web-game', '--template', 'web-basic', '--targets', 'vk-games', '--apply'])).code, 0);
  fs.writeFileSync(path.join(project, 'image-brief.md'), 'High-fidelity cinematic cliff landscape');
  const run = commitNewRun(planNewRun(project, { pipeline: 'production-art', scope: {
    target: 'Cliff scene', inScope: ['image-brief.md'], acceptanceContract: 'Art review required',
    mutationBoundary: 'image originals only',
  } })).run.runId;
  const args = ['workflow', 'image', '--project', project, '--run', run, '--brief', 'image-brief.md', '--json'];
  const requested = await cli([...args, '--apply'], { imageHost: () => { throw new Error('API must never run'); } });
  assert.equal(requested.code, 0, requested.stderr);
  assert.equal(requested.result.status, 'NEEDS_AGENT_ACTION');
  assert.equal(requested.result.manualPacket.skill, '$imagegen');
  assert.equal(requested.result.nextAction.kind, 'SPAWN_IMAGE_AGENT');
  assert.equal(requested.result.manualPacket.agent.model, 'inherit-parent');
  assert.equal(requested.result.manualPacket.modelSelection, 'provider-default');
  assert.equal(readNativeRun(project, run).events.length, 0);
  fs.writeFileSync(path.join(project, 'generated.png'), png);
  const imported = await cli(['workflow', 'image-import', '--project', project,
    '--run', run, '--brief', 'image-brief.md', '--file', 'generated.png',
    '--handoff-sha256', requested.result.handoffSha256, '--apply', '--json']);
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(imported.result.status, 'PENDING_REVIEW');
  assert.equal(imported.result.provenance, 'USER_DECLARED');
  assert.deepEqual(fs.readFileSync(path.join(project, imported.result.output.outputPath)), png);
});

test('CLI rejects API-only model-selection option for a built-in ImageGen task', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-imagegen-flag-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const result = await cli(['workflow', 'image', '--project', project,
    '--run', 'any', '--brief', 'brief.md', '--model', 'flare', '--json']);
  assert.notEqual(result.code, 0);
});
