import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalPhysicalDirectory } from '../src/physical-path.mjs';

test('physical directory accepts ordinary Windows path aliases and resolves to canonical spelling', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-physical-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(canonicalPhysicalDirectory(root), fs.realpathSync.native(root));
  assert.equal(canonicalPhysicalDirectory(path.join(root, '.')), fs.realpathSync.native(root));
  if (process.platform === 'win32') {
    // GitHub Windows runners commonly expose RUNNER~1 in TEMP: realpath expands it.
    assert.equal(canonicalPhysicalDirectory(os.tmpdir()), fs.realpathSync.native(os.tmpdir()));
  }
});

test('physical directory rejects a symlinked intermediate ancestor and final symlink', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-physical-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(target, 'child'), { recursive: true });
  const alias = path.join(root, 'alias');
  fs.symlinkSync(target, alias, 'dir');
  assert.throws(() => canonicalPhysicalDirectory(alias), /DIRECTORY_NOT_PHYSICAL/);
  assert.throws(() => canonicalPhysicalDirectory(path.join(alias, 'child')), /DIRECTORY_NOT_PHYSICAL/);
});
