import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { nativeProject, newStudioAiProject } from './helpers/project.mjs';
import { hasStudioCreationReceipt } from '../src/executor.mjs';
import { planWorkflow, executeWorkflow } from '../src/workflows.mjs';
import { planNewRun, commitNewRun, planNativeEvent, commitNativeEvent, readNativeRun } from '../src/store.mjs';
import { planCreate, applyCreatePlan } from '../../studio/src/scaffold.mjs';
import { planTaskRoute } from '../src/task-routing.mjs';
import { planDevDraft } from '../src/draft-tasks.mjs';
import { planImageTask } from '../src/image-tasks.mjs';
import { planNarrativeReview } from '../src/narrative-review.mjs';
import { planArtReview } from '../src/art-review.mjs';
import { planQualityEnable } from '../src/quality-policy.mjs';
import { planQualityCheck } from '../src/quality-checks.mjs';

const startOptions = { pipeline: 'audit-repair-loop', target: 'Test frozen game',
  inScope: 'src/main.js', acceptance: 'Only authorized changes', mutationBoundary: 'game' };

test('Studio-created unversioned and dirty Git games support native start, continue and checkpoint', t => {
  for (const git of [false, true]) {
    const project = newStudioAiProject(t, { git });
    assert.equal(fs.existsSync(path.join(project, '.git')), git);
    fs.writeFileSync(path.join(project, 'src', 'main.js'), '// Modified owner source\n');
    fs.writeFileSync(path.join(project, 'owner-notes.txt'), 'An untracked owner draft\n');
    const planned = planWorkflow(project, 'start', startOptions);
    assert.equal(planned.status, 'READY');
    const started = executeWorkflow(planned, { apply: true });
    assert.equal(started.status, 'APPLIED');
    const continued = executeWorkflow(planWorkflow(project, 'continue', { run: started.runId }), { apply: true });
    assert.equal(continued.status, 'APPLIED');
    const checkpointed = executeWorkflow(planWorkflow(project, 'checkpoint', {
      run: started.runId, stage: 'EVIDENCE_COLLECTED', artifact: 'src/main.js', outcome: 'CONTINUE',
    }), { apply: true });
    assert.equal(checkpointed.status, 'APPLIED');
    assert.equal(fs.readFileSync(path.join(project, 'owner-notes.txt'), 'utf8'), 'An untracked owner draft\n');
    assert.equal(fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8'), '// Modified owner source\n');
  }
});

function treeFingerprint(root) {
  const entries = [];
  function visit(folder, relative = '') {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(folder, entry.name), name);
      else entries.push([name, crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, entry.name))).digest('hex')]);
    }
  }
  visit(root);
  return JSON.stringify(entries);
}

function forgeReceipt(project) {
  fs.writeFileSync(path.join(project, 'ludory.studio.json'), JSON.stringify({
    schemaVersion: 1, profile: { id: 'web-game' }, template: { id: 'web-basic' },
    files: { 'ludory.project.json': crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(project, 'ludory.project.json'))).digest('hex') },
  }));
}

function newStudioGame(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-ai-origin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const location = path.join(root, 'game');
  fs.mkdirSync(location);
  // Windows 8.3 aliases in os.tmpdir() must not become host trust record keys.
  const project = fs.realpathSync.native(location);
  const planned = planCreate(project, { id: 'trusted-ai-game', title: 'Trusted AI Game', lang: 'en',
    profile: 'web-game', template: 'web-basic', targets: ['yandex-games'] });
  assert.equal(applyCreatePlan(planned).status, 'APPLIED');
  return { root, project };
}

function removeHostPin(project) {
  const registry = process.env.LUDORY_STUDIO_TRUST_DIR;
  assert.ok(registry);
  const physical = fs.realpathSync.native(project);
  const record = path.join(registry, `${crypto.createHash('sha256').update(Buffer.from(physical)).digest('hex')}.json`);
  assert.equal(fs.existsSync(record), true);
  fs.unlinkSync(record);
}

test('foreign game cannot start a native AI run even with a valid game manifest', t => {
  const project = nativeProject(t);
  const before = treeFingerprint(project);
  const preview = planWorkflow(project, 'start', startOptions);
  assert.equal(preview.status, 'BLOCKED');
  assert.match(preview.conflicts.join(' '), /STUDIO_ORIGIN/);
  assert.equal(treeFingerprint(project), before);
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});

