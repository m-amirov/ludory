import './setup-trust-env.mjs';
import test from 'node:test';
import { qaDirectoryDurabilityAvailable } from './helpers/qa-review-durability.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planQaRepair, snapshotQaRepairSource } from '../src/qa-repair-scope.mjs';
import { makeQaRepairFixture } from './helpers/qa-repair-fixture.mjs';

const durableTest = qaDirectoryDurabilityAvailable ? test : test.skip;

durableTest('trusted P1 journal yields an exact source-bound agent handoff without writing', async t => {
  const f = await makeQaRepairFixture(t);
  const result = planQaRepair({ project: f.project, reviewOutput: f.reviewOutput,
    inScope: 'src/main.js', mutationBoundary: 'Fix clipped mobile choices only', outputDir: f.repairOutput });
  assert.equal(result.status, 'READY_FOR_AGENT_HANDOFF', JSON.stringify(result));
  assert.equal(result.authorization.maxRepairs, 2);
  assert.deepEqual(result.authorization.inScope, ['src/main.js']);
  assert.equal(result.review.target, 'yandex-games');
  assert.equal(result.actualModeration, 'NOT_RUN');
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(fs.existsSync(f.repairOutput), false);
  assert.match(result.warning, /not authenticated|local record/i);
});

durableTest('copied Studio files and untrusted existing projects cannot authorize fixes', async t => {
  const f = await makeQaRepairFixture(t);
  const copy = path.join(f.folder, 'copied');
  fs.mkdirSync(copy);
  for (const name of ['ludory.studio.json', 'ludory.project.json', 'ludory.components.json']) {
    fs.copyFileSync(path.join(f.project, name), path.join(copy, name));
  }
  assert.equal(planQaRepair({ project: copy, reviewOutput: f.reviewOutput, inScope: 'src/main.js',
    mutationBoundary: 'Only UI', outputDir: f.repairOutput }).status, 'BLOCKED');
});

durableTest('scope rejects parent traversal, Studio ownership files, hidden secrets and symlink paths', async t => {
  const f = await makeQaRepairFixture(t);
  const base = { project: f.project, reviewOutput: f.reviewOutput,
    mutationBoundary: 'Only UI', outputDir: f.repairOutput };
  for (const inScope of ['../owner.txt', '/tmp/owner.txt', 'src/../../x', 'ludory.project.json',
    'ludory.studio.json', 'package.json', '.env', '.git/config', 'src/main.js;../escape', '']) {
    assert.equal(planQaRepair({ ...base, inScope }).status, 'BLOCKED', inScope);
  }
  const link = path.join(f.project, 'src', 'linked.js');
  try { fs.symlinkSync(path.join(f.project, 'src', 'main.js'), link); }
  catch (error) { if (error.code === 'EPERM') return t.skip('symlinks unavailable'); throw error; }
  assert.equal(planQaRepair({ ...base, inScope: 'src/linked.js' }).status, 'BLOCKED');
});

durableTest('inventory detects ordinary source edits, including user notes outside the allowlist', async t => {
  const f = await makeQaRepairFixture(t);
  const first = snapshotQaRepairSource(f.project);
  fs.appendFileSync(path.join(f.project, 'src', 'main.js'), '\n// changed\n');
  const second = snapshotQaRepairSource(f.project);
  assert.notEqual(second.digest, first.digest);
  assert.notEqual(second.files.find(x => x.path === 'src/main.js').sha256,
    first.files.find(x => x.path === 'src/main.js').sha256);
  fs.writeFileSync(path.join(f.project, 'owner-notes.txt'), 'private notes');
  const third = snapshotQaRepairSource(f.project);
  assert.notEqual(third.digest, second.digest);
  assert.ok(third.files.some(x => x.path === 'owner-notes.txt'));
});

durableTest('inventory also tracks protected user files inside .ludory instead of hiding their edits', async t => {
  const f = await makeQaRepairFixture(t);
  const first = snapshotQaRepairSource(f.project);
  fs.mkdirSync(path.join(f.project, '.ludory'));
  fs.writeFileSync(path.join(f.project, '.ludory', 'owner-config.json'), '{"owner":true}');
  const second = snapshotQaRepairSource(f.project);
  assert.notEqual(second.digest, first.digest);
  assert.ok(second.files.some(item => item.path === '.ludory/owner-config.json'));
});

durableTest('skippable generated directory names cannot hide a user file or nested user directory', async t => {
  const f = await makeQaRepairFixture(t);
  fs.writeFileSync(path.join(f.project, 'src', 'build'), 'an important user file');
  fs.mkdirSync(path.join(f.project, 'src', 'coverage'));
  fs.writeFileSync(path.join(f.project, 'src', 'coverage', 'notes.md'), 'owner content');
  const found = snapshotQaRepairSource(f.project);
  assert.ok(found.files.some(item => item.path === 'src/build'));
  assert.ok(found.files.some(item => item.path === 'src/coverage/notes.md'));
  const replacement = path.join(f.project, 'src', 'build-replacement');
  fs.writeFileSync(replacement, 'an important user file');
  fs.renameSync(replacement, path.join(f.project, 'src', 'build'));
  const replaced = snapshotQaRepairSource(f.project);
  assert.notEqual(found.digest, replaced.digest, 'same bytes with different inode must be a changed source');
});

durableTest('consent invalidates deleted or replaced initial Web inputs after the review', async t => {
  const f = await makeQaRepairFixture(t);
  const options = { project: f.project, reviewOutput: f.reviewOutput,
    inScope: 'src/main.js', mutationBoundary: 'Only UI', outputDir: f.repairOutput };
  assert.equal(planQaRepair(options).status, 'READY_FOR_AGENT_HANDOFF');
  fs.unlinkSync(path.join(f.evidenceDir, 'mobile-390x844.png'));
  assert.equal(planQaRepair(options).status, 'BLOCKED');
});

durableTest('review without a blocking P0/P1 cannot issue a repair handoff', async t => {
  const f = await makeQaRepairFixture(t, { severity: null });
  const result = planQaRepair({ project: f.project, reviewOutput: f.reviewOutput,
    inScope: 'src/main.js', mutationBoundary: 'Only UI', outputDir: f.repairOutput });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reasonCode, 'QA_REPAIR_NO_BLOCKING_FINDINGS');
});
