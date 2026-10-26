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
test('CLI image preview and apply are built-in agent handoffs; route --apply is rejected', async t => {
  const { project, run } = game(t);
  const args = ['workflow', 'image', '--project', project, '--run', run, '--brief', 'brief.md', '--json'];
  const preview = await cli(args, { imageHost: () => { throw new Error('no discovery during preview'); } });
  assert.equal(preview.code, 0);
  assert.equal(preview.result.status, 'NEEDS_AGENT_ACTION');
  assert.equal(readNativeRun(project, run).events.length, 0);
  const missing = await cli([...args, '--apply']);
  assert.equal(missing.code, 0);
  assert.equal(missing.result.selectedRoute, 'codex-imagegen');
  assert.equal(missing.result.manualPacket.skill, '$imagegen');
  assert.equal(readNativeRun(project, run).events.length, 0);
  assert.equal((await cli(['workflow', 'route', '--project', project, '--task', 'image', '--apply', '--json'])).code, 1);
});

test('CLI rejects API model pins; import stores USER_DECLARED and rejects frozen game', async t => {
  const { project, run } = game(t);
  const args = ['workflow', 'image', '--project', project, '--run', run,
    '--brief', 'brief.md', '--model', 'flare', '--apply', '--json'];
  const pin = await cli(args);
  assert.equal(pin.code, 1);
  const handoff = await cli(['workflow', 'image', '--project', project, '--run', run,
    '--brief', 'brief.md', '--json']);
  const impArgs = ['workflow', 'image-import', '--project', project, '--run', run,
    '--brief', 'brief.md', '--file', 'image.png', '--handoff-sha256',
    handoff.result.handoffSha256, '--json'];
  assert.equal((await cli(impArgs)).result.status, 'READY');
  const imported = await cli([...impArgs, '--apply']);
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(imported.result.status, 'PENDING_REVIEW');
  assert.equal(imported.result.provenance, 'USER_DECLARED');
  assert.equal((await cli([...impArgs, '--apply'])).code, 2);
  const frozen = game(t, false);
  assert.equal((await cli(['workflow', 'image-import', '--project', frozen.project, '--run', frozen.run,
    '--brief', 'brief.md', '--file', 'image.png', '--handoff-sha256',
    'a'.repeat(64), '--apply', '--json'])).code, 2);
});

test('CLI image never records pending host execution on apply', async t => {
  const { project, run } = game(t);
  const result = await cli(['workflow', 'image', '--project', project, '--run', run,
    '--brief', 'brief.md', '--apply', '--json']);
  assert.equal(result.code, 0);
  assert.equal(result.result.status, 'NEEDS_AGENT_ACTION');
  assert.equal(readNativeRun(project, run).pendingExecutor, null);
  assert.equal(readNativeRun(project, run).events.length, 0);
});
