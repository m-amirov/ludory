import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeProject, runGit } from './helpers/project.mjs';
import { planNewRun, commitNewRun, readNativeRun, planNativeEvent, commitNativeEvent, listNativeRuns } from '../src/store.mjs';

const scope = { target: 'EP3 QA', inScope: ['src/main.js'], outOfScope: [],
  acceptanceContract: 'all checks', mutationBoundary: 'only report evidence' };
const newRun = project => planNewRun(project, { pipeline: 'audit-repair-loop', scope });

test('native run plan is read-only and explicit commit publishes a verified run', t => {
  const project = nativeProject(t);
  const plan = newRun(project);
  assert.equal(plan.status, 'READY');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  const committed = commitNewRun(plan);
  assert.equal(committed.status, 'ACTIVE');
  assert.equal(committed.nextStage, 'EVIDENCE_COLLECTED');
  assert.equal(readNativeRun(project, committed.run.runId).integrity.ok, true);
  assert.equal(readNativeRun(project, 'latest').run.runId, committed.run.runId);
  assert.equal(fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8'), '// Original user code\n');
  assert.throws(() => commitNewRun(plan), /STALE|CONFLICT|already exists/);
});

test('checkpoints preserve immutable historical evidence even after game files change', t => {
  const project = nativeProject(t);
  const current = commitNewRun(newRun(project));
  const plan = planNativeEvent(project, current.run.runId, { kind: 'CHECKPOINT',
    stage: 'EVIDENCE_COLLECTED', outcome: 'CONTINUE', artifacts: ['src/main.js'],
  });
  assert.equal(readNativeRun(project, current.run.runId).events.length, 0);
  const progressed = commitNativeEvent(plan);
  assert.equal(progressed.nextStage, 'AUDITED');
  assert.equal(progressed.events.length, 1);
  assert.equal(progressed.events[0].artifacts[0].path, 'src/main.js');
  const stored = path.join(project, '.ludory', 'ai', 'runs', current.run.runId, 'events', '000001.json');
  const before = fs.readFileSync(stored);
  assert.throws(() => commitNativeEvent(plan), /STALE|CONFLICT/);
  assert.deepEqual(fs.readFileSync(stored), before);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'modified evidence\n');
  const history = readNativeRun(project, current.run.runId);
  assert.equal(history.integrity.ok, true);
  assert.deepEqual(history.events[0].artifacts, plan.event.artifacts);
});

test('multiple active runs block ambiguous latest selection', t => {
  const project = nativeProject(t);
  const first = commitNewRun(newRun(project));
  const second = commitNewRun(newRun(project));
  assert.notEqual(first.run.runId, second.run.runId);
  assert.throws(() => readNativeRun(project, 'latest'), /AMBIGUOUS/);
  assert.equal(readNativeRun(project, second.run.runId).status, 'ACTIVE');
  assert.deepEqual(listNativeRuns(project).map(item => item.runId).sort(),
    [first.run.runId, second.run.runId].sort());
});

test('incomplete run marker and checkpoint bytes cannot masquerade as valid state', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const base = path.join(project, '.ludory', 'ai', 'runs');
  const incomplete = path.join(base, 'foreign-incomplete');
  fs.mkdirSync(incomplete);
  fs.writeFileSync(path.join(incomplete, 'run.json'), '{}');
  assert.throws(() => readNativeRun(project, 'foreign-incomplete'), /INCOMPLETE|UNCOMMITTED/);
  assert.equal(readNativeRun(project, run.run.runId).integrity.ok, true);
  const eventsDir = path.join(base, run.run.runId, 'events');
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(path.join(eventsDir, '000001.json'), '{ broken');
  assert.throws(() => readNativeRun(project, run.run.runId), /INTEGRITY|event/i);
});