test('forged local Studio receipt cannot start workflows or authorize Codex', t => {
  const project = nativeProject(t);
  forgeReceipt(project);
  const before = treeFingerprint(project);
  assert.equal(hasStudioCreationReceipt(project), false);
  const preview = planWorkflow(project, 'start', startOptions);
  assert.equal(preview.status, 'BLOCKED');
  assert.equal(treeFingerprint(project), before);
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});

test('foreign and forged projects block every direct AI entrypoint without probing hosts or writing', async t => {
  for (const forged of [false, true]) {
    const project = nativeProject(t);
    if (forged) forgeReceipt(project);
    const run = commitNewRun(planNewRun(project, { pipeline: 'production-art', scope: {
      target: 'Cross-entrypoint', inScope: ['src/main.js'], outOfScope: [],
      acceptanceContract: 'Read-only probe', mutationBoundary: 'No mutation',
    } })).run.runId;
    const before = treeFingerprint(project);
    let probes = 0;
    const discover = () => { probes++; throw new Error('FOREIGN_HOST_SHOULD_NOT_RUN'); };
    assert.equal(planTaskRoute(project, { taskKind: 'mechanics' }, { discover }).status, 'BLOCKED');
    assert.equal(planDevDraft(project, { run, taskKind: 'episode-script', brief: 'src/main.js' },
      { discover }).status, 'BLOCKED');
    assert.equal((await planImageTask(project, { run, brief: 'src/main.js', model: 'terra' },
      { discover })).status, 'BLOCKED');
    assert.equal(planArtReview(project, { run, image: 'image.png', sources: [], contextReviewed: true },
      { discover }).status, 'BLOCKED');
    assert.equal(planNarrativeReview(project, { run }, { discover }).status, 'BLOCKED');
    assert.equal(planQualityEnable(project).status, 'BLOCKED');
    assert.equal(planQualityCheck(project).status, 'BLOCKED');
    assert.equal(probes, 0);
    assert.equal(treeFingerprint(project), before);
  }
});

test('foreign native run cannot continue, checkpoint or recover a pending executor', t => {
  const project = nativeProject(t);
  const created = commitNewRun(planNewRun(project, { pipeline: 'audit-repair-loop', scope: {
    target: startOptions.target, inScope: [startOptions.inScope], outOfScope: [],
    acceptanceContract: startOptions.acceptance, mutationBoundary: startOptions.mutationBoundary,
  } }));
  const run = created.run.runId;
  const before = treeFingerprint(project);
  for (const [operation, options] of [
    ['continue', { run }],
    ['checkpoint', { run, stage: 'EVIDENCE_COLLECTED', artifact: 'src/main.js' }],
  ]) {
    const preview = planWorkflow(project, operation, options);
    assert.equal(preview.status, 'BLOCKED', operation);
    assert.match(preview.conflicts.join(' '), /STUDIO_ORIGIN/, operation);
  }
  assert.equal(treeFingerprint(project), before);

  commitNativeEvent(planNativeEvent(project, run, {
    kind: 'ACTION_REQUESTED', stage: 'EVIDENCE_COLLECTED', executor: 'codex',
  }));
  const pending = treeFingerprint(project);
  const recovery = planWorkflow(project, 'recover', { run, confirmNoExecutor: true });
  assert.equal(recovery.status, 'BLOCKED');
  assert.match(recovery.conflicts.join(' '), /STUDIO_ORIGIN/);
  assert.equal(treeFingerprint(project), pending);
});

test('an already approved Studio start plan cannot apply after its host pin is removed', t => {
  const { project } = newStudioGame(t);
  const preview = planWorkflow(project, 'start', startOptions);
  assert.equal(preview.status, 'READY');
  removeHostPin(project);
  const before = treeFingerprint(project);
  assert.throws(() => executeWorkflow(preview, { apply: true }), /NATIVE_STUDIO_ORIGIN_TRUST_MISSING/);
  assert.equal(treeFingerprint(project), before);
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});

test('an already approved Studio start plan cannot apply after pinned state changes', t => {
  const { project } = newStudioGame(t);
  const preview = planWorkflow(project, 'start', startOptions);
  assert.equal(preview.status, 'READY');
  fs.appendFileSync(path.join(project, 'ludory.components.json'), ' ');
  const before = treeFingerprint(project);
  assert.throws(() => executeWorkflow(preview, { apply: true }), /NATIVE_STUDIO_ORIGIN_TRUST_CONFLICT/);
  assert.equal(treeFingerprint(project), before);
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});

