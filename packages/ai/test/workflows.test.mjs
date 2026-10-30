import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nativeProject, newStudioAiProject } from './helpers/project.mjs';
import { planWorkflow, executeWorkflow } from '../src/workflows.mjs';
import { commitNativeEvent, planNativeEvent, readNativeRun } from '../src/store.mjs';

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
  const project = newStudioAiProject(t);
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
  const project = newStudioAiProject(t);
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
  const project = newStudioAiProject(t);
  const started = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  const unsupported = planWorkflow(project, 'checkpoint', { run: started.runId,
    stage: 'EVIDENCE_COLLECTED', artifact: 'src/main.js', outcome: 'PASS' });
  assert.equal(unsupported.status, 'BLOCKED');
  assert.match(unsupported.conflicts[0], /EVIDENCE_VERIFIER_NOT_READY/);
  assert.equal(readNativeRun(project, started.runId).events.length, 0);
});

test('native mutations revalidate project and block stale plans and unknown options', t => {
  const project = newStudioAiProject(t);
  const editing = planWorkflow(project, 'start', startOptions);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'changed\n');
  assert.equal(executeWorkflow(editing, { apply: true }).status, 'APPLIED');
  const stale = planWorkflow(project, 'start', startOptions);
  const manifest = path.join(project, 'ludory.project.json');
  const updated = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  updated.version = '0.2.0';
  fs.writeFileSync(manifest, `${JSON.stringify(updated)}\n`);
  assert.throws(() => executeWorkflow(stale, { apply: true }), /SOURCE|STALE|STUDIO_ORIGIN/);
  assert.throws(() => planWorkflow(project, 'start', { ...startOptions, command: 'rm -rf' }), /Unknown workflow option/);
});

test('terminal blocked run cannot continue and multiple active runs need explicit selection', t => {
  const project = newStudioAiProject(t);
  const first = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  const second = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  const listing = planWorkflow(project, 'status');
  assert.equal(listing.status, 'OK');
  assert.equal(listing.nativeStatus, 'MULTIPLE_ACTIVE');
  assert.deepEqual(listing.runs.map(item => item.runId).sort(), [first.runId, second.runId].sort());
  assert.equal(planWorkflow(project, 'next').status, 'BLOCKED');
  assert.match(planWorkflow(project, 'next').conflicts[0], new RegExp(first.runId));
  const blocked = executeWorkflow(planWorkflow(project, 'checkpoint', {
    run: first.runId, stage: 'EVIDENCE_COLLECTED', outcome: 'BLOCKED',
  }), { apply: true });
  assert.equal(blocked.nativeStatus, 'BLOCKED');
  assert.equal(planWorkflow(project, 'continue', { run: first.runId }).status, 'BLOCKED');
});

