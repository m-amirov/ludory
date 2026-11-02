import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { planPreviewBuild } from '../src/preview-build.mjs';
import { planNarrativePlatformExport, materializeNarrativePlatformSource } from '../src/narrative-platform-export.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function newProject(t, { template = 'narrative-interactive', profile = 'narrative-game',
  targets = ['yandex-games', 'vk-games'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f5b1-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'game');
  fs.mkdirSync(project);
  const plan = planCreate(project, { id: 'f5b-one-source', version: '0.1.0',
    title: 'F5b one source', lang: 'ru', template, profile, targets });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  return { root, project };
}

test('F5b1 pins one trusted narrative source for both declared SDK targets without writing source or ZIP', t => {
  const { project } = newProject(t);
  const before = fs.readFileSync(path.join(project, 'src/story.js'));
  const preview = planPreviewBuild(project);
  assert.equal(preview.status, 'READY');
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  assert.equal(plan.mode, 'narrative-platform-export');
  assert.deepEqual(plan.targets, ['yandex-games', 'vk-games']);
  assert.deepEqual(plan.writes, []);
  assert.equal(plan.sourceDigest, preview.sourceDigest);
  assert.deepEqual(plan.files, preview.files);
  assert.match(plan.sourcePlanId, /^[a-f0-9-]{36}$/);
  assert.equal(fs.readFileSync(path.join(project, 'src/story.js')).equals(before), true);

  const pinned = materializeNarrativePlatformSource(plan);
  assert.equal(pinned.status, 'SOURCE_PINNED');
  assert.equal(pinned.sourceDigest, plan.sourceDigest);
  assert.deepEqual(pinned.targets, ['yandex-games', 'vk-games']);
  assert.equal(pinned.publicationAllowed, false);
  assert.equal(pinned.releaseReady, false);
  assert.equal(pinned.candidates, undefined);
  assert.ok(path.isAbsolute(pinned.root));
  assert.notEqual(pinned.root, project);
  for (const file of plan.files) {
    const bytes = fs.readFileSync(path.join(pinned.root, file.path));
    assert.equal(sha(bytes), file.sha256);
    assert.equal(bytes.length, file.size);
  }
  pinned.cleanup();
  assert.equal(fs.existsSync(pinned.root), false);
  pinned.cleanup(); // Repeated cleanup must not delete an unrelated path.
  assert.equal(fs.readFileSync(path.join(project, 'src/story.js')).equals(before), true);
});

test('F5b1 rejects single-target or non-narrative Studio projects before generating a plan', t => {
  for (const options of [
    { targets: ['yandex-games'] }, { targets: ['vk-games'] },
    { template: 'narrative-basic' },
    { template: 'yandex-runtime', profile: 'web-game', targets: ['yandex-games'] },
  ]) {
    const { project } = newProject(t, options);
    const result = planNarrativePlatformExport(project);
    assert.equal(result.status, 'BLOCKED', JSON.stringify(options));
    assert.equal(result.writes.length, 0);
    assert.ok(!result.sourcePlanId);
  }
});

test('F5b1 refuses copied, symlinked, or source-modified projects', t => {
  const { root, project } = newProject(t);
  const copy = path.join(root, 'copied');
  fs.cpSync(project, copy, { recursive: true });
  assert.equal(planNarrativePlatformExport(copy).status, 'BLOCKED');
  const alias = path.join(root, 'alias');
  fs.symlinkSync(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(planNarrativePlatformExport(alias).status, 'BLOCKED');

  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  fs.appendFileSync(path.join(project, 'src/story.js'), '\n// author changed the story after planning\n');
  const stale = materializeNarrativePlatformSource(plan);
  assert.equal(stale.status, 'BLOCKED');
  assert.equal(stale.writes.length, 0);
  assert.match(stale.reasonCode, /CHANGED|STALE/);
});

test('F5b1 rejects constructed or modified export plans, even if their fields look plausible', t => {
  const { project } = newProject(t);
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  for (const forgery of [
    { ...plan },
    { ...plan, project: path.dirname(project) },
    { ...plan, sourceDigest: 'f'.repeat(64) },
    { ...plan, files: [] },
    { ...plan, targets: ['vk-games'] },
    { ...plan, mode: 'other' },
  ]) {
    const result = materializeNarrativePlatformSource(forgery);
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.writes, []);
  }
  assert.equal(planNarrativePlatformExport(path.join(project, 'missing')).status, 'BLOCKED');
});

test('F5b1 authenticates the exact metadata bytes used for template/target admission', t => {
  const { project: nonInteractive } = newProject(t, { template: 'narrative-basic' });
  const { project: narrative } = newProject(t);
  const originalRead = fs.readFileSync;
  const substituted = ['ludory.studio.json', 'ludory.components.json', 'ludory.project.json']
    .map(name => originalRead.call(fs, path.join(narrative, name)));
  let injected = 0;
  // Simulate precisely the TOCTOU interleaving: origin trust checked the real
  // basic narrative receipt, but the subsequent metadata read sees interactive bytes.
  fs.readFileSync = function (...args) {
    const bytes = originalRead.apply(this, args);
    const stack = new Error().stack ?? '';
    if (stack.includes('at readRegular ') && stack.includes('at sourceIdentity ') &&
        stack.includes('narrative-platform-export.mjs')) {
      return substituted[injected++];
    }
    return bytes;
  };
  try {
    const result = planNarrativePlatformExport(nonInteractive);
    assert.equal(injected, 3, `the attack must reach metadata admission: ${JSON.stringify(result)}`);
    assert.equal(result.status, 'BLOCKED');
  } finally { fs.readFileSync = originalRead; }
});

test('F5b1 admits a physical Windows casing alias of a trusted source', t => {
  if (process.platform !== 'win32') return t.skip('NTFS alias semantics are Windows-only');
  const { project } = newProject(t);
  const spelling = project.toUpperCase();
  assert.equal(fs.statSync(spelling).ino, fs.statSync(project).ino);
  assert.equal(planNarrativePlatformExport(spelling).status, 'READY_TO_DERIVE');
});