test('foreign symlinked storage and stale manifest block all native writes', t => {
  const project = nativeProject(t);
  const plan = newRun(project);
  const manifestPath = path.join(project, 'ludory.project.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version = '0.2.0';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  assert.throws(() => commitNewRun(plan), /SOURCE|STALE/);
  const second = nativeProject(t);
  fs.symlinkSync(project, path.join(second, '.ludory'));
  assert.throws(() => commitNewRun(newRun(second)), /SYMBOLIC|FOREIGN|INVALID|source/i);
});

test('foreign files in a preexisting native namespace are never adopted by a new run', t => {
  const project = nativeProject(t);
  const ai = path.join(project, '.ludory', 'ai');
  fs.mkdirSync(ai, { recursive: true });
  fs.writeFileSync(path.join(ai, 'foreign-user-file.txt'), 'owned');
  const plan = newRun(project);
  assert.throws(() => commitNewRun(plan), /NATIVE_STORAGE_FOREIGN_PATH/);
  assert.equal(fs.readFileSync(path.join(ai, 'foreign-user-file.txt'), 'utf8'), 'owned');
  assert.equal(fs.existsSync(path.join(ai, 'runs')), false);
});

test('run records and preflight plans are bound to this exact game root', t => {
  const sourceProject = nativeProject(t);
  const otherProject = nativeProject(t);
  const sourceRun = commitNewRun(newRun(sourceProject));
  const sourceStore = path.join(sourceProject, '.ludory', 'ai');
  const foreignStore = path.join(otherProject, '.ludory', 'ai');
  fs.cpSync(sourceStore, foreignStore, { recursive: true });
  assert.throws(() => readNativeRun(otherProject, sourceRun.run.runId), /NATIVE_INTEGRITY_PROJECT_BINDING/);

  const plan = newRun(sourceProject);
  const forged = { ...plan, project: otherProject };
  assert.throws(() => commitNewRun(forged), /NATIVE_STALE_RUN_PLAN/);
  assert.equal(fs.existsSync(path.join(foreignStore, 'runs', plan.run.runId)), false);
});

test('latest native checkpoint is sealed by its own immutable commit receipt', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  commitNativeEvent(planNativeEvent(project, run.run.runId, {
    kind: 'CHECKPOINT', stage: 'EVIDENCE_COLLECTED', outcome: 'CONTINUE', artifacts: ['src/main.js'],
  }));
  const eventsDir = path.join(project, '.ludory', 'ai', 'runs', run.run.runId, 'events');
  const eventPath = path.join(eventsDir, '000001.json');
  assert.equal(fs.existsSync(path.join(eventsDir, '000001.commit.json')), true);
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  event.at = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(eventPath, `${JSON.stringify(event, null, 2)}\n`);
  assert.throws(() => readNativeRun(project, run.run.runId), /NATIVE_INTEGRITY_EVENT_HASH/);
});

test('run publication never writes to a swapped external ai directory', t => {
  const project = nativeProject(t);
  const offsite = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-offsite-run-'));
  t.after(() => fs.rmSync(offsite, { recursive: true, force: true }));
  fs.mkdirSync(path.join(offsite, 'runs'));
  const plan = newRun(project);
  const ai = path.join(project, '.ludory', 'ai');
  const originalMkdir = fs.mkdirSync;
  let swapped = false;
  fs.mkdirSync = function (dir, ...args) {
    if (!swapped && (dir === plan.run.runId || String(dir).endsWith(`${path.sep}${plan.run.runId}`))) {
      swapped = true;
      fs.renameSync(ai, path.join(project, '.ludory', 'ai-owned'));
      fs.symlinkSync(offsite, ai, 'dir');
    }
    return originalMkdir.call(fs, dir, ...args);
  };
  try { assert.throws(() => commitNewRun(plan)); }
  finally { fs.mkdirSync = originalMkdir; }
  assert.equal(swapped, true);
  assert.deepEqual(fs.readdirSync(path.join(offsite, 'runs')), []);
});

test('event publication never writes through a swapped events directory', t => {
  const project = nativeProject(t);
  const offsite = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-offsite-event-'));
  t.after(() => fs.rmSync(offsite, { recursive: true, force: true }));
  const run = commitNewRun(newRun(project));
  const plan = planNativeEvent(project, run.run.runId, {
    kind: 'CHECKPOINT', stage: 'EVIDENCE_COLLECTED', outcome: 'CONTINUE', artifacts: ['src/main.js'],
  });
  const events = path.join(project, '.ludory', 'ai', 'runs', run.run.runId, 'events');
  const originalOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function (file, ...args) {
    if (!swapped && String(file).includes('.pending-')) {
      swapped = true;
      fs.renameSync(events, path.join(path.dirname(events), 'events-owned'));
      fs.symlinkSync(offsite, events, 'dir');
    }
    return originalOpen.call(fs, file, ...args);
  };
  try { assert.throws(() => commitNativeEvent(plan)); }
  finally { fs.openSync = originalOpen; }
  assert.equal(swapped, true);
  assert.deepEqual(fs.readdirSync(offsite), []);
});

