import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planQaRepair } from '../src/qa-repair-scope.mjs';
import { beginQaRepair, inspectQaRepair, startQaRepairRound,
  completeQaRepairRound } from '../src/qa-repair-journal.mjs';
import { makeQaRepairFixture, makeQaRepairRecheck } from './helpers/qa-repair-fixture.mjs';

async function consent(t) {
  const f = await makeQaRepairFixture(t);
  const plan = planQaRepair({ project: f.project, reviewOutput: f.reviewOutput,
    outputDir: f.repairOutput, inScope: 'src/main.js', mutationBoundary: 'Fix clipped mobile text only' });
  assert.equal(plan.status, 'READY_FOR_AGENT_HANDOFF');
  return { ...f, plan };
}

test('a read-only consent preview has zero writes; applying pins two-round scope durably', async t => {
  const f = await consent(t);
  assert.equal(beginQaRepair(f.plan, { apply: false }).status, 'READY_FOR_AGENT_HANDOFF');
  assert.equal(fs.existsSync(f.repairOutput), false);
  const applied = beginQaRepair(f.plan, { apply: true });
  assert.equal(applied.status, 'READY_FOR_ROUND');
  assert.equal(applied.roundsUsed, 0);
  assert.equal(applied.maxRepairs, 2);
  assert.equal(applied.remainingRepairs, 2);
  assert.equal(applied.actualModeration, 'NOT_RUN');
  assert.equal(inspectQaRepair(f.repairOutput).status, 'READY_FOR_ROUND');
  assert.equal(beginQaRepair(f.plan, { apply: true }).status, 'BLOCKED');
});

test('a started round is durably uncertain and cannot silently restart or touch source', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  const original = fs.readFileSync(path.join(f.project, 'src/main.js'));
  assert.equal(startQaRepairRound(f.repairOutput, { apply: false }).status, 'READY_FOR_ROUND');
  assert.equal(inspectQaRepair(f.repairOutput).roundsUsed, 0);
  const started = startQaRepairRound(f.repairOutput, { apply: true });
  assert.equal(started.status, 'NEEDS_AGENT_ACTION');
  assert.equal(started.round, 1);
  assert.equal(inspectQaRepair(f.repairOutput).status, 'PENDING_RECOVERY');
  assert.equal(startQaRepairRound(f.repairOutput, { apply: true }).status, 'PENDING_RECOVERY');
  assert.deepEqual(fs.readFileSync(path.join(f.project, 'src/main.js')), original);
});

test('concurrent starts cannot append a duplicate invalid event after another writer advances head', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  const original = fs.readdirSync;
  let reads = 0;
  let nested;
  fs.readdirSync = function (location, ...rest) {
    if (location === '.' && process.cwd() === f.repairOutput && ++reads === 3) {
      nested = startQaRepairRound(f.repairOutput, { apply: true });
    }
    return original.call(this, location, ...rest);
  };
  let outer;
  try { outer = startQaRepairRound(f.repairOutput, { apply: true }); }
  finally { fs.readdirSync = original; }
  assert.equal(nested?.status, 'NEEDS_AGENT_ACTION');
  assert.equal(outer.status, 'BLOCKED');
  assert.equal(inspectQaRepair(f.repairOutput).status, 'PENDING_RECOVERY');
  assert.deepEqual(fs.readdirSync(f.repairOutput).sort(), ['000001.json', 'session.json']);
});

test('one authorized consent permits at most two source edits and fresh independent-review handoffs', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  startQaRepairRound(f.repairOutput, { apply: true });
  fs.appendFileSync(path.join(f.project, 'src/main.js'), '\n// first correction\n');
  const recheck1 = await makeQaRepairRecheck(t, { severity: 'P1', sourceText: 'first-build' });
  const preview = completeQaRepairRound(f.repairOutput,
    { reviewOutput: recheck1.reviewOutput, apply: false });
  assert.equal(preview.status, 'REWORK');
  assert.equal(inspectQaRepair(f.repairOutput).status, 'PENDING_RECOVERY');
  const first = completeQaRepairRound(f.repairOutput,
    { reviewOutput: recheck1.reviewOutput, apply: true });
  assert.equal(first.status, 'REWORK');
  assert.equal(first.roundsUsed, 1);
  assert.equal(first.remainingRepairs, 1);
  assert.equal(first.actualModeration, 'NOT_RUN');
  assert.equal(startQaRepairRound(f.repairOutput, { apply: true }).round, 2);
  fs.appendFileSync(path.join(f.project, 'src/main.js'), '\n// second correction\n');
  const recheck2 = await makeQaRepairRecheck(t, { severity: 'P1', sourceText: 'second-build' });
  const second = completeQaRepairRound(f.repairOutput,
    { reviewOutput: recheck2.reviewOutput, apply: true });
  assert.equal(second.status, 'ESCALATE');
  assert.equal(second.roundsUsed, 2);
  assert.equal(second.remainingRepairs, 0);
  assert.equal(startQaRepairRound(f.repairOutput, { apply: true }).status, 'ESCALATE');
  assert.equal(fs.readdirSync(f.repairOutput).filter(n => n.startsWith('000')).length, 4);
});

test('a fresh review with P2 only records reinspection, never simulated/real moderation PASS', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  startQaRepairRound(f.repairOutput, { apply: true });
  fs.appendFileSync(path.join(f.project, 'src/main.js'), '\n// corrected\n');
  const recheck = await makeQaRepairRecheck(t, { severity: 'P2' });
  const result = completeQaRepairRound(f.repairOutput,
    { reviewOutput: recheck.reviewOutput, apply: true });
  assert.equal(result.status, 'RECHECK_RECORDED');
  assert.equal(result.reviewProvenance, 'LOCAL_RECORD_ONLY');
  assert.equal(result.actualModeration, 'NOT_RUN');
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(startQaRepairRound(f.repairOutput, { apply: true }).status, 'RECHECK_RECORDED');
});