test('opt-in Codex preview is side-effect-free and --apply records a real unverified execution', t => {
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const plan = planWorkflow(project, 'continue', { run: id, executor: 'codex' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.executor, 'codex');
  assert.equal(plan.mutationScope, 'workspace-write');
  let calls = 0;
  const executor = {
    check: () => { calls++; return { ok: true, code: 'AVAILABLE' }; },
    run: () => {
      calls++;
      const attempted = planWorkflow(project, 'checkpoint', {
        run: id, stage: 'EVIDENCE_COLLECTED', artifact: 'src/main.js', outcome: 'CONTINUE',
      });
      assert.equal(attempted.status, 'BLOCKED');
      assert.match(attempted.conflicts[0], /EXECUTOR_PENDING_RESULT/);
      assert.equal(planWorkflow(project, 'next', { run: id }).nextAction.kind, 'AWAIT_EXECUTOR_RESULT');
      fs.writeFileSync(path.join(project, 'src', 'main.js'), '// generated by fake codex\n');
      return { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0,
        transcriptSha256: 'f'.repeat(64), eventCount: 3, completed: true };
    },
  };
  assert.equal(executeWorkflow(plan, { executor }).status, 'READY');
  assert.equal(calls, 0);
  const applied = executeWorkflow(plan, { apply: true, executor });
  assert.equal(calls, 2);
  assert.equal(applied.status, 'EXECUTED_UNVERIFIED');
  assert.equal(applied.nativeStatus, 'EXECUTED_UNVERIFIED');
  assert.equal(applied.nextAction.kind, 'AWAIT_EVIDENCE');
  assert.equal(readNativeRun(project, id).events.length, 2);
  assert.equal(readNativeRun(project, id).nextStage, 'EVIDENCE_COLLECTED');
  assert.equal(fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8'), '// generated by fake codex\n');
  assert.equal(planWorkflow(project, 'continue', { run: id, executor: 'codex' }).status, 'BLOCKED');
});

test('missing Codex blocks before writing a request; attempted failure is recorded for retry', t => {
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const preview = planWorkflow(project, 'continue', { run: id, executor: 'codex' });
  const unavailable = executeWorkflow(preview, { apply: true, executor: {
    check: () => ({ ok: false, code: 'EXECUTOR_UNAVAILABLE' }),
    run: () => { throw Error('must not run'); },
  } });
  assert.equal(unavailable.status, 'BLOCKED');
  assert.equal(readNativeRun(project, id).events.length, 0);
  const failed = executeWorkflow(preview, { apply: true, executor: {
    check: () => ({ ok: true, code: 'AVAILABLE' }),
    run: () => ({ ok: false, code: 'EXECUTOR_NONZERO_EXIT', exitCode: 2,
      transcriptSha256: 'e'.repeat(64), eventCount: 2, completed: false }),
  } });
  assert.equal(failed.status, 'FAILED');
  assert.equal(readNativeRun(project, id).status, 'EXECUTION_FAILED');
  assert.equal(planWorkflow(project, 'continue', { run: id, executor: 'codex' }).status, 'READY');
});

test('interrupted Codex execution requires explicit recovery confirmation and preserves partial files', t => {
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const request = planWorkflow(project, 'continue', { run: id, executor: 'codex' });
  fs.writeFileSync(path.join(project, 'src', 'main.js'), '// partial work\n');
  commitNativeEvent(request.nativePlan); // Simulate parent termination after ACTION_REQUESTED.

  const recovery = planWorkflow(project, 'recover', { run: id });
  assert.equal(recovery.status, 'READY');
  assert.equal(recovery.nextAction.kind, 'CONFIRM_EXECUTOR_STOPPED');
  assert.match(recovery.warning, /no Codex process|не.*Codex/i);
  const unconfirmed = executeWorkflow(recovery, { apply: true });
  assert.equal(unconfirmed.status, 'BLOCKED');
  assert.match(unconfirmed.conflicts[0], /CONFIRM/);
  assert.equal(readNativeRun(project, id).events.length, 1);

  const confirmed = executeWorkflow(planWorkflow(project, 'recover', {
    run: id, confirmNoExecutor: true,
  }), { apply: true });
  assert.equal(confirmed.status, 'APPLIED');
  assert.equal(confirmed.nativeStatus, 'EXECUTION_FAILED');
  assert.equal(confirmed.nextAction.kind, 'RETRY_EXECUTOR');
  assert.equal(readNativeRun(project, id).events.length, 2);
  assert.equal(readNativeRun(project, id).events[1].result.code, 'EXECUTOR_INTERRUPTED');
  assert.equal(fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8'), '// partial work\n');
  assert.equal(planWorkflow(project, 'continue', { run: id, executor: 'codex' }).status, 'READY');
});

test('lost external result does not restart Codex, replay recovery, or overwrite dirty game files', t => {
  const project = newStudioAiProject(t);
  const note = path.join(project, 'untracked-owner-note.txt');
  fs.writeFileSync(note, 'owner draft must survive\n');
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const planned = planWorkflow(project, 'continue', { run: id, executor: 'codex' });
  const source = path.join(project, 'src', 'main.js');
  fs.writeFileSync(source, '// interrupted partial edit\n');
  commitNativeEvent(planned.nativePlan); // Lost parent after durable request, before result.
  assert.equal(readNativeRun(project, id).pendingExecutor, 'codex');
  assert.equal(planWorkflow(project, 'continue', { run: id, executor: 'codex' }).status, 'BLOCKED');
  const confirm = planWorkflow(project, 'recover', { run: id, confirmNoExecutor: true });
  assert.equal(executeWorkflow(planWorkflow(project, 'recover', { run: id }), { apply: true }).status, 'BLOCKED');
  const finished = executeWorkflow(confirm, { apply: true });
  assert.equal(finished.nativeStatus, 'EXECUTION_FAILED');
  assert.equal(readNativeRun(project, id).events.at(-1).result.code, 'EXECUTOR_INTERRUPTED');
  assert.throws(() => executeWorkflow(confirm, { apply: true }), /STALE|CONFLICT|PENDING|REQUEST/);
  assert.equal(fs.readFileSync(source, 'utf8'), '// interrupted partial edit\n');
  assert.equal(fs.readFileSync(note, 'utf8'), 'owner draft must survive\n');
});

test('executor never starts on a project lacking Studio creation receipt', t => {
  const project = nativeProject(t);
  const preview = planWorkflow(project, 'continue', { run: 'latest', executor: 'codex' });
  assert.equal(preview.status, 'BLOCKED');
  assert.match(preview.conflicts[0], /STUDIO|FROZEN|CREATION/);
  assert.equal(planWorkflow(project, 'start', startOptions).status, 'BLOCKED');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});

test('an amended executor preview cannot redirect Codex to another directory', t => {
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const plan = planWorkflow(project, 'continue', { run: id, executor: 'codex' });
  const other = nativeProject(t);
  plan.executorPlan.project = other;
  let invoked = 0;
  assert.throws(() => executeWorkflow(plan, { apply: true, executor: {
    check: () => { invoked++; return { ok: true }; },
    run: () => { invoked++; return { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0,
      transcriptSha256: 'a'.repeat(64), eventCount: 2, completed: true }; },
  } }), /EXECUTOR_PLAN_TAMPERED|STALE/);
  assert.equal(invoked, 0);
  assert.equal(readNativeRun(project, id).events.length, 0);
});

test('a valid event plan from a different run cannot be spliced into Codex execution', t => {
  const project = newStudioAiProject(t);
  const first = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const second = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const attacker = planWorkflow(project, 'continue', { run: first, executor: 'codex' });
  const other = planWorkflow(project, 'continue', { run: second, executor: 'codex' });
  attacker.nativePlan = other.nativePlan;
  let checks = 0;
  assert.throws(() => executeWorkflow(attacker, { apply: true, executor: {
    check: () => { checks++; return { ok: true }; },
    run: () => { checks++; return { ok: false }; },
  } }), /EXECUTOR_PLAN_TAMPERED_OR_STALE/);
  assert.equal(checks, 0);
  assert.equal(readNativeRun(project, first).events.length, 0);
  assert.equal(readNativeRun(project, second).events.length, 0);
});

test('a valid same-run checkpoint event cannot be substituted for a Codex request', t => {
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const preview = planWorkflow(project, 'continue', { run: id, executor: 'codex' });
  const checkpoint = planWorkflow(project, 'checkpoint', {
    run: id, stage: 'EVIDENCE_COLLECTED', artifact: 'src/main.js', outcome: 'CONTINUE',
  });
  preview.nativePlan = checkpoint.nativePlan;
  let checks = 0;
  assert.throws(() => executeWorkflow(preview, { apply: true, executor: {
    check: () => { checks++; return { ok: true }; },
    run: () => { checks++; return { ok: false }; },
  } }), /EXECUTOR_PLAN_TAMPERED_OR_STALE/);
  assert.equal(checks, 0);
  assert.equal(readNativeRun(project, id).events.length, 0);
});

test('cycle preview is read-only and a successful check stops at unverified manual checkpoint', t => {
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const plan = planWorkflow(project, 'cycle', { run: id, test: 'src/main.test.js', repairs: '2' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.requiredCommand, 'node --test src/main.test.js');
  assert.equal(readNativeRun(project, id).events.length, 0);
  let invoked = 0;
  const executor = { check: () => ({ ok: true }), run: attempt => {
    invoked++;
    assert.equal(attempt.requiredCommand, 'node --test src/main.test.js');
    return { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0,
      transcriptSha256: 'a'.repeat(64), eventCount: 3, completed: true };
  } };
  assert.equal(executeWorkflow(plan, { executor }).status, 'READY');
  assert.equal(invoked, 0);
  const result = executeWorkflow(plan, { apply: true, executor });
  assert.equal(result.status, 'EXECUTED_UNVERIFIED');
  assert.equal(result.attempts, 1);
  assert.equal(result.nextAction.kind, 'AWAIT_EVIDENCE');
  assert.equal(readNativeRun(project, id).events.length, 2);
  assert.equal(readNativeRun(project, id).nextStage, 'EVIDENCE_COLLECTED');
});

test('cycle performs bounded repairs on failed test telemetry and stops after 3 attempts', t => {
  for (const passingAttempt of [2, Infinity]) {
    const project = newStudioAiProject(t);
    const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
    let invoked = 0;
    const executor = { check: () => ({ ok: true }), run: executionPlan => {
      invoked++;
      if (invoked > 1) assert.match(executionPlan.input, /previous attempt.*failed or missing/i);
      else assert.doesNotMatch(executionPlan.input, /previous attempt.*failed or missing/i);
      const ok = invoked === passingAttempt;
      return { ok, code: ok ? 'EXECUTED_UNVERIFIED' : 'EXECUTOR_CHECKS_FAILED', exitCode: 0,
        transcriptSha256: 'f'.repeat(64), eventCount: 4, completed: true };
    } };
    const result = executeWorkflow(planWorkflow(project, 'cycle', { run: id,
      test: 'src/main.test.js', repairs: 2 }), { apply: true, executor });
    assert.equal(result.attempts, passingAttempt === Infinity ? 3 : 2);
    assert.equal(invoked, result.attempts);
    assert.equal(result.status, passingAttempt === Infinity ? 'FAILED_CHECKS' : 'EXECUTED_UNVERIFIED');
    assert.equal(readNativeRun(project, id).events.length, result.attempts * 2);
    assert.equal(readNativeRun(project, id).nextStage, 'EVIDENCE_COLLECTED');
    assert.equal(readNativeRun(project, id).status,
      passingAttempt === Infinity ? 'EXECUTION_FAILED' : 'EXECUTED_UNVERIFIED');
  }
});

test('cycle stops on infrastructure failures without hidden retries', t => {
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  let invoked = 0;
  const result = executeWorkflow(planWorkflow(project, 'cycle', {
    run: id, test: 'src/main.test.js', repairs: 2,
  }), { apply: true, executor: { check: () => ({ ok: true }), run: () => {
    invoked++;
    return { ok: false, code: 'EXECUTOR_TIMEOUT', exitCode: null,
      transcriptSha256: 'e'.repeat(64), eventCount: 0, completed: false };
  } } });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.attempts, 1);
  assert.equal(invoked, 1);
  assert.equal(readNativeRun(project, id).events.length, 2);
});

test('cycle rejects frozen games, unsafe tests, invalid budgets, pending runs and stale previews', t => {
  const frozen = nativeProject(t);
  assert.equal(planWorkflow(frozen, 'cycle', { run: 'latest', test: 'src/main.test.js' }).status, 'BLOCKED');
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  const args = { run: id, test: 'src/main.test.js' };
  for (const testPath of ['../outside.test.js', '/tmp/a.test.js', 'src/evil;rm.test.js',
    '.ludory/ai/evil.test.js', 'src/main.js', 'src\\main.test.js']) {
    const result = planWorkflow(project, 'cycle', { ...args, test: testPath });
    assert.equal(result.status, 'BLOCKED', testPath);
  }
  for (const repairs of [-1, 3, '2.5', 'abc']) {
    assert.equal(planWorkflow(project, 'cycle', { ...args, repairs }).status, 'BLOCKED');
  }
  assert.throws(() => planWorkflow(project, 'cycle', { ...args, executor: 'codex' }), /Unknown workflow option/);
  const preview = planWorkflow(project, 'cycle', args);
  const other = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  preview.runId = other.runId;
  assert.throws(() => executeWorkflow(preview, { apply: true }), /TAMPERED|STALE/);
  const pending = planWorkflow(project, 'continue', { run: id, executor: 'codex' });
  commitNativeEvent(pending.nativePlan);
  assert.equal(planWorkflow(project, 'cycle', args).status, 'BLOCKED');
});

test('cycle rejects symlinked test ancestors and stops before writes if Codex is unavailable', t => {
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  fs.symlinkSync(path.join(project, 'src'), path.join(project, 'linked'));
  assert.equal(planWorkflow(project, 'cycle', { run: id, test: 'linked/main.test.js' }).status, 'BLOCKED');
  const good = planWorkflow(project, 'cycle', { run: id, test: 'src/main.test.js', repairs: 0 });
  let ran = false;
  const result = executeWorkflow(good, { apply: true, executor: {
    check: () => ({ ok: false, code: 'EXECUTOR_UNAVAILABLE' }),
    run: () => { ran = true; throw Error('unexpected'); },
  } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.attempts, 0);
  assert.equal(ran, false);
  assert.equal(readNativeRun(project, id).events.length, 0);
});

test('cycle rechecks test paths between repairs and stops if Codex replaced a test with a symlink', t => {
  const project = newStudioAiProject(t);
  const id = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true }).runId;
  let invoked = 0;
  const result = executeWorkflow(planWorkflow(project, 'cycle', { run: id,
    test: 'src/main.test.js', repairs: 2 }), { apply: true, executor: {
    check: () => ({ ok: true }),
    run: () => {
      invoked++;
      fs.symlinkSync(path.join(project, 'src', 'main.js'), path.join(project, 'src', 'main.test.js'));
      return { ok: false, code: 'EXECUTOR_CHECKS_FAILED', exitCode: 0,
        transcriptSha256: 'f'.repeat(64), eventCount: 2, completed: true };
    },
  } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.attempts, 1);
  assert.equal(invoked, 1);
  assert.match(result.conflicts[0], /UNSAFE_TEST_PATH/);
  assert.equal(readNativeRun(project, id).events.length, 2);
});