test('historic checkpoints remain readable after edits and new commits, and can continue', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const first = planNativeEvent(project, run.run.runId, {
    kind: 'CHECKPOINT', stage: 'EVIDENCE_COLLECTED', outcome: 'CONTINUE', artifacts: ['src/main.js'],
  });
  const recordedSha = first.event.artifacts[0].sha256;
  commitNativeEvent(first);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), '// fixed code\n');
  runGit(project, 'add', 'src/main.js');
  runGit(project, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fix game');
  const after = readNativeRun(project, run.run.runId);
  assert.equal(after.events[0].artifacts[0].sha256, recordedSha);
  assert.equal(after.nextStage, 'AUDITED');
  const next = planNativeEvent(project, run.run.runId, {
    kind: 'CHECKPOINT', stage: 'AUDITED', outcome: 'CONTINUE', artifacts: ['src/main.js'],
  });
  assert.notEqual(next.event.artifacts[0].sha256, recordedSha);
  assert.equal(commitNativeEvent(next).nextStage, 'DEFECTS_CONFIRMED');
});

test('a moved game resumes its native run without accepting a copy into another live game', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const moved = `${project}-moved`;
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  fs.renameSync(project, moved);
  assert.equal(readNativeRun(moved, run.run.runId).nextStage, 'EVIDENCE_COLLECTED');
  const next = planNativeEvent(moved, run.run.runId, {
    kind: 'CHECKPOINT', stage: 'EVIDENCE_COLLECTED', outcome: 'CONTINUE', artifacts: ['src/main.js'],
  });
  assert.equal(commitNativeEvent(next).nextStage, 'AUDITED');
});

test('Codex execution result is recorded after request without granting a checkpoint or PASS', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const id = run.run.runId;
  commitNativeEvent(planNativeEvent(project, id, { kind: 'ACTION_REQUESTED', stage: 'EVIDENCE_COLLECTED', executor: 'codex' }));
  const result = { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0,
    transcriptSha256: 'a'.repeat(64), eventCount: 3, completed: true };
  const planned = planNativeEvent(project, id, { kind: 'EXECUTION_RESULT', stage: 'EVIDENCE_COLLECTED', result });
  assert.equal(planned.writes.length, 2);
  assert.equal(commitNativeEvent(planned).status, 'EXECUTED_UNVERIFIED');
  const history = readNativeRun(project, id);
  assert.equal(history.nextStage, 'EVIDENCE_COLLECTED');
  assert.deepEqual(history.events.map(event => event.kind), ['ACTION_REQUESTED', 'EXECUTION_RESULT']);
  assert.equal(history.events[1].result.transcriptSha256, 'a'.repeat(64));
  assert.equal(history.events[0].executor, 'codex');
  assert.equal(history.events[1].requestSha256, history.events[0].receiptSha256 ?? planned.event.prevSha256);
  assert.throws(() => planNativeEvent(project, id, { kind: 'ACTION_REQUESTED', stage: 'EVIDENCE_COLLECTED' }), /ALREADY|REQUESTED|EVIDENCE/);
  const checkpoint = planNativeEvent(project, id, { kind: 'CHECKPOINT', stage: 'EVIDENCE_COLLECTED',
    outcome: 'CONTINUE', artifacts: ['src/main.js'] });
  assert.equal(commitNativeEvent(checkpoint).nextStage, 'AUDITED');
});

