import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeProject, runGit } from './helpers/project.mjs';
import { planNewRun, commitNewRun, readNativeRun, planNativeEvent, commitNativeEvent, listNativeRuns,
  inspectNativeStorageRecovery, applyNativeStorageRecovery } from '../src/store.mjs';

test('interrupted journal remnants require confirmation and are quarantined without losing bytes', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const events = path.join(project, '.ludory', 'ai', 'runs', run.run.runId, 'events');
  const pending = path.join(events, '.pending-1234567890abcdef12345678');
  const bytes = Buffer.from('uncommitted journal bytes');
  fs.writeFileSync(pending, bytes);
  const lock = path.join(project, '.ludory', 'ai', '.lock');
  fs.writeFileSync(lock, '999999999\n');
  const preview = inspectNativeStorageRecovery(project, run.run.runId);
  assert.equal(preview.status, 'NEEDS_CONFIRMATION');
  assert.equal(preview.entries.length, 2);
  assert.throws(() => applyNativeStorageRecovery(preview), /CONFIRMATION_REQUIRED/);
  const recovered = applyNativeStorageRecovery(preview, { confirmNoExecutor: true });
  assert.equal(recovered.status, 'RECOVERED');
  assert.equal(fs.existsSync(pending), false);
  assert.equal(fs.existsSync(lock), false);
  assert.deepEqual(fs.readFileSync(recovered.quarantinedFiles.find(x => x.endsWith('event-pending-1234567890abcdef12345678'))), bytes);
  assert.equal(readNativeRun(project, run.run.runId).integrity.ok, true);
});

test('only an uncommitted final event may be quarantined; completed journal remains immutable', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const events = path.join(project, '.ludory', 'ai', 'runs', run.run.runId, 'events');
  const orphan = path.join(events, '000001.json');
  fs.writeFileSync(orphan, 'interrupted publication');
  const preview = inspectNativeStorageRecovery(project, run.run.runId);
  assert.equal(preview.entries.length, 1);
  assert.equal(preview.entries[0].label, 'event-000001.json');
  applyNativeStorageRecovery(preview, { confirmNoExecutor: true });
  assert.equal(readNativeRun(project, run.run.runId).events.length, 0);
  const plan = planNativeEvent(project, run.run.runId, {
    kind: 'CHECKPOINT', stage: 'EVIDENCE_COLLECTED', outcome: 'CONTINUE', artifacts: ['src/main.js'],
  });
  commitNativeEvent(plan);
  fs.writeFileSync(path.join(events, '000002.json'), 'partial');
  fs.writeFileSync(path.join(events, '000003.json'), 'suspicious later event');
  assert.throws(() => inspectNativeStorageRecovery(project, run.run.runId), /UNKNOWN_EVENT|SEQUENCE/);
});

test('recovery refuses a live lock, changed evidence and foreign journal entries', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const lock = path.join(project, '.ludory', 'ai', '.lock');
  fs.writeFileSync(lock, `${process.pid}\n`);
  assert.throws(() => inspectNativeStorageRecovery(project, run.run.runId), /EXECUTOR_MAY_BE_ACTIVE/);
  fs.unlinkSync(lock);
  const events = path.join(project, '.ludory', 'ai', 'runs', run.run.runId, 'events');
  const pending = path.join(events, '.pending-1234567890abcdef12345678');
  fs.writeFileSync(pending, 'first');
  const preview = inspectNativeStorageRecovery(project, run.run.runId);
  fs.writeFileSync(pending, 'second');
  assert.throws(() => applyNativeStorageRecovery(preview, { confirmNoExecutor: true }), /STALE_PLAN/);
  assert.equal(fs.readFileSync(pending, 'utf8'), 'second');
  fs.writeFileSync(path.join(events, 'surprise.txt'), 'other owner');
  assert.throws(() => inspectNativeStorageRecovery(project, run.run.runId), /UNKNOWN_EVENT_ENTRY/);
});

test('orphaned artistic review receipt is quarantined without discarding committed journal', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const reviews = path.join(project, '.ludory', 'ai', 'runs', run.run.runId, 'reviews');
  fs.mkdirSync(reviews);
  fs.writeFileSync(path.join(reviews, '000001.json'), 'interrupted observed receipt');
  const preview = inspectNativeStorageRecovery(project, run.run.runId);
  assert.deepEqual(preview.entries.map(x => x.label), ['review-000001.json']);
  const output = applyNativeStorageRecovery(preview, { confirmNoExecutor: true });
  assert.equal(fs.readFileSync(output.quarantinedFiles.find(x => x.endsWith('review-000001.json')), 'utf8'),
    'interrupted observed receipt');
  assert.equal(fs.readdirSync(reviews).filter(name => !name.startsWith('.recovered-')).length, 0);
  assert.equal(readNativeRun(project, run.run.runId).integrity.ok, true);
});

