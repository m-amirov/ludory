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

test('edits and commits are advisory while missing or symbolic manifests still block', t => {
  const project = nativeProject(t);
  const binding = inspectNativeProject(project);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'modified\n');
  assert.deepEqual(verifyNativeSource(binding), { ok: true });
  assert.equal(inspectNativeProject(project).gitClean, false);
  runGit(project, 'add', 'src/main.js');
  runGit(project, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'changed');
  assert.deepEqual(verifyNativeSource(binding), { ok: true });
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

test('index anomalies are reported as untrusted Git provenance without blocking development', t => {
  const ignored = nativeProject(t);
  runGit(ignored, 'rm', '--cached', 'ludory.project.json');
  fs.writeFileSync(path.join(ignored, '.gitignore'), 'ludory.project.json\n');
  runGit(ignored, 'add', '.gitignore');
  runGit(ignored, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'stop tracking manifest');
  assert.equal(inspectNativeProject(ignored).gitTrusted, false);

  const skip = nativeProject(t);
  runGit(skip, 'update-index', '--skip-worktree', 'ludory.project.json');
  assert.equal(inspectNativeProject(skip).gitTrusted, false);

  const assume = nativeProject(t);
  runGit(assume, 'update-index', '--assume-unchanged', 'ludory.project.json');
  assert.equal(inspectNativeProject(assume).gitTrusted, false);

  const hiddenEdit = nativeProject(t);
  const original = inspectNativeProject(hiddenEdit);
  runGit(hiddenEdit, 'update-index', '--assume-unchanged', 'src/main.js');
  fs.writeFileSync(path.join(hiddenEdit, 'src', 'main.js'), '// hidden modified source\n');
  assert.equal(inspectNativeProject(hiddenEdit).gitTrusted, false);
  assert.equal(verifyNativeSource(original).ok, true);
});

test('development inspection tolerates unversioned games, edits, and nested workspaces', t => {
  const unversioned = nativeProject(t);
  fs.rmSync(path.join(unversioned, '.git'), { recursive: true, force: true });
  const fresh = inspectNativeProject(unversioned);
  assert.equal(fresh.manifest.id, 'native-game');
  assert.equal(fresh.gitHead, null);
  assert.equal(verifyNativeSource(fresh).ok, true);

  const tracked = nativeProject(t);
  const before = inspectNativeProject(tracked);
  fs.writeFileSync(path.join(tracked, 'src', 'main.js'), '// active development\n');
  assert.equal(inspectNativeProject(tracked).gitClean, false);
  assert.deepEqual(verifyNativeSource(before), { ok: true });
  runGit(tracked, 'add', 'src/main.js');
  runGit(tracked, '-c', 'user.name=Ludory Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'development');
  assert.deepEqual(verifyNativeSource(before), { ok: true });

  const monorepo = nativeProject(t);
  const nested = path.join(monorepo, 'games', 'little-game');
  fs.mkdirSync(nested, { recursive: true });
  fs.copyFileSync(path.join(monorepo, 'ludory.project.json'), path.join(nested, 'ludory.project.json'));
  assert.equal(inspectNativeProject(nested).manifest.id, 'native-game');
});
