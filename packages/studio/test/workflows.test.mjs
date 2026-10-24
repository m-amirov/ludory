import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeCeos, fakeProject } from './helpers/fake-ceos.mjs';
import { planWorkflow, executeWorkflow } from '../src/workflows.mjs';

const actionFile = project => path.join(project, 'fake-ceos-actions.txt');
const sourceFile = project => path.join(project, 'src', 'main.js');

test('doctor/status/next use exact pinned CEOS argv and are read-only', t => {
  const { entry } = fakeCeos(t);
  const project = fakeProject(t);
  const source = fs.readFileSync(sourceFile(project));
  const doctor = executeWorkflow(planWorkflow(project, 'doctor', { entry }));
  assert.equal(doctor.ceosExitCode, 0);
  assert.deepEqual(doctor.ceos.argv, ['doctor', '--project', project, '--json']);
  const status = executeWorkflow(planWorkflow(project, 'status', { entry, run: 'run-123' }));
  assert.deepEqual(status.ceos.argv, ['run-status', 'run-123', '--project', project, '--json']);
  const next = executeWorkflow(planWorkflow(project, 'next', { entry }));
  assert.deepEqual(next.ceos.argv, ['continue', 'latest', '--mode', 'inspect', '--project', project, '--json']);
  assert.equal(fs.existsSync(actionFile(project)), false);
  assert.deepEqual(fs.readFileSync(sourceFile(project)), source);
});

test('start preview cannot invoke CEOS; explicit apply transmits literal scope as one argument', t => {
  const { entry } = fakeCeos(t);
  const project = fakeProject(t);
  const options = { entry, pipeline: 'audit-repair-loop', target: 'Audit $(touch injected)',
    inScope: 'tests;src/main.js', acceptance: 'real evidence', mutationBoundary: 'tests', outOfScope: 'deployment' };
  const plan = planWorkflow(project, 'start', options);
  assert.equal(plan.status, 'READY');
  assert.equal(executeWorkflow(plan).status, 'READY');
  assert.equal(fs.existsSync(actionFile(project)), false);
  const run = executeWorkflow(plan, { apply: true });
  assert.equal(run.status, 'APPLIED');
  assert.deepEqual(run.ceos.argv, ['run', 'audit-repair-loop', '--target', options.target,
    '--in-scope', 'tests;src/main.js', '--acceptance', 'real evidence', '--mutation-boundary', 'tests',
    '--out-of-scope', 'deployment', '--project', project, '--json']);
  assert.equal(fs.readFileSync(actionFile(project), 'utf8'), 'run\n');
  assert.equal(fs.existsSync(path.join(project, 'injected')), false);
});

test('continue default previews inspect; guided recovery only occurs with apply', t => {
  const { entry } = fakeCeos(t);
  const project = fakeProject(t);
  const plan = planWorkflow(project, 'continue', { entry, run: 'latest' });
  const preview = executeWorkflow(plan);
  assert.equal(preview.status, 'READY');
  assert.deepEqual(preview.ceos.argv, ['continue', 'latest', '--mode', 'inspect', '--project', project, '--json']);
  assert.equal(fs.existsSync(actionFile(project)), false);
  const applied = executeWorkflow(plan, { apply: true });
  assert.equal(applied.status, 'APPLIED');
  assert.deepEqual(applied.ceos.argv, ['continue', 'latest', '--mode', 'guided', '--project', project, '--json']);
  assert.equal(fs.readFileSync(actionFile(project), 'utf8'), 'continue\n');
});

test('checkpoint needs explicit apply and only forwards selected stage/evidence', t => {
  const { entry } = fakeCeos(t);
  const project = fakeProject(t);
  const plan = planWorkflow(project, 'checkpoint', { entry, run: 'latest', stage: 'VERIFIED',
    artifact: 'evidence/proof.json;tests/results.json', outcome: 'CONTINUE' });
  assert.equal(executeWorkflow(plan).status, 'READY');
  assert.equal(fs.existsSync(actionFile(project)), false);
  const result = executeWorkflow(plan, { apply: true });
  assert.deepEqual(result.ceos.argv, ['checkpoint', 'latest', '--stage', 'VERIFIED',
    '--artifact', 'evidence/proof.json;tests/results.json', '--outcome', 'CONTINUE', '--project', project, '--json']);
  assert.equal(fs.readFileSync(actionFile(project), 'utf8'), 'checkpoint\n');
});

test('unsupported pipelines, identifiers and absent canonical manifest fail closed', t => {
  const { entry } = fakeCeos(t);
  const project = fakeProject(t);
  assert.throws(() => planWorkflow(project, 'start', { entry, pipeline: 'deploy', target: 'x', inScope: 'src', acceptance: 'ok', mutationBoundary: 'src' }), /Unsupported pipeline/);
  assert.throws(() => planWorkflow(project, 'next', { entry, run: '--inject' }), /Invalid run/);
  assert.throws(() => planWorkflow(project, 'checkpoint', { entry, stage: '../CHECK', outcome: 'PASS' }), /Invalid stage/);
  assert.throws(() => planWorkflow(project, 'checkpoint', { entry, stage: 'VERIFIED', artifact: '../secrets' }), /Invalid artifact/);
  fs.unlinkSync(path.join(project, 'ludory.project.json'));
  assert.throws(() => planWorkflow(project, 'doctor', { entry }), /manifest/i);
});

test('changes to manifest, CEOS entry or project root invalidate pending mutating plans', t => {
  const ceos = fakeCeos(t);
  const project = fakeProject(t);
  const opt = { entry: ceos.entry, pipeline: 'audit-repair-loop', target: 'Audit', inScope: 'src',
    acceptance: 'evidence', mutationBoundary: 'src' };
  const plan = planWorkflow(project, 'start', opt);
  fs.appendFileSync(path.join(project, 'ludory.project.json'), '\n');
  assert.throws(() => executeWorkflow(plan, { apply: true }), /Stale workflow plan/);
  assert.equal(fs.existsSync(actionFile(project)), false);
  const current = planWorkflow(project, 'start', opt);
  fs.appendFileSync(ceos.entry, '\n// modified version-preserving entry\n');
  assert.throws(() => executeWorkflow(current, { apply: true }), /Stale workflow plan/);
  assert.equal(fs.existsSync(actionFile(project)), false);
});

test('CEOS BLOCKED/ESCALATE exit codes cannot be promoted into applied success', t => {
  const blocked = fakeCeos(t, { exitCode: 2 });
  const escalated = fakeCeos(t, { exitCode: 3 });
  const project = fakeProject(t);
  const status = executeWorkflow(planWorkflow(project, 'status', { entry: blocked.entry }));
  assert.equal(status.status, 'BLOCKED');
  assert.equal(status.ceosExitCode, 2);
  assert.equal(status.ceos.status, 'BLOCKED');
  const stopped = executeWorkflow(planWorkflow(project, 'next', { entry: escalated.entry }));
  assert.equal(stopped.status, 'ESCALATE');
  assert.equal(stopped.ceosExitCode, 3);
});
