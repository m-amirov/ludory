import './setup-trust-env.mjs';
import test from 'node:test';
import { qaDirectoryDurabilityAvailable } from './helpers/qa-review-durability.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { makeQaRepairFixture, makeQaRepairRecheck } from './helpers/qa-repair-fixture.mjs';

const durableTest = qaDirectoryDurabilityAvailable ? test : test.skip;

async function invoke(args) {
  let out = '';
  let err = '';
  let hostCalls = 0;
  const code = await runCli(args, { out: text => { out += text; },
    err: text => { err += text; }, devHost: () => { hostCalls++; throw new Error('No Web calls from repair CLI'); } });
  return { code, out, err, hostCalls, data: args.includes('--json') ? JSON.parse(out) : null };
}

const args = f => ['--project', f.project, '--review-output', f.reviewOutput,
  '--output', f.repairOutput, '--in-scope', 'src/main.js',
  '--mutation-boundary', 'Fix clipped mobile text'];

test('help identifies explicit consent, status, round start and review record actions', async () => {
  const result = await invoke(['help']);
  assert.equal(result.code, 0);
  assert.match(result.out, /qa repair --project/);
  assert.match(result.out, /qa repair-status --output/);
  assert.match(result.out, /qa repair-next --output/);
  assert.match(result.out, /qa repair-record --output/);
});

durableTest('repair preview never creates consent or probes Web; apply needs the explicit --repair flag', async t => {
  const f = await makeQaRepairFixture(t);
  const preview = await invoke(['qa', 'repair', ...args(f), '--json']);
  assert.equal(preview.code, 0, preview.err);
  assert.equal(preview.data.status, 'READY_FOR_AGENT_HANDOFF');
  assert.equal(preview.data.authorization.maxRepairs, 2);
  assert.equal(preview.hostCalls, 0);
  assert.equal(fs.existsSync(f.repairOutput), false);
  const missing = await invoke(['qa', 'repair', ...args(f), '--apply', '--json']);
  assert.equal(missing.code, 1);
  assert.equal(fs.existsSync(f.repairOutput), false);
  const applied = await invoke(['qa', 'repair', ...args(f), '--repair', '--apply', '--json']);
  assert.equal(applied.code, 0, applied.err);
  assert.equal(applied.data.status, 'READY_FOR_ROUND');
  assert.equal(applied.data.remainingRepairs, 2);
  assert.equal(applied.data.actualModeration, 'NOT_RUN');
  assert.equal(applied.hostCalls, 0);
});

durableTest('recording a fresh reinspection is explicit and never called a moderation PASS', async t => {
  const f = await makeQaRepairFixture(t);
  await invoke(['qa', 'repair', ...args(f), '--repair', '--apply', '--json']);
  const next = await invoke(['qa', 'repair-next', '--output', f.repairOutput, '--apply', '--json']);
  assert.equal(next.code, 0, next.err);
  assert.equal(next.data.status, 'NEEDS_AGENT_ACTION');
  assert.deepEqual(next.data.nextAction.allowedFiles, ['src/main.js']);
  const repeated = await invoke(['qa', 'repair-next', '--output', f.repairOutput, '--apply', '--json']);
  assert.equal(repeated.code, 3);
  assert.equal(repeated.data.status, 'PENDING_RECOVERY');
  fs.appendFileSync(path.join(f.project, 'src/main.js'), '\n// correction\n');
  const recheck = await makeQaRepairRecheck(t);
  const preview = await invoke(['qa', 'repair-record', '--output', f.repairOutput,
    '--review-output', recheck.reviewOutput, '--json']);
  assert.equal(preview.code, 0);
  assert.equal(preview.data.status, 'RECHECK_RECORDED');
  const pending = await invoke(['qa', 'repair-status', '--output', f.repairOutput, '--json']);
  assert.equal(pending.data.status, 'PENDING_RECOVERY');
  const recorded = await invoke(['qa', 'repair-record', '--output', f.repairOutput,
    '--review-output', recheck.reviewOutput, '--apply', '--json']);
  assert.equal(recorded.code, 0);
  assert.equal(recorded.data.status, 'RECHECK_RECORDED');
  assert.equal(recorded.data.browserAttested, false);
  assert.equal(recorded.data.actualModeration, 'NOT_RUN');
  assert.equal(recorded.data.publicationAllowed, false);
  assert.equal((await invoke(['qa', 'repair-status', '--output', f.repairOutput, '--json'])).data.status,
    'RECHECK_RECORDED');
});

durableTest('invalid flags and foreign sources fail without creating a repair session', async t => {
  const f = await makeQaRepairFixture(t);
  for (const extra of [['--secret'], ['--apply', '--apply'], ['--repair', '--unknown']]) {
    const result = await invoke(['qa', 'repair', ...args(f), ...extra, '--json']);
    assert.equal(result.code, 1);
    assert.equal(fs.existsSync(f.repairOutput), false);
  }
  const blocked = await invoke(['qa', 'repair', ...args(f).map(v => v === f.project ? f.folder : v),
    '--repair', '--apply', '--json']);
  assert.equal(blocked.code, 2);
  assert.equal(blocked.data.status, 'BLOCKED');
  assert.equal(fs.existsSync(f.repairOutput), false);
});
