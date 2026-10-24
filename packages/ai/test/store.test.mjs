import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeProject } from './helpers/project.mjs';
import { planNewRun, commitNewRun, readNativeRun, planNativeEvent, commitNativeEvent } from '../src/store.mjs';

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

test('checkpoints append immutable source-bound events and detect changed evidence', t => {
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
  assert.throws(() => readNativeRun(project, current.run.runId), /INTEGRITY|hash|SOURCE/);
});

test('multiple active runs block ambiguous latest selection', t => {
  const project = nativeProject(t);
  const first = commitNewRun(newRun(project));
  const second = commitNewRun(newRun(project));
  assert.notEqual(first.run.runId, second.run.runId);
  assert.throws(() => readNativeRun(project, 'latest'), /AMBIGUOUS/);
  assert.equal(readNativeRun(project, second.run.runId).status, 'ACTIVE');
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

test('foreign symlinked storage and stale project source block all native writes', t => {
  const project = nativeProject(t);
  const plan = newRun(project);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'changed\n');
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