test('recovery never follows a substituted event directory outside its pinned source', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const dir = path.join(project, '.ludory', 'ai', 'runs', run.run.runId, 'events');
  fs.writeFileSync(path.join(dir, '.pending-1234567890abcdef12345678'), 'owned');
  const preview = inspectNativeStorageRecovery(project, run.run.runId);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-recovery-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, '.pending-1234567890abcdef12345678'), 'outside-user');
  const originalRename = fs.renameSync;
  let swapped = false;
  fs.renameSync = function (from, to) {
    if (!swapped && String(to).includes('.recovered-') && String(from).includes('.pending-')) {
      swapped = true;
      originalRename.call(fs, dir, `${dir}-original`);
      fs.symlinkSync(outside, dir, 'dir');
    }
    return originalRename.call(fs, from, to);
  };
  try { assert.throws(() => applyNativeStorageRecovery(preview, { confirmNoExecutor: true })); }
  finally { fs.renameSync = originalRename; }
  assert.equal(swapped, true);
  assert.equal(fs.readFileSync(path.join(outside, '.pending-1234567890abcdef12345678'), 'utf8'),
    'outside-user');
});

test('recovery never uses a replaceable quarantine directory as a rename destination', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const events = path.join(project, '.ludory', 'ai', 'runs', run.run.runId, 'events');
  fs.writeFileSync(path.join(events, '.pending-1234567890abcdef12345678'), 'owned');
  const preview = inspectNativeStorageRecovery(project, run.run.runId);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-recovery-destination-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'event-pending-1234567890abcdef12345678'), 'user-owned');
  const original = fs.renameSync;
  let unsafeDestination = false;
  fs.renameSync = function (from, to) {
    if (String(from).includes('.pending-') && path.isAbsolute(String(to))) {
      unsafeDestination = true;
      const recoveryDir = path.dirname(to);
      original.call(fs, recoveryDir, `${recoveryDir}-original`);
      fs.symlinkSync(outside, recoveryDir, 'dir');
    }
    return original.call(fs, from, to);
  };
  try { applyNativeStorageRecovery(preview, { confirmNoExecutor: true }); }
  finally { fs.renameSync = original; }
  assert.equal(unsafeDestination, false, 'destination must stay relative to the pinned source directory');
  assert.equal(fs.readFileSync(path.join(outside, 'event-pending-1234567890abcdef12345678'), 'utf8'), 'user-owned');
});

test('SIGKILL between event link and commit marker leaves a recoverable uncommitted tail', t => {
  const project = nativeProject(t);
  const run = commitNewRun(newRun(project));
  const storeUrl = new URL('../src/store.mjs', import.meta.url).href;
  const child = `
    import fs from 'node:fs';
    import { planNativeEvent, commitNativeEvent } from ${JSON.stringify(storeUrl)};
    const [project, runId] = process.argv.slice(1);
    const plan = planNativeEvent(project, runId, {
      kind: 'CHECKPOINT', stage: 'EVIDENCE_COLLECTED', outcome: 'CONTINUE', artifacts: ['src/main.js'],
    });
    const original = fs.linkSync;
    fs.linkSync = function(source, target) {
      original.call(fs, source, target);
      if (String(target).endsWith('000001.json')) process.kill(process.pid, 'SIGKILL');
    };
    commitNativeEvent(plan);
  `;
  const killed = spawnSync(process.execPath, ['--input-type=module', '-e', child, project, run.run.runId],
    { encoding: 'utf8', timeout: 10000 });
  assert.ok(killed.signal === 'SIGKILL' || (process.platform === 'win32' && killed.status !== 0),
    `worker did not terminate: ${killed.stderr}`);
  assert.equal(fs.existsSync(path.join(project, '.ludory', 'ai', 'runs', run.run.runId,
    'events', '000001.json')), true, 'worker must have linked the uncommitted event before termination');
  assert.throws(() => readNativeRun(project, run.run.runId), /NATIVE_INTEGRITY/);
  const preview = inspectNativeStorageRecovery(project, run.run.runId);
  assert.equal(preview.status, 'NEEDS_CONFIRMATION');
  assert.ok(preview.entries.some(x => x.label === 'event-000001.json'));
  assert.ok(preview.entries.some(x => x.label === 'lock'));
  const restored = applyNativeStorageRecovery(preview, { confirmNoExecutor: true });
  assert.equal(restored.status, 'RECOVERED');
  assert.equal(readNativeRun(project, run.run.runId).events.length, 0);
  assert.equal(fs.existsSync(restored.quarantinedFiles.find(x => x.endsWith('event-000001.json'))), true);
});

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
