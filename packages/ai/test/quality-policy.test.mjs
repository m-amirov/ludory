import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { qualityGame } from './helpers/quality-game.mjs';
import { planQualityEnable, applyQualityEnable, readQualityPolicy, snapshotQualitySource } from '../src/quality-policy.mjs';

test('enable is preview-only, applies once on a Studio-created game and rejects changed plans', t => {
  const project = qualityGame(t);
  const planned = planQualityEnable(project);
  assert.equal(planned.status, 'READY');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  const applied = applyQualityEnable(planned);
  assert.equal(applied.status, 'ENABLED');
  const policy = readQualityPolicy(project);
  assert.equal(policy.mode, 'engineering-quality');
  assert.equal(policy.schemaVersion, 1);
  assert.equal(planQualityEnable(project).status, 'IN_SYNC');
  assert.equal(applyQualityEnable(planned).status, 'IN_SYNC');
  assert.equal(policy.tiers.quick.crapMaxExclusive, 10);
  assert.equal(policy.tiers.quick.duplicateThreshold, 0.8);
  assert.equal(policy.tiers.deep.maxWorkers, 2);
});

test('frozen or forged games cannot create a quality policy', t => {
  const project = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-quality-old-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, 'ludory.project.json'), JSON.stringify({
    schemaVersion: 1, id: 'old', version: '0.1.0', title: { en: 'Old' },
    engine: 'web', targets: ['yandex-games'],
  }));
  const result = planQualityEnable(project);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
  assert.throws(() => applyQualityEnable(result), /QUALITY_PLAN_NOT_READY/);
  const manifest = fs.readFileSync(path.join(project, 'ludory.project.json'));
  fs.writeFileSync(path.join(project, 'ludory.studio.json'), JSON.stringify({
    schemaVersion: 1, profile: { id: 'web-game' }, template: { id: 'web-basic' },
    files: { 'ludory.project.json': crypto.createHash('sha256').update(manifest).digest('hex') },
  }));
  assert.equal(planQualityEnable(project).status, 'BLOCKED',
    'a thin, locally forged creation receipt must not unlock the new-project mode');
});

test('source binding becomes stale after code changes, not after quality artifacts', t => {
  const project = qualityGame(t);
  const first = snapshotQualitySource(project);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  applyQualityEnable(planQualityEnable(project));
  assert.equal(snapshotQualitySource(project).digest, first.digest);
  fs.writeFileSync(path.join(project, 'src/main.js'), 'export const number = 17;\n');
  assert.notEqual(snapshotQualitySource(project).digest, first.digest);
});

test('source-bound digest does not depend on machine locale collation', t => {
  const project = qualityGame(t);
  const first = snapshotQualitySource(project).digest;
  const original = String.prototype.localeCompare;
  try {
    String.prototype.localeCompare = function(other) { return -original.call(this, other); };
    assert.equal(snapshotQualitySource(project).digest, first);
  } finally { String.prototype.localeCompare = original; }
});

test('symlinked quality storage is rejected without writing outside the project', t => {
  const project = qualityGame(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-quality-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(project, '.ludory'));
  const planned = planQualityEnable(project);
  assert.equal(planned.status, 'BLOCKED');
  assert.deepEqual(fs.readdirSync(outside), []);
});
