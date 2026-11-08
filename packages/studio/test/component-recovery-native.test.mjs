import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openProtectedDirectory, assertWindowsDirectoryPinContract } from '../src/windows-directory-pin.mjs';
import { openRecoveryStore } from '../../studio-trust/src/host-recovery-writer.mjs';

const id = 'b'.repeat(64);

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-native-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registry = path.join(dir, 'registry');
  fs.mkdirSync(registry);
  return { dir, registry };
}

test('Windows recovery binding rejects stale modules and never substitutes a JS path writer', t => {
  const shape = { open() {}, close() {}, createGuard() {}, removeGuard() {} };
  for (const version of [3, 4, 5]) {
    assert.throws(() => assertWindowsDirectoryPinContract({ ...shape, pinContractVersion: version }),
      /stale|contract|version/i);
  }
  if (process.platform !== 'win32') {
    const f = fixture(t);
    let called = false;
    const store = openRecoveryStore(f.registry, { windowsPin: () => { called = true; return {}; } });
    try { assert.equal(called, false, 'Linux must use its own pinned descriptor backend'); }
    finally { store.close(); }
  }
});

test('Windows pinned native recovery lock and checkpoint use the physical root handle', t => {
  if (process.platform !== 'win32') return t.skip('Real Windows NTFS N-API required');
  const f = fixture(t);
  const store = openRecoveryStore(f.registry, { windowsPin: openProtectedDirectory });
  try {
    assert.equal(store.rootIdentity, (() => {
      const stat = fs.lstatSync(f.registry, { bigint: true });
      return `${stat.dev}:${stat.ino}`;
    })());
    const lock = store.createLock(`${id}.json.lock`);
    assert.deepEqual(store.read(`${id}.json.lock`), Buffer.alloc(0));
    assert.throws(() => store.createLock(`${id}.json.lock`), /exists|already|exclusive|NTSTATUS|native/i);
    const bytes = Buffer.from('{"version":1}\n');
    const record = store.createRecord(`${id}.recovery.json`, bytes);
    assert.deepEqual(store.read(`${id}.recovery.json`), bytes);
    assert.throws(() => store.createRecord(`${id}.recovery.json`, bytes), /exists|already|exclusive|NTSTATUS|native/i);
    store.removeCreated(record);
    assert.equal(store.read(`${id}.recovery.json`), null);
    store.removeCreated(lock);
    assert.equal(store.read(`${id}.json.lock`), null);
    assert.throws(() => store.read('../outside.json'), /name|basename/i);
  } finally { store.close(); }
});

test('Windows root pin prevents replacement and no checkpoint may appear in a substituted registry', t => {
  if (process.platform !== 'win32') return t.skip('Real Windows NTFS sharing required');
  const f = fixture(t);
  const store = openRecoveryStore(f.registry, { windowsPin: openProtectedDirectory });
  try {
    assert.throws(() => fs.renameSync(f.registry, `${f.registry}-old`),
      /EPERM|EBUSY|EACCES|permission|access|resource|denied/i);
    assert.equal(fs.existsSync(`${f.registry}-old`), false);
    const lock = store.createLock(`${id}.json.lock`);
    const record = store.createRecord(`${id}.recovery.json`, Buffer.from('safe\n'));
    assert.equal(fs.readFileSync(path.join(f.registry, `${id}.recovery.json`), 'utf8'), 'safe\n');
    store.removeCreated(record);
    store.removeCreated(lock);
  } finally { store.close(); }
});
