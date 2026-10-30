import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import * as hostTrust from '../src/component-trust.mjs';

function newGame(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-origin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'game');
  fs.mkdirSync(project);
  const plan = planCreate(project, { id: 'origin-game', title: 'Origin Game', lang: 'en',
    profile: 'web-game', template: 'web-basic', targets: ['yandex-games'] });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  return { project, root };
}

function verify(project) {
  return hostTrust.verifyStudioOrigin(project);
}

test('a real Studio creation verifies its independent host record, even without Git', t => {
  const { project } = newGame(t);
  const result = verify(project);
  assert.deepEqual(result, { ok: true, code: 'STUDIO_ORIGIN_TRUSTED', project });
  assert.equal(fs.existsSync(path.join(project, '.git')), false);
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});

test('copying all three Studio metadata files into a foreign directory does not grant trust', t => {
  const { project, root } = newGame(t);
  const copied = path.join(root, 'copied-game');
  fs.mkdirSync(copied);
  for (const file of ['ludory.studio.json', 'ludory.project.json', 'ludory.components.json']) {
    fs.copyFileSync(path.join(project, file), path.join(copied, file));
  }
  const before = fs.readdirSync(copied).sort();
  const result = verify(copied);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STUDIO_ORIGIN_TRUST_MISSING');
  assert.deepEqual(fs.readdirSync(copied).sort(), before);
});

test('editing a pinned Studio component state invalidates provenance without deleting user files', t => {
  const { project } = newGame(t);
  const ownerFile = path.join(project, 'owner-note.txt');
  fs.writeFileSync(ownerFile, 'keep me\n');
  fs.appendFileSync(path.join(project, 'ludory.components.json'), ' ');
  const result = verify(project);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STUDIO_ORIGIN_TRUST_CONFLICT');
  assert.equal(fs.readFileSync(ownerFile, 'utf8'), 'keep me\n');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});

test('a linked creation receipt cannot substitute for a securely pinned regular file', t => {
  const { project } = newGame(t);
  const original = path.join(project, 'ludory.studio.json');
  const backup = path.join(project, 'receipt-backup.json');
  fs.linkSync(original, backup);
  const result = verify(project);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STUDIO_ORIGIN_UNSAFE_FILE');
});

test('a symlinked game directory is rejected even when its contents are registered', t => {
  const { project, root } = newGame(t);
  const link = path.join(root, 'game-symlink');
  try { fs.symlinkSync(project, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Symlink creation unavailable');
    throw error;
  }
  const result = verify(link);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STUDIO_ORIGIN_UNSAFE_ROOT');
});

test('replacing a registered game directory with another inode rejects identical metadata', t => {
  const { project, root } = newGame(t);
  const original = path.join(root, 'original');
  fs.renameSync(project, original);
  fs.mkdirSync(project);
  for (const file of ['ludory.studio.json', 'ludory.project.json', 'ludory.components.json']) {
    fs.copyFileSync(path.join(original, file), path.join(project, file));
  }
  const result = verify(project);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STUDIO_ORIGIN_TRUST_CONFLICT');
});
