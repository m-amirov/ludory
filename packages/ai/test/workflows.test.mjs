import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nativeProject } from './helpers/project.mjs';
import { planWorkflow, executeWorkflow } from '../src/workflows.mjs';
import { readNativeRun } from '../src/store.mjs';

const startOptions = { pipeline: 'audit-repair-loop', target: 'EP3 QA', inScope: 'src/main.js',
  acceptance: 'checks complete', mutationBoundary: 'evidence only' };

test('native workflow doctor reports health without creating CEOS or Ludory run files', t => {
  const project = nativeProject(t);
  const result = executeWorkflow(planWorkflow(project, 'doctor'));
  assert.equal(result.status, 'OK');
  assert.equal(result.engine, 'ludory-ai');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  fs.mkdirSync(path.join(project, '.ludory', 'profiles'), { recursive: true });
  const noRuns = executeWorkflow(planWorkflow(project, 'status'));
  assert.equal(noRuns.status, 'BLOCKED');
  assert.match(noRuns.conflicts[0], /NATIVE_NO_RUN/);
  assert.equal(fs.existsSync(path.join(project, '.ludory', 'ai')), false);
  assert.throws(() => executeWorkflow(planWorkflow(project, 'doctor'), { apply: true }), /read-only/i);
});

test('native start plans first, commits once and exposes status/next without CEOS', t => {
  const project = nativeProject(t);
  const plan = planWorkflow(project, 'start', startOptions);
  assert.equal(plan.status, 'READY');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  assert.equal(executeWorkflow(plan).status, 'READY');
  const applied = executeWorkflow(plan, { apply: true });
  assert.equal(applied.status, 'APPLIED');
  assert.equal(applied.nextStage, 'EVIDENCE_COLLECTED');
  assert.equal(executeWorkflow(planWorkflow(project, 'status')).status, 'OK');
  const next = executeWorkflow(planWorkflow(project, 'next'));
  assert.equal(next.nextAction.kind, 'PERFORM_STAGE');
  assert.equal(next.nextAction.executable, false);
  assert.equal(next.nextAction.stage, 'EVIDENCE_COLLECTED');
});

test('continue applies an action request, never pretends an agent finished the stage', t => {
  const project = nativeProject(t);
  const started = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  const resume = planWorkflow(project, 'continue', { run: started.runId });
  assert.equal(executeWorkflow(resume).status, 'READY');
  assert.equal(readNativeRun(project, started.runId).events.length, 0);
  const requested = executeWorkflow(resume, { apply: true });
  assert.equal(requested.status, 'APPLIED');
  assert.equal(requested.nativeStatus, 'WAITING_FOR_EVIDENCE');
  assert.equal(readNativeRun(project, started.runId).nextStage, 'EVIDENCE_COLLECTED');
  assert.equal(executeWorkflow(planWorkflow(project, 'next', { run: started.runId })).nextAction.kind, 'AWAIT_EVIDENCE');
  assert.equal(planWorkflow(project, 'continue', { run: started.runId }).status, 'BLOCKED');
  const checkpoint = planWorkflow(project, 'checkpoint', { run: started.runId,
    stage: 'EVIDENCE_COLLECTED', artifact: 'src/main.js', outcome: 'CONTINUE' });
  assert.equal(executeWorkflow(checkpoint).status, 'READY');
  assert.equal(executeWorkflow(checkpoint, { apply: true }).nextStage, 'AUDITED');
  assert.equal(readNativeRun(project, started.runId).events.length, 2);
});

test('without native Release verifier terminal PASS remains explicitly blocked', t => {
  const project = nativeProject(t);
  const started = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  const unsupported = planWorkflow(project, 'checkpoint', { run: started.runId,
    stage: 'EVIDENCE_COLLECTED', artifact: 'src/main.js', outcome: 'PASS' });
  assert.equal(unsupported.status, 'BLOCKED');
  assert.match(unsupported.conflicts[0], /EVIDENCE_VERIFIER_NOT_READY/);
  assert.equal(readNativeRun(project, started.runId).events.length, 0);
});

test('native mutations revalidate project and block stale plans and unknown options', t => {
  const project = nativeProject(t);
  const stale = planWorkflow(project, 'start', startOptions);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'changed\n');
  assert.throws(() => executeWorkflow(stale, { apply: true }), /SOURCE|STALE/);
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  assert.throws(() => planWorkflow(project, 'start', { ...startOptions, command: 'rm -rf' }), /Unknown workflow option/);
});

test('terminal blocked run cannot continue and multiple active runs need explicit selection', t => {
  const project = nativeProject(t);
  const first = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  assert.equal(planWorkflow(project, 'status').status, 'BLOCKED');
  const blocked = executeWorkflow(planWorkflow(project, 'checkpoint', {
    run: first.runId, stage: 'EVIDENCE_COLLECTED', outcome: 'BLOCKED',
  }), { apply: true });
  assert.equal(blocked.nativeStatus, 'BLOCKED');
  assert.equal(planWorkflow(project, 'continue', { run: first.runId }).status, 'BLOCKED');
});