test('new P0 after P1 is a blocking regression even in round one', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  startQaRepairRound(f.repairOutput, { apply: true });
  fs.appendFileSync(path.join(f.project, 'src/main.js'), '\n// changed\n');
  const recheck = await makeQaRepairRecheck(t, { severity: 'P0' });
  const result = completeQaRepairRound(f.repairOutput,
    { reviewOutput: recheck.reviewOutput, apply: true });
  assert.equal(result.status, 'ESCALATE');
  assert.equal(result.reasonCode, 'QA_REPAIR_P0_REGRESSION');
});

test('unexpected user-owned file edit escalates and preserves the changed bytes', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  startQaRepairRound(f.repairOutput, { apply: true });
  fs.appendFileSync(path.join(f.project, 'src/main.js'), '\n// allowed\n');
  fs.writeFileSync(path.join(f.project, 'owner-notes.txt'), 'do not lose');
  const recheck = await makeQaRepairRecheck(t);
  const result = completeQaRepairRound(f.repairOutput,
    { reviewOutput: recheck.reviewOutput, apply: true });
  assert.equal(result.status, 'ESCALATE');
  assert.equal(result.reasonCode, 'QA_REPAIR_SCOPE_VIOLATION');
  assert.ok(result.changedPaths.includes('owner-notes.txt'));
  assert.equal(fs.readFileSync(path.join(f.project, 'owner-notes.txt'), 'utf8'), 'do not lose');
});

test('missing, unchanged or wrong-target reinspection never consumes a successful round', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  startQaRepairRound(f.repairOutput, { apply: true });
  assert.equal(completeQaRepairRound(f.repairOutput,
    { reviewOutput: path.join(f.folder, 'absent'), apply: true }).status, 'BLOCKED');
  assert.equal(completeQaRepairRound(f.repairOutput,
    { reviewOutput: f.reviewOutput, apply: true }).status, 'BLOCKED');
  assert.equal(inspectQaRepair(f.repairOutput).status, 'PENDING_RECOVERY');
  fs.appendFileSync(path.join(f.project, 'src/main.js'), '\n// allowed\n');
  const wrongTarget = await makeQaRepairRecheck(t, { target: 'vk-games' });
  assert.equal(completeQaRepairRound(f.repairOutput,
    { reviewOutput: wrongTarget.reviewOutput, apply: true }).status, 'BLOCKED');
  assert.equal(inspectQaRepair(f.repairOutput).status, 'PENDING_RECOVERY');
});

test('tampered local consent or round event fails closed', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  startQaRepairRound(f.repairOutput, { apply: true });
  const event = path.join(f.repairOutput, '000001.json');
  const changed = JSON.parse(fs.readFileSync(event, 'utf8'));
  changed.payload.round = 2;
  fs.writeFileSync(event, JSON.stringify(changed));
  assert.equal(inspectQaRepair(f.repairOutput).status, 'BLOCKED');
  assert.equal(startQaRepairRound(f.repairOutput, { apply: true }).status, 'BLOCKED');
});

test('a rehashed consent cannot broaden allowed paths after the owner opted in', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  const file = path.join(f.repairOutput, 'session.json');
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  current.authorization.inScope.push('../owner.txt');
  const { sha256, ...body } = current;
  current.sha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  fs.writeFileSync(file, `${JSON.stringify(current)}\n`);
  assert.equal(inspectQaRepair(f.repairOutput).status, 'BLOCKED');
  assert.equal(startQaRepairRound(f.repairOutput, { apply: true }).status, 'BLOCKED');
});

test('a rehashed result cannot invent REWORK after an out-of-scope edit', async t => {
  const f = await consent(t);
  beginQaRepair(f.plan, { apply: true });
  startQaRepairRound(f.repairOutput, { apply: true });
  fs.appendFileSync(path.join(f.project, 'src/main.js'), '\n// allowed\n');
  fs.writeFileSync(path.join(f.project, 'owner-notes.txt'), 'must preserve');
  const recheck = await makeQaRepairRecheck(t);
  assert.equal(completeQaRepairRound(f.repairOutput,
    { reviewOutput: recheck.reviewOutput, apply: true }).status, 'ESCALATE');
  const file = path.join(f.repairOutput, '000002.json');
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  current.payload.status = 'REWORK';
  current.payload.reasonCode = 'QA_REPAIR_FINDINGS_REMAIN';
  const { sha256, ...body } = current;
  current.sha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  fs.writeFileSync(file, `${JSON.stringify(current)}\n`);
  assert.equal(inspectQaRepair(f.repairOutput).status, 'BLOCKED');
});

test('introducing a different P0 while old P0 remains is an immediate regression', async t => {
  const f = await makeQaRepairFixture(t, { severity: 'P0' });
  const plan = planQaRepair({ project: f.project, reviewOutput: f.reviewOutput,
    outputDir: f.repairOutput, inScope: 'src/main.js', mutationBoundary: 'Fix P0 A only' });
  beginQaRepair(plan, { apply: true });
  startQaRepairRound(f.repairOutput, { apply: true });
  fs.appendFileSync(path.join(f.project, 'src/main.js'), '\n// changed\n');
  const recheck = await makeQaRepairRecheck(t, { severity: 'P0', sourceText: 'fresh-build',
    description: 'New severe defect B' });
  const result = completeQaRepairRound(f.repairOutput, { reviewOutput: recheck.reviewOutput, apply: true });
  assert.equal(result.status, 'ESCALATE');
  assert.equal(result.reasonCode, 'QA_REPAIR_P0_REGRESSION');
});
