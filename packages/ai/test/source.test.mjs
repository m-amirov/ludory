import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nativeProject, runGit } from './helpers/project.mjs';
import { inspectNativeProject, verifyNativeSource, snapshotArtifact } from '../src/source.mjs';

test('native project preflight binds a clean game to manifest and Git head read-only', t => {
  const project = nativeProject(t);
  const binding = inspectNativeProject(project);
  assert.equal(binding.project, project);
  assert.equal(binding.manifest.id, 'native-game');
  assert.match(binding.gitHead, /^[a-f0-9]{40}$/);
  assert.match(binding.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(binding.gitClean, true);
  assert.deepEqual(verifyNativeSource(binding), { ok: true });
  fs.mkdirSync(path.join(project, '.ludory', 'ai'), { recursive: true });
  fs.writeFileSync(path.join(project, '.ludory', 'ai', 'run-state.json'), 'Ludory-owned');
  assert.deepEqual(verifyNativeSource(binding), { ok: true });
});

test('source changes, new commits, missing or symbolic manifests block project adoption', t => {
  const project = nativeProject(t);
  const binding = inspectNativeProject(project);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'modified\n');
  assert.equal(verifyNativeSource(binding).code, 'SOURCE_WORKTREE_DIRTY');
  assert.throws(() => inspectNativeProject(project), /SOURCE_WORKTREE_DIRTY/);
  runGit(project, 'add', 'src/main.js');
  runGit(project, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'changed');
  assert.equal(verifyNativeSource(binding).code, 'SOURCE_HEAD_CHANGED');
  fs.unlinkSync(path.join(project, 'ludory.project.json'));
  assert.throws(() => inspectNativeProject(project), /manifest|source/i);
  fs.symlinkSync(path.join(project, 'src', 'main.js'), path.join(project, 'ludory.project.json'));
  assert.throws(() => inspectNativeProject(project), /symbolic|manifest/i);
});

test('artifact evidence hashes actual bytes, and rejects traversal and symlinked parents', t => {
  const project = nativeProject(t);
  const result = snapshotArtifact(project, 'src/main.js');
  assert.equal(result.path, 'src/main.js');
  assert.equal(result.size, 22);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => snapshotArtifact(project, '../outside.txt'), /Invalid artifact path/);
  assert.throws(() => snapshotArtifact(project, 'C:\\Temp\\unsafe'), /Invalid artifact path/);
  assert.throws(() => snapshotArtifact(project, '/tmp/file'), /Invalid artifact path/);
  assert.throws(() => snapshotArtifact(project, 'src/../../etc/passwd'), /Invalid artifact path/);
  fs.symlinkSync(path.join(project, 'src'), path.join(project, 'linked'));
  assert.throws(() => snapshotArtifact(project, 'linked/main.js'), /symbolic|Invalid artifact/i);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'corrupted\n');
  assert.notEqual(snapshotArtifact(project, 'src/main.js').sha256, result.sha256);
});

test('canonical manifest must be tracked by HEAD with safe index flags', t => {
  const ignored = nativeProject(t);
  runGit(ignored, 'rm', '--cached', 'ludory.project.json');
  fs.writeFileSync(path.join(ignored, '.gitignore'), 'ludory.project.json\n');
  runGit(ignored, 'add', '.gitignore');
  runGit(ignored, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'stop tracking manifest');
  assert.throws(() => inspectNativeProject(ignored), /SOURCE_MANIFEST_NOT_TRACKED/);

  const skip = nativeProject(t);
  runGit(skip, 'update-index', '--skip-worktree', 'ludory.project.json');
  assert.throws(() => inspectNativeProject(skip), /SOURCE_MANIFEST_INDEX_UNSAFE/);

  const assume = nativeProject(t);
  runGit(assume, 'update-index', '--assume-unchanged', 'ludory.project.json');
  assert.throws(() => inspectNativeProject(assume), /SOURCE_MANIFEST_INDEX_UNSAFE/);

  const hiddenEdit = nativeProject(t);
  const original = inspectNativeProject(hiddenEdit);
  runGit(hiddenEdit, 'update-index', '--assume-unchanged', 'src/main.js');
  fs.writeFileSync(path.join(hiddenEdit, 'src', 'main.js'), '// hidden modified source\n');
  assert.throws(() => inspectNativeProject(hiddenEdit), /SOURCE_GIT_INDEX_UNSAFE/);
  assert.equal(verifyNativeSource(original).ok, false);
});
