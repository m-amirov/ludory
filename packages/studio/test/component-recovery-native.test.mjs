import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openProtectedDirectory, assertWindowsDirectoryPinContract } from '../src/windows-directory-pin.mjs';
import { openRecoveryStore } from '../../studio-trust/src/host-recovery-writer.mjs';
import { registerComponentRecoveryCheckpoint, componentHostRegistryBinding,
  readComponentRecoveryCheckpoint } from '../../studio-trust/src/index.mjs';

const id = 'b'.repeat(64);
const junctionProbe = path.join(path.dirname(fileURLToPath(import.meta.url)),
  'fixtures', 'windows-junction-in-place.ps1');

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
    const existingPin = Buffer.from('existing normal trust pin\n');
    fs.writeFileSync(path.join(f.registry, `${id}.json`), existingPin);
    assert.deepEqual(store.read(`${id}.json`), existingPin,
      'native lookup must detect existing ordinary Studio trust records');
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

test('Windows recovery refuses an absent registry before native checkpoint acquisition', t => {
  if (process.platform !== 'win32') return t.skip('Real Windows NTFS RootDirectory required');
  const f = fixture(t);
  const project = path.join(f.dir, 'game');
  fs.mkdirSync(project);
  const selectedHost = path.join(f.dir, 'first-created-host');
  const previous = process.env.LUDORY_STUDIO_TRUST_DIR;
  process.env.LUDORY_STUDIO_TRUST_DIR = selectedHost;
  t.after(() => {
    if (previous === undefined) delete process.env.LUDORY_STUDIO_TRUST_DIR;
    else process.env.LUDORY_STUDIO_TRUST_DIR = previous;
  });
  const binding = componentHostRegistryBinding(project);
  assert.equal(binding.rootExists, false);
  const hash = ch => ch.repeat(64);
  const details = { rootIdentity: '1:2', receiptSha256: hash('a'), manifestSha256: hash('b'),
    stateSha256: hash('c'), recoverySha256: hash('d'),
    fromCommit: '1'.repeat(40), toCommit: '2'.repeat(40) };
  let opened = false;
  assert.throws(() => registerComponentRecoveryCheckpoint(project, details, binding, {
    windowsPin: root => { opened = true; return openProtectedDirectory(root); },
  }), /initializ|exist|registry/i);
  assert.equal(opened, false, 'missing-root recovery must not reach the native pin writer');
  assert.equal(fs.existsSync(selectedHost), false, 'apply must not create the host registry');
  assert.equal(readComponentRecoveryCheckpoint(project, { windowsPin: openProtectedDirectory }), null);
  fs.mkdirSync(selectedHost, { mode: 0o700 });
  assert.throws(() => registerComponentRecoveryCheckpoint(project, details, binding,
    { windowsPin: openProtectedDirectory }), /registry|changed|preview|identity/i,
    'an approval made before registry creation cannot be replayed afterwards');
  const fresh = componentHostRegistryBinding(project);
  assert.equal(fresh.rootExists, true);
  assert.deepEqual(registerComponentRecoveryCheckpoint(project, details, fresh,
    { windowsPin: openProtectedDirectory }),
  { schemaVersion: 1, project: path.resolve(project), ...details });
});

test('Windows post-delete close failure cannot roll back a committed checkpoint', t => {
  if (process.platform !== 'win32') return t.skip('Windows native deletion commit protocol');
  const f = fixture(t);
  const project = path.join(f.dir, 'game');
  fs.mkdirSync(project);
  const previous = process.env.LUDORY_STUDIO_TRUST_DIR;
  process.env.LUDORY_STUDIO_TRUST_DIR = f.registry;
  t.after(() => {
    if (previous === undefined) delete process.env.LUDORY_STUDIO_TRUST_DIR;
    else process.env.LUDORY_STUDIO_TRUST_DIR = previous;
  });
  const binding = componentHostRegistryBinding(project);
  const details = { rootIdentity: '1:2', receiptSha256: 'a'.repeat(64),
    manifestSha256: 'b'.repeat(64), stateSha256: 'c'.repeat(64),
    recoverySha256: 'd'.repeat(64), fromCommit: '1'.repeat(40), toCommit: '2'.repeat(40) };
  let injected = false;
  const factory = root => {
    const pin = openProtectedDirectory(root);
    return { ...pin, createRecoveryLock(name) {
      const lock = pin.createRecoveryLock(name);
      return { ...lock, remove() {
        lock.remove();
        injected = true;
        throw Object.assign(new Error('injected close error after native delete disposition'),
          { recoveryDeleteMarked: true });
      } };
    } };
  };
  assert.deepEqual(registerComponentRecoveryCheckpoint(project, details, binding,
    { windowsPin: factory }), { schemaVersion: 1, project: path.resolve(project), ...details });
  assert.equal(injected, true);
  assert.deepEqual(readComponentRecoveryCheckpoint(project, { windowsPin: openProtectedDirectory }),
    { schemaVersion: 1, project: path.resolve(project), ...details });
  assert.equal(fs.readdirSync(f.registry).some(name => name.endsWith('.json.lock')), false);
});

for (const mode of ['Full', 'Attributes']) {
  test(`Windows native recovery root rejects in-place NTFS junction injection (${mode})`, t => {
    if (process.platform !== 'win32') return t.skip('Windows NTFS junction proof required');
    const f = fixture(t);
    const outside = path.join(f.dir, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside untouched\n');
    const store = openRecoveryStore(f.registry, { windowsPin: openProtectedDirectory });
    try {
      const probe = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive',
        '-ExecutionPolicy', 'Bypass', '-File', junctionProbe, '-Source', f.registry,
        '-Target', outside, '-AccessMode', mode], { encoding: 'utf8', timeout: 20000 });
      assert.equal(probe.status, 2, `held recovery guard must block ${mode} junction: ${probe.stdout}\n${probe.stderr}`);
      assert.match(probe.stdout, /BLOCKED:\d+/);
      const lock = store.createLock(`${id}.json.lock`);
      const record = store.createRecord(`${id}.recovery.json`, Buffer.from('anchored\n'));
      assert.equal(fs.readFileSync(path.join(f.registry, `${id}.recovery.json`), 'utf8'), 'anchored\n');
      assert.equal(fs.existsSync(path.join(outside, `${id}.recovery.json`)), false);
      assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'outside untouched\n');
      store.removeCreated(record);
      store.removeCreated(lock);
    } finally { store.close(); }
  });
}
