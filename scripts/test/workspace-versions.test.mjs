import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateWorkspaceVersions } from '../check-workspace-versions.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-version-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rootPackage = { name: 'ludory', version: '0.1.0', workspaces: ['packages/*'] };
  const core = { name: '@ludory/core', version: '0.1.0' };
  const studio = { name: '@ludory/studio', version: '0.1.0', private: true,
    dependencies: { '@ludory/core': '0.1.0' } };
  const lock = { name: 'ludory', version: '0.1.0', lockfileVersion: 3,
    packages: { '': { ...rootPackage }, 'packages/core': { ...core },
      'packages/studio': { ...studio, dependencies: { ...studio.dependencies } },
      'node_modules/@ludory/core': { resolved: 'packages/core', link: true },
      'node_modules/@ludory/studio': { resolved: 'packages/studio', link: true } } };
  const save = () => {
    write(path.join(root, 'package.json'), rootPackage);
    write(path.join(root, 'packages/core/package.json'), core);
    write(path.join(root, 'packages/studio/package.json'), studio);
    write(path.join(root, 'package-lock.json'), lock);
  };
  save();
  return { root, rootPackage, core, studio, lock, save };
}

test('F6d accepts an internally pinned coherent workspace and the checked-in repo', t => {
  const item = fixture(t);
  assert.deepEqual(validateWorkspaceVersions(item.root), []);
  assert.deepEqual(validateWorkspaceVersions(repository), []);
});

test('F6d rejects a partial package bump and stale internal dependency pins', t => {
  const item = fixture(t);
  item.studio.version = '1.0.0';
  item.save();
  assert.match(validateWorkspaceVersions(item.root).join('\n'), /packages\/studio.*version.*0\.1\.0/);
  item.studio.version = '0.1.0';
  item.studio.dependencies['@ludory/core'] = '^0.1.0';
  item.save();
  assert.match(validateWorkspaceVersions(item.root).join('\n'), /@ludory\/core.*0\.1\.0/);
});

test('F6d catches stale internal lock pins independently of manifest pins', t => {
  const item = fixture(t);
  item.lock.packages['packages/studio'].dependencies['@ludory/core'] = '^0.1.0';
  item.save();
  assert.match(validateWorkspaceVersions(item.root).join('\n'),
    /lockfile packages\/studio @ludory\/core pin \^0\.1\.0 differs from manifest 0\.1\.0/);
});

test('F6d rejects lockfile drift even when package manifests agree', t => {
  const item = fixture(t);
  item.lock.packages['packages/core'].version = '0.0.9';
  item.save();
  assert.match(validateWorkspaceVersions(item.root).join('\n'), /lockfile.*packages\/core.*0\.0\.9/);
});

test('F6d rejects a workspace lockfile name mismatch and a stale package link', t => {
  const item = fixture(t);
  item.lock.packages['packages/core'].name = '@ludory/not-core';
  item.lock.packages['node_modules/@ludory/studio'].resolved = 'packages/core';
  item.save();
  const failures = validateWorkspaceVersions(item.root).join('\n');
  assert.match(failures, /lockfile packages\/core name.*@ludory\/not-core/);
  assert.match(failures, /lockfile node_modules\/@ludory\/studio.*packages\/core/);
});

test('F6d rejects missing or non-link workspace entries', t => {
  const item = fixture(t);
  delete item.lock.packages['node_modules/@ludory/core'];
  item.lock.packages['node_modules/@ludory/studio'].link = false;
  item.save();
  const failures = validateWorkspaceVersions(item.root).join('\n');
  assert.match(failures, /lockfile node_modules\/@ludory\/core.*missing/);
  assert.match(failures, /lockfile node_modules\/@ludory\/studio.*link/);
});

test('F6d CLI help reports the installed Studio package version', () => {
  const studio = JSON.parse(fs.readFileSync(path.join(repository, 'packages/studio/package.json'), 'utf8'));
  const result = spawnSync(process.execPath,
    [path.join(repository, 'packages/studio/bin/ludory.mjs'), 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith(`Ludory Studio ${studio.version} —`));
});
