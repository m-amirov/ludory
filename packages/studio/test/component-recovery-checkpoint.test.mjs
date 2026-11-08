import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerComponentRecoveryCheckpoint, readComponentRecoveryCheckpoint,
  assertComponentRecoveryCheckpoint, registerComponentTrust } from '../src/component-trust.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-recovery-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = process.env.LUDORY_STUDIO_TRUST_DIR;
  process.env.LUDORY_STUDIO_TRUST_DIR = path.join(root, 'host-registry');
  t.after(() => {
    if (old === undefined) delete process.env.LUDORY_STUDIO_TRUST_DIR;
    else process.env.LUDORY_STUDIO_TRUST_DIR = old;
  });
  const project = path.join(root, 'game');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'author.txt'), 'preserve author data');
  const digest = char => char.repeat(64);
  return { root, project, details: { rootIdentity: '11:22',
    receiptSha256: digest('a'), manifestSha256: digest('b'),
    stateSha256: digest('c'), recoverySha256: digest('d'),
    fromCommit: '1'.repeat(40), toCommit: '2'.repeat(40) } };
}

test('recovery checkpoint is a private host-owned, create-once record; game bytes are unchanged', t => {
  const f = fixture(t);
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
  const created = registerComponentRecoveryCheckpoint(f.project, f.details);
  assert.equal(created.stateSha256, f.details.stateSha256);
  assert.deepEqual(readComponentRecoveryCheckpoint(f.project), created);
  assert.equal(assertComponentRecoveryCheckpoint(f.project, f.details).stateSha256, f.details.stateSha256);
  assert.deepEqual(fs.readdirSync(f.project), ['author.txt']);
  assert.equal(fs.readFileSync(path.join(f.project, 'author.txt'), 'utf8'), 'preserve author data');
  assert.throws(() => registerComponentRecoveryCheckpoint(f.project, f.details), /existing|replace|checkpoint/i);
  const hostFiles = fs.readdirSync(path.join(f.root, 'host-registry')).filter(name => name.endsWith('.json'));
  assert.equal(hostFiles.length, 1);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(f.root, 'host-registry', hostFiles[0])).mode & 0o077, 0);
  }
});

test('mismatched or corrupted recovery records fail closed', t => {
  const f = fixture(t);
  registerComponentRecoveryCheckpoint(f.project, f.details);
  assert.throws(() => assertComponentRecoveryCheckpoint(f.project, { ...f.details, stateSha256: 'e'.repeat(64) }),
    /differs|match|conflict/i);
  const file = fs.readdirSync(path.join(f.root, 'host-registry')).find(name => name.endsWith('.json'));
  fs.writeFileSync(path.join(f.root, 'host-registry', file), '{"bad":true}\n');
  assert.throws(() => readComponentRecoveryCheckpoint(f.project), /invalid|record|checkpoint/i);
});

test('existing Studio trust pin cannot be replaced by recovery', t => {
  const f = fixture(t);
  registerComponentTrust(f.project, { rootIdentity: f.details.rootIdentity,
    receiptSha256: f.details.receiptSha256, manifestSha256: f.details.manifestSha256,
    stateSha256: 'f'.repeat(64) });
  assert.throws(() => registerComponentRecoveryCheckpoint(f.project, f.details), /already.*trusted|existing.*trust|conflict/i);
  assert.equal(readComponentRecoveryCheckpoint(f.project), null);
});