test('a new inode at a previously trusted path cannot receive writes from an old plan', t => {
  const { project, root } = newStudioGame(t);
  const preview = planWorkflow(project, 'start', startOptions);
  const moved = path.join(root, 'original');
  fs.renameSync(project, moved);
  fs.mkdirSync(project);
  for (const filename of ['ludory.project.json', 'ludory.studio.json', 'ludory.components.json']) {
    fs.copyFileSync(path.join(moved, filename), path.join(project, filename));
  }
  const before = treeFingerprint(project);
  assert.throws(() => executeWorkflow(preview, { apply: true }), /NATIVE_STUDIO_ORIGIN_TRUST_CONFLICT/);
  assert.equal(treeFingerprint(project), before);
});

test('owner-confirmed orphan recovery cannot apply if Studio host trust was revoked', t => {
  const { project } = newStudioGame(t);
  const started = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  assert.equal(started.status, 'APPLIED');
  const orphan = path.join(project, '.ludory', 'ai', 'runs', started.runId, 'events',
    '.pending-1234567890abcdef12345678');
  fs.writeFileSync(orphan, 'recoverable bytes\n');
  const preview = planWorkflow(project, 'recover-storage', { run: started.runId, confirmNoExecutor: true });
  assert.equal(preview.status, 'NEEDS_CONFIRMATION');
  removeHostPin(project);
  const before = treeFingerprint(project);
  assert.throws(() => executeWorkflow(preview, { apply: true }), /NATIVE_STUDIO_ORIGIN_TRUST_MISSING/);
  assert.equal(treeFingerprint(project), before);
  assert.equal(fs.readFileSync(orphan, 'utf8'), 'recoverable bytes\n');
});

test('Codex availability probe cannot revoke project trust and then start execution', t => {
  const { project } = newStudioGame(t);
  const started = executeWorkflow(planWorkflow(project, 'start', startOptions), { apply: true });
  const preview = planWorkflow(project, 'continue', { run: started.runId, executor: 'codex' });
  assert.equal(preview.status, 'READY');
  let runs = 0;
  assert.throws(() => executeWorkflow(preview, { apply: true, executor: {
    check: () => { removeHostPin(project); return { ok: true, code: 'AVAILABLE' }; },
    run: () => { runs++; throw new Error('EXTERNAL_CODEX_MUST_NOT_RUN'); },
  } }), /NATIVE_STUDIO_ORIGIN_TRUST_MISSING/);
  assert.equal(runs, 0);
  assert.equal(readNativeRun(project, started.runId).events.length, 0);
});

test('foreign run diagnostics and orphan inventory remain read-only without host registration', t => {
  const project = nativeProject(t);
  const created = commitNewRun(planNewRun(project, { pipeline: 'audit-repair-loop', scope: {
    target: startOptions.target, inScope: [startOptions.inScope], outOfScope: [],
    acceptanceContract: startOptions.acceptance, mutationBoundary: startOptions.mutationBoundary,
  } }));
  const run = created.run.runId;
  assert.equal(planWorkflow(project, 'doctor').status, 'OK');
  assert.equal(planWorkflow(project, 'status', { run }).status, 'OK');
  assert.equal(planWorkflow(project, 'next', { run }).status, 'OK');
  const orphan = path.join(project, '.ludory', 'ai', 'runs', run, 'events',
    '.pending-abcdefabcdefabcdefabcdef');
  fs.writeFileSync(orphan, 'raw bytes\n');
  const before = treeFingerprint(project);
  assert.equal(planWorkflow(project, 'doctor').status, 'OK');
  const inventory = planWorkflow(project, 'recover-storage', { run, confirmNoExecutor: true });
  assert.equal(inventory.status, 'BLOCKED');
  assert.equal(inventory.inventory.entries.length, 1);
  assert.match(inventory.conflicts.join(' '), /STUDIO_ORIGIN/);
  assert.throws(() => executeWorkflow(inventory, { apply: true }), /NATIVE_STUDIO_ORIGIN/);
  assert.equal(treeFingerprint(project), before);
});
