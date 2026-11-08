import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { collectComponentGitHistory } from '../src/component-git-history.mjs';

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function historyFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-recovery-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  const project = path.join(root, 'game-studio');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  const receipt = { schemaVersion: 1, template: { id: 'demo', version: '1.2.3' } };
  fs.writeFileSync(path.join(project, 'ludory.studio.json'), JSON.stringify(receipt) + '\n');
  fs.writeFileSync(path.join(project, 'ludory.project.json'), '{"id":"demo"}\n');
  const state = version => ({ schemaVersion: 2, template: { id: 'demo', version },
    files: { 'src/main.js': 'f'.repeat(64) }, authorFiles: ['src/story.js'] });
  fs.writeFileSync(path.join(project, 'src/story.js'), 'export const story = true;\n');
  fs.writeFileSync(path.join(project, 'src/main.js'), 'export const version = 123;\n');
  fs.writeFileSync(path.join(project, 'ludory.components.json'), JSON.stringify(state('1.2.3')) + '\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'create Studio 1.2.3');
  const fromCommit = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(project, 'src/main.js'), 'export const version = 124;\n');
  fs.writeFileSync(path.join(project, 'ludory.components.json'), JSON.stringify(state('1.2.4')) + '\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'native Studio 1.2.4');
  const toCommit = git(root, 'rev-parse', 'HEAD');
  return { root, project, fromCommit, toCommit };
}

test('reads a bounded, real Git history with committed managed bytes and no network', t => {
  const f = historyFixture(t);
  const result = collectComponentGitHistory(f.project, { fromCommit: f.fromCommit, toCommit: f.toCommit });
  assert.equal(result.repositoryRoot, f.root);
  assert.equal(result.projectPath, 'game-studio');
  assert.deepEqual(result.commits.map(item => item.sha), [f.fromCommit, f.toCommit]);
  assert.equal(result.commits[0].files.get('src/main.js').bytes.toString(), 'export const version = 123;\n');
  assert.equal(result.commits[1].files.get('src/main.js').bytes.toString(), 'export const version = 124;\n');
  assert.equal(result.commits[1].files.get('src/main.js').mode, '100644');
  assert.ok(result.commits.every(item => item.files.has('ludory.studio.json')));
});

test('rejects a non-ancestor, abbreviated commit, and missing state path', t => {
  const f = historyFixture(t);
  assert.throws(() => collectComponentGitHistory(f.project, {
    fromCommit: f.toCommit, toCommit: f.fromCommit,
  }), /first.parent|ancestor|history/i);
  assert.throws(() => collectComponentGitHistory(f.project, {
    fromCommit: f.fromCommit.slice(0, 7), toCommit: f.toCommit,
  }), /full.*sha|commit/i);
  fs.mkdirSync(path.join(f.root, 'another'));
  assert.throws(() => collectComponentGitHistory(path.join(f.root, 'another'), {
    fromCommit: f.fromCommit, toCommit: f.toCommit,
  }), /state|missing/i);
});

test('rejects Git-mode symlink for a managed file', t => {
  if (process.platform === 'win32') return t.skip('requires POSIX symlink');
  const f = historyFixture(t);
  const managed = path.join(f.project, 'src/main.js');
  fs.unlinkSync(managed);
  fs.symlinkSync('story.js', managed);
  git(f.root, 'add', '.');
  git(f.root, 'commit', '-qm', 'replace managed path with symlink');
  const head = git(f.root, 'rev-parse', 'HEAD');
  assert.throws(() => collectComponentGitHistory(f.project, {
    fromCommit: f.fromCommit, toCommit: head,
  }), /symlink|regular.*file|unsafe.*mode/i);
});

test('does not lazy-fetch missing managed blobs from a partial Git clone', t => {
  const f = historyFixture(t);
  git(f.root, 'config', 'uploadpack.allowFilter', 'true');
  const clone = path.join(f.root, 'partial-clone');
  git(f.root, 'clone', '--filter=blob:none', '--no-checkout', '--no-local',
    `file://${f.root}`, clone);
  const project = path.join(clone, 'game-studio');
  fs.cpSync(f.project, project, { recursive: true });
  const objectPacks = () => fs.readdirSync(path.join(clone, '.git', 'objects', 'pack'))
    .filter(name => name.endsWith('.pack')).sort();
  const before = objectPacks();
  assert.ok(before.length >= 1, 'fixture must have an existing filtered pack');
  assert.throws(() => collectComponentGitHistory(project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit,
  }), /missing|unavailable|invalid|offline|blob/i);
  assert.deepEqual(objectPacks(), before,
    'preview must neither fetch missing promisor objects nor change Git pack inventory');
});

test('rejects shallow Git evidence even when current project files are readable', t => {
  const f = historyFixture(t);
  const clone = path.join(f.root, 'shallow-clone');
  git(f.root, 'clone', '--depth=1', '--no-local', '--no-checkout', `file://${f.root}`, clone);
  const project = path.join(clone, 'game-studio');
  fs.cpSync(f.project, project, { recursive: true });
  assert.throws(() => collectComponentGitHistory(project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit,
  }), /shallow|complete/i);
});

test('rejects merge commits rather than selecting one ambiguous parent', t => {
  const f = historyFixture(t);
  const primary = git(f.root, 'branch', '--show-current');
  git(f.root, 'switch', '-q', '-c', 'side', f.fromCommit);
  fs.writeFileSync(path.join(f.root, 'side-note.txt'), 'side branch\n');
  git(f.root, 'add', 'side-note.txt');
  git(f.root, 'commit', '-qm', 'side branch');
  git(f.root, 'switch', '-q', primary);
  git(f.root, 'merge', '--no-ff', '-qm', 'merge side branch', 'side');
  const mergeCommit = git(f.root, 'rev-parse', 'HEAD');
  assert.throws(() => collectComponentGitHistory(f.project, {
    fromCommit: f.fromCommit, toCommit: mergeCommit,
  }), /ambiguous|merge|parent/i);
});

test('rejects a substituted Git tree object even when commit and blob SHA IDs are unchanged', t => {
  const f = historyFixture(t);
  const treeSha = git(f.root, 'rev-parse', `${f.toCommit}:game-studio/src`);
  const oldBlobSha = git(f.root, 'rev-parse', `${f.fromCommit}:game-studio/src/main.js`);
  const recentBlobSha = git(f.root, 'rev-parse', `${f.toCommit}:game-studio/src/main.js`);
  const objectPath = path.join(f.root, '.git', 'objects', treeSha.slice(0, 2), treeSha.slice(2));
  const inflated = zlib.inflateSync(fs.readFileSync(objectPath));
  const originalId = Buffer.from(recentBlobSha, 'hex');
  const replacementId = Buffer.from(oldBlobSha, 'hex');
  const idOffset = inflated.indexOf(originalId);
  assert.ok(idOffset > 0, 'fixture raw tree must reference the newer committed blob');
  const forged = Buffer.from(inflated);
  replacementId.copy(forged, idOffset);
  fs.chmodSync(objectPath, 0o644); // Git stores loose objects read-only by default.
  fs.writeFileSync(objectPath, zlib.deflateSync(forged));
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.toCommit,
    'attack does not alter the source or destination commit IDs');
  assert.throws(() => collectComponentGitHistory(f.project, {
    fromCommit: f.fromCommit, toCommit: f.toCommit,
  }), /tree|object|hash|invalid/i);
});
