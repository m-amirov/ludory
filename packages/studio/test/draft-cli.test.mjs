import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runCli } from '../src/cli.mjs';
import { nativeProject } from '../../ai/test/helpers/project.mjs';
import { planNewRun, commitNewRun, readNativeRun } from '../../ai/src/store.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function game(t, receipt = true) {
  const project = nativeProject(t);
  if (receipt) fs.writeFileSync(path.join(project, 'ludory.studio.json'), JSON.stringify({
    schemaVersion: 1, profile: { id: 'narrative-game' }, template: { id: 'starter' },
    files: { 'ludory.project.json': hash(fs.readFileSync(path.join(project, 'ludory.project.json'))) },
  }));
  fs.writeFileSync(path.join(project, 'episode.md'), 'A storm tests the sailors.');
  fs.writeFileSync(path.join(project, 'candidate.md'), 'A new episode draft, awaiting review.');
  const start = planNewRun(project, { pipeline: 'production-art', scope: {
    target: 'EP1', inScope: ['episode.md'], acceptanceContract: 'Independent narrative acceptance',
    mutationBoundary: 'Draft only',
  } });
  return { project, run: commitNewRun(start).run.runId };
}

async function cli(argv, injection = {}) {
  let stdout = '', stderr = '';
  const code = await runCli(argv, { ...injection,
    out: text => { stdout += text; }, err: text => { stderr += text; } });
  return { code, stdout, stderr, result: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null };
}

const host = turn => ({ probe: async () => ({ available: true, reasonCode: 'AVAILABLE',
  transportVerified: true, entitlementVerified: true, routeObserved: 'web-dev',
  modelObserved: 'gpt-6-sol' }), turn,
  close: async () => {} });

test('workflow draft previews source-bound manual handoff with zero files or host launches', async t => {
  const { project, run } = game(t);
  const args = ['workflow', 'draft', '--project', project, '--run', run, '--task', 'episode-script',
    '--brief', 'episode.md', '--source', 'src/main.js', '--json'];
  const before = fs.readdirSync(path.join(project, '.ludory', 'ai', 'runs', run)).sort();
  const preview = await cli(args, { devHost: () => { throw new Error('no launch in preview'); } });
  assert.equal(preview.result.status, 'NEEDS_USER_ACTION');
  assert.equal(preview.result.manualPacket.brief.sha256, hash('A storm tests the sailors.'));
  assert.equal(fs.existsSync(path.join(project, '.ludory', 'ai', 'runs', run, 'drafts')), false);
  assert.deepEqual(fs.readdirSync(path.join(project, '.ludory', 'ai', 'runs', run)).sort(), before);
});

test('workflow draft requires apply plus observed route; returns review-only output', async t => {
  const { project, run } = game(t);
  const args = ['workflow', 'draft', '--project', project, '--run', run, '--task', 'art-concept',
    '--brief', 'episode.md', '--json', '--apply'];
  const missing = await cli(args, { devHost: () => ({ available: false, reasonCode: 'DEV_HOST_UNAVAILABLE' }) });
  assert.equal(missing.result.status, 'NEEDS_USER_ACTION');
  assert.equal(readNativeRun(project, run).events.length, 0);
  const result = await cli(args, { devHost: () => host(async () => ({ status: 'HOST_OBSERVED',
    text: 'Pictorial notes, not PASS.', modelObserved: 'gpt-6-sol', routeObserved: 'web-dev' })) });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.result.status, 'PENDING_REVIEW');
  assert.equal(readNativeRun(project, run).events.length, 2);
  assert.equal(readNativeRun(project, run).nextStage, result.result.nextStage);
  assert.equal(fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8'), '// Original user code\n');
});

test('CLI timeout reports pending recovery, not a definitive failed generation', async t => {
  const { project, run } = game(t);
  const args = ['workflow', 'draft', '--project', project, '--run', run, '--task', 'episode-script',
    '--brief', 'episode.md', '--json', '--apply'];
  const result = await cli(args, { devHost: () => host(async () => {
    throw new Error('DEV_HELPER_TIMEOUT');
  }) });
  assert.equal(result.code, 3);
  assert.equal(result.result.status, 'PENDING_RECOVERY');
  assert.equal(result.result.nextAction.kind, 'CONFIRM_EXECUTOR_STOPPED');
  assert.equal(readNativeRun(project, run).pendingExecutor, 'web-dev');
});

test('manual import copies immutable unapproved bytes with declared provenance', async t => {
  const { project, run } = game(t);
  const args = ['workflow', 'draft-import', '--project', project, '--run', run,
    '--task', 'episode-script', '--brief', 'episode.md', '--file', 'candidate.md', '--json'];
  const preview = await cli(args);
  assert.equal(preview.code, 0, preview.stderr);
  assert.equal(preview.result.status, 'READY');
  assert.equal(readNativeRun(project, run).events.length, 0);
  const applied = await cli([...args, '--apply']);
  assert.equal(applied.code, 0, applied.stderr);
  assert.equal(applied.result.status, 'PENDING_REVIEW');
  assert.equal(applied.result.provenance, 'USER_DECLARED');
  assert.equal(applied.result.output.outputSha256, hash('A new episode draft, awaiting review.'));
  const state = readNativeRun(project, run);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].kind, 'DRAFT_IMPORTED');
  assert.equal(state.events[0].manual.provenance, 'USER_DECLARED');
  assert.equal(state.nextStage, 'INVENTORIED');
  assert.equal((await cli(['workflow', 'next', '--project', project, '--run', run, '--json']))
    .result.nextAction.kind, 'REVIEW_DRAFT');
  assert.equal(fs.readFileSync(path.join(project, applied.result.output.outputPath), 'utf8'),
    'A new episode draft, awaiting review.');
  fs.writeFileSync(path.join(project, 'candidate.md'), 'Later user edit');
  assert.doesNotThrow(() => readNativeRun(project, run));
  assert.equal((await cli([...args, '--apply'])).code, 2);
});

test('import rejects frozen game, unsafe file and route --apply remains read-only', async t => {
  const { project, run } = game(t);
  const args = ['workflow', 'draft-import', '--project', project, '--run', run,
    '--task', 'episode-script', '--brief', 'episode.md', '--json'];
  assert.equal((await cli([...args, '--file', '../secret.md', '--apply'])).code !== 0, true);
  fs.symlinkSync(path.join(project, 'candidate.md'), path.join(project, 'linked.md'));
  assert.equal((await cli([...args, '--file', 'linked.md', '--apply'])).code !== 0, true);
  assert.equal((await cli(['workflow', 'route', '--project', project,
    '--task', 'art-concept', '--apply', '--json'])).code, 1);
  const frozen = game(t, false);
  assert.equal((await cli(['workflow', 'draft-import', '--project', frozen.project, '--run', frozen.run,
    '--task', 'art-concept', '--brief', 'episode.md', '--file', 'candidate.md', '--apply', '--json'])).code, 2);
});