test('failed agent attempt has durable receipt and can be explicitly retried', t => {
  const project = nativeProject(t);
  const id = commitNewRun(newRun(project)).run.runId;
  assert.throws(() => planNativeEvent(project, id, { kind: 'EXECUTION_RESULT', stage: 'EVIDENCE_COLLECTED',
    result: { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0, transcriptSha256: 'f'.repeat(64), eventCount: 2, completed: true } }), /REQUEST|RESULT/);
  commitNativeEvent(planNativeEvent(project, id, { kind: 'ACTION_REQUESTED', stage: 'EVIDENCE_COLLECTED', executor: 'codex' }));
  const failed = { ok: false, code: 'EXECUTOR_NONZERO_EXIT', exitCode: 3,
    transcriptSha256: 'b'.repeat(64), eventCount: 1, completed: false };
  commitNativeEvent(planNativeEvent(project, id, { kind: 'EXECUTION_RESULT', stage: 'EVIDENCE_COLLECTED', result: failed }));
  assert.equal(readNativeRun(project, id).status, 'EXECUTION_FAILED');
  commitNativeEvent(planNativeEvent(project, id, { kind: 'ACTION_REQUESTED', stage: 'EVIDENCE_COLLECTED', executor: 'codex' }));
  assert.equal(readNativeRun(project, id).status, 'WAITING_FOR_EVIDENCE');
});

test('forged or malformed executor result fails closed before publication', t => {
  const project = nativeProject(t);
  const id = commitNewRun(newRun(project)).run.runId;
  commitNativeEvent(planNativeEvent(project, id, { kind: 'ACTION_REQUESTED', stage: 'EVIDENCE_COLLECTED', executor: 'codex' }));
  for (const result of [
    { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0, transcriptSha256: 'BAD', eventCount: 1, completed: true },
    { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 5, transcriptSha256: 'f'.repeat(64), eventCount: 1, completed: true },
    { ok: false, code: 'CUSTOM_UNTRUSTED_CODE', exitCode: 1, transcriptSha256: 'f'.repeat(64), eventCount: 1, completed: false },
  ]) {
    assert.throws(() => planNativeEvent(project, id, { kind: 'EXECUTION_RESULT', stage: 'EVIDENCE_COLLECTED', result }), /EXECUTION|RESULT|INVALID/);
  }
  assert.equal(readNativeRun(project, id).events.length, 1);
});

test('an active Codex request blocks checkpoint until its exact result is committed', t => {
  const project = nativeProject(t);
  const id = commitNewRun(newRun(project)).run.runId;
  commitNativeEvent(planNativeEvent(project, id, {
    kind: 'ACTION_REQUESTED', stage: 'EVIDENCE_COLLECTED', executor: 'codex',
  }));
  const pending = readNativeRun(project, id);
  assert.equal(pending.pendingExecutor, 'codex');
  assert.throws(() => planNativeEvent(project, id, {
    kind: 'CHECKPOINT', stage: 'EVIDENCE_COLLECTED', artifacts: ['src/main.js'], outcome: 'CONTINUE',
  }), /EXECUTOR_PENDING_RESULT/);
  const finished = commitNativeEvent(planNativeEvent(project, id, {
    kind: 'EXECUTION_RESULT', stage: 'EVIDENCE_COLLECTED',
    result: { ok: false, code: 'EXECUTOR_NONZERO_EXIT', exitCode: 3,
      transcriptSha256: 'b'.repeat(64), eventCount: 2, completed: false },
  }));
  assert.equal(finished.pendingExecutor, null);
  assert.equal(commitNativeEvent(planNativeEvent(project, id, {
    kind: 'CHECKPOINT', stage: 'EVIDENCE_COLLECTED', artifacts: ['src/main.js'], outcome: 'CONTINUE',
  })).nextStage, 'AUDITED');
});

test('manually requested actions never accept a forged Codex execution result', t => {
  const project = nativeProject(t);
  const id = commitNewRun(newRun(project)).run.runId;
  commitNativeEvent(planNativeEvent(project, id, {
    kind: 'ACTION_REQUESTED', stage: 'EVIDENCE_COLLECTED',
  }));
  assert.equal(readNativeRun(project, id).pendingExecutor, null);
  assert.throws(() => planNativeEvent(project, id, {
    kind: 'EXECUTION_RESULT', stage: 'EVIDENCE_COLLECTED',
    result: { ok: true, code: 'EXECUTED_UNVERIFIED', exitCode: 0,
      transcriptSha256: 'b'.repeat(64), eventCount: 2, completed: true },
  }), /EXECUTION_RESULT_WITHOUT_REQUEST/);
});
