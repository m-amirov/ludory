import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGameSession } from '@ludory/core';
import {
  RuntimeError, createRuntimeHost, encodePersistedRecord,
  decodePersistedRecord, encodeCanonicalSnapshot, createBrowserStorage, createBrowserEnvironment,
} from '../src/index.mjs';

const game = { schemaVersion: 1, id: 'persistence-test', version: '1.0.0',
  title: { en: 'Persistence test' }, engine: 'web', targets: ['yandex-games'] };
const digest = async bytes => createHash('sha256').update(bytes).digest('hex');
const utcNow = () => '2026-10-29T12:34:56.000Z';

function errorCode(code) {
  return error => error instanceof RuntimeError && error.code === code;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function memoryStorage() {
  const records = new Map();
  const calls = [];
  return {
    records, calls,
    async load(key) { calls.push(['load', key]); return records.get(key) ?? null; },
    async save(key, record) { calls.push(['save', key]); records.set(key, structuredClone(record)); },
    async clear(key) { calls.push(['clear', key]); records.delete(key); },
  };
}

function hostFixture({ storage, environment: environmentOverrides = {}, gameDefinition = game, ...overrides } = {}) {
  let callback;
  const renders = [];
  const events = [];
  const environment = {
    root: {}, now: () => 5, utcNow, digestSha256: digest,
    requestFrame(fn) { callback = fn; return 1; },
    cancelFrame() { callback = null; },
    getViewport: () => ({ width: 640, height: 360, dpr: 1, orientation: 'landscape' }),
    observeViewport: () => () => {},
    ...environmentOverrides,
  };
  const host = createRuntimeHost({
    game: gameDefinition,
    initialState: { score: 1 },
    update({ state, setState }) { setState({ score: state.score + 1 }); },
    renderer: { mount() {}, resize() {}, render(snapshot) { renders.push(snapshot); }, unmount() {} },
    input: { subscribe: () => () => {}, enable() {}, disable() {} },
    storage,
    saveKey: storage ? `${gameDefinition.id}:manual` : undefined,
    environment, ...overrides,
  });
  host.subscribe(event => events.push(event));
  return { host, renders, events, frame() { assert.ok(callback); const tick = callback; callback = null; tick(); } };
}

test('canonical snapshot encoding is stable across property insertion order, preserves revision, and restores real Core', async () => {
  const session = createGameSession({ definition: game, initialState: { z: { b: 2, a: 1 }, a: 4 } });
  session.initialize();
  session.start();
  session.tick(0);
  session.pause();
  const snapshot = session.snapshot();
  const record = await encodePersistedRecord(snapshot, { savedAt: utcNow(), digestSha256: digest });
  assert.deepEqual(Object.keys(record), ['formatVersion', 'savedAt', 'snapshot', 'snapshotSha256']);
  assert.equal(record.snapshot.revision, 0);
  const reordered = { ...snapshot, state: { a: 4, z: { a: 1, b: 2 } } };
  const equivalent = await encodePersistedRecord(reordered, { savedAt: utcNow(), digestSha256: digest });
  assert.equal(equivalent.snapshotSha256, record.snapshotSha256);
  assert.match(record.snapshotSha256, /^[a-f0-9]{64}$/);
  const decoded = await decodePersistedRecord(record, { game, digestSha256: digest });
  assert.deepEqual(decoded, snapshot);
  assert.deepEqual(Object.keys(decoded), ['schemaVersion', 'gameId', 'gameVersion', 'revision', 'state']);
  const restored = createGameSession({ definition: game, initialState: {} });
  restored.initialize();
  restored.restore(decoded);
  assert.deepEqual(restored.snapshot(), snapshot);
});

test('canonical encoder uses byte-lexicographic keys even for numeric-looking property names', () => {
  const snapshot = { schemaVersion: 1, gameId: game.id, gameVersion: game.version,
    revision: 0, state: { '2': 'second', '10': 'tenth', accent: { 'é': 1, 'a': 2 } } };
  assert.equal(new TextDecoder().decode(encodeCanonicalSnapshot(snapshot)),
    '{"gameId":"persistence-test","gameVersion":"1.0.0","revision":0,"schemaVersion":1,"state":{"10":"tenth","2":"second","accent":{"a":2,"é":1}}}');
});

test('different lone-surrogate keys have deterministic canonical order after UTF-8 replacement', () => {
  const stateA = { '\ud800': 'first', '\ud801': 'second' };
  const stateB = { '\ud801': 'second', '\ud800': 'first' };
  const bytes = state => encodeCanonicalSnapshot({ schemaVersion: 1, gameId: game.id,
    gameVersion: game.version, revision: 0, state });
  assert.deepEqual(bytes(stateA), bytes(stateB));
});

test('explicit host save/restore round trip uses real Core and renders restored snapshot before start', async () => {
  const storage = memoryStorage();
  const source = hostFixture({ storage });
  await source.host.initialize();
  assert.deepEqual(storage.calls, [], 'initialize must not auto-restore');
  source.host.start();
  source.frame();
  source.host.pause();
  assert.deepEqual(storage.calls, [], 'pause must not auto-save');
  await source.host.save();
  assert.deepEqual(storage.calls.map(call => call[0]), ['save']);
  assert.equal(storage.records.get('persistence-test:manual').snapshot.revision, 1);
  assert.equal(storage.records.get('persistence-test:manual').snapshot.state.score, 2);

  const target = hostFixture({ storage });
  await target.host.initialize();
  assert.equal(target.host.getSnapshot().revision, 0);
  await target.host.restore();
  assert.deepEqual(target.host.getSnapshot(), source.host.getSnapshot());
  assert.equal(target.renders.at(-1).revision, 1);
  assert.equal(target.host.getStatus(), 'READY');
  target.host.start();
  target.frame();
  assert.equal(target.host.getSnapshot().revision, 2);
  await target.host.destroy();
  await source.host.destroy();
});

test('save and restore fail closed without storage or crypto provider', async () => {
  const absent = hostFixture();
  await absent.host.initialize();
  await assert.rejects(absent.host.save(), errorCode('STORAGE_UNAVAILABLE'));
  await assert.rejects(absent.host.restore(), errorCode('STORAGE_UNAVAILABLE'));
  await absent.host.destroy();

  const missing = hostFixture({ storage: memoryStorage(), environment: { digestSha256: undefined } });
  await missing.host.initialize();
  await assert.rejects(missing.host.save(), errorCode('DIGEST_UNAVAILABLE'));
  await assert.rejects(missing.host.restore(), errorCode('DIGEST_UNAVAILABLE'));
  await missing.host.destroy();
});

test('save and restore preserve the digest provider method receiver', async () => {
  const storage = memoryStorage();
  const fixture = hostFixture({
    storage,
    environment: {
      hasher: digest,
      async digestSha256(bytes) { return this.hasher(bytes); },
    },
  });
  await fixture.host.initialize();
  await fixture.host.save();
  await fixture.host.restore();
  assert.equal(fixture.host.getSnapshot().revision, 0);
  await fixture.host.destroy();
});

test('save rejects adapters that do not acknowledge asynchronous write completion', async () => {
  const storage = memoryStorage();
  storage.save = () => undefined; // A write scheduled later is not a committed save.
  const fixture = hostFixture({ storage });
  await fixture.host.initialize();
  await assert.rejects(fixture.host.save(), errorCode('SAVE_FAILED'));
  await fixture.host.destroy();
});

test('invalid persisted data and digests are rejected before mutating Core; identity/versions are incompatible', async () => {
  const baseline = await encodePersistedRecord({ schemaVersion: 1, gameId: game.id,
    gameVersion: '1.0.0', revision: 3, state: { score: 7 } },
  { savedAt: utcNow(), digestSha256: digest });
  for (const [change, code] of [
    [{ snapshotSha256: '0'.repeat(64) }, 'RESTORE_CORRUPT'],
    [{ extra: true }, 'RESTORE_CORRUPT'],
    [{ snapshot: { ...baseline.snapshot, extra: 1 } }, 'RESTORE_CORRUPT'],
    [{ formatVersion: 2 }, 'RESTORE_INCOMPATIBLE'],
    [{ snapshot: { ...baseline.snapshot, schemaVersion: 2 } }, 'RESTORE_INCOMPATIBLE'],
    [{ snapshot: { ...baseline.snapshot, gameVersion: '2.0.0' } }, 'RESTORE_INCOMPATIBLE'],
    [{ snapshot: { ...baseline.snapshot, gameId: 'other-game' } }, 'RESTORE_INCOMPATIBLE'],
  ]) {
    const storage = memoryStorage();
    storage.records.set('persistence-test:manual', { ...structuredClone(baseline), ...change });
    const fixture = hostFixture({ storage });
    await fixture.host.initialize();
    await assert.rejects(fixture.host.restore(), errorCode(code));
    assert.equal(fixture.host.getSnapshot().revision, 0);
    assert.deepEqual(fixture.host.getSnapshot().state, { score: 1 });
    await fixture.host.destroy();
  }
});

test('pending saves are serialized; destroy/restore cannot race a write and no premature success is reported', async () => {
  const first = deferred();
  const second = deferred();
  const firstStarted = deferred();
  const secondStarted = deferred();
  const calls = [];
  const storage = memoryStorage();
  storage.save = async (...args) => {
    calls.push(args);
    (calls.length === 1 ? firstStarted : secondStarted).resolve();
    await (calls.length === 1 ? first.promise : second.promise);
  };
  const fixture = hostFixture({ storage });
  await fixture.host.initialize();
  const a = fixture.host.save();
  const b = fixture.host.save();
  await firstStarted.promise;
  assert.equal(calls.length, 1, 'second write must not start until first completes');
  await assert.rejects(fixture.host.restore(), errorCode('RUNTIME_OPERATION_IN_PROGRESS'));
  await assert.rejects(fixture.host.destroy(), errorCode('RUNTIME_OPERATION_IN_PROGRESS'));
  assert.equal(fixture.host.getStatus(), 'READY');
  assert.equal(fixture.events.some(event => event.type === 'saved'), false);
  first.resolve();
  await a;
  await secondStarted.promise;
  assert.equal(calls.length, 2);
  second.resolve();
  await b;
  await fixture.host.destroy();
});

test('storage read and write exceptions are classified; restore is forbidden after start', async () => {
  const storage = memoryStorage();
  storage.save = async () => { throw new Error('QuotaExceededError'); };
  storage.load = async () => { throw new Error('disk offline'); };
  const fixture = hostFixture({ storage });
  await fixture.host.initialize();
  await assert.rejects(fixture.host.save(), error => errorCode('SAVE_FAILED')(error) && error.cause?.message === 'QuotaExceededError');
  await assert.rejects(fixture.host.restore(), error => errorCode('RESTORE_FAILED')(error) && error.cause?.message === 'disk offline');
  fixture.host.start();
  await assert.rejects(fixture.host.restore(), errorCode('INVALID_RUNTIME_TRANSITION'));
  await fixture.host.destroy();
});

test('in-flight restore blocks transition and save; missing record does not touch Core', async () => {
  const load = deferred();
  const storage = memoryStorage();
  storage.load = () => load.promise;
  const fixture = hostFixture({ storage });
  await fixture.host.initialize();
  const restoring = fixture.host.restore();
  assert.throws(() => fixture.host.start(), errorCode('RUNTIME_OPERATION_IN_PROGRESS'));
  await assert.rejects(fixture.host.save(), errorCode('RUNTIME_OPERATION_IN_PROGRESS'));
  await assert.rejects(fixture.host.destroy(), errorCode('RUNTIME_OPERATION_IN_PROGRESS'));
  load.resolve(null);
  await assert.rejects(restoring, errorCode('RESTORE_FAILED'));
  assert.equal(fixture.host.getStatus(), 'READY');
  assert.equal(fixture.host.getSnapshot().revision, 0);
  await fixture.host.destroy();
});

test('browser storage writes exact JSON and propagates quota failures; environment provides browser clock/digest and viewport', async () => {
  const data = new Map();
  const fakeLocalStorage = {
    getItem: key => data.get(key) ?? null,
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
  const storage = createBrowserStorage({ storage: fakeLocalStorage, namespace: 'ludory' });
  const record = await encodePersistedRecord({ schemaVersion: 1, gameId: game.id,
    gameVersion: game.version, revision: 1, state: { score: 7 } },
  { savedAt: utcNow(), digestSha256: digest });
  await storage.save('slot', record);
  assert.equal(data.has('ludory:slot'), true);
  assert.deepEqual(await storage.load('slot'), record);
  await storage.clear('slot');
  assert.equal(await storage.load('slot'), null);
  fakeLocalStorage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(storage.save('slot', record), /quota/);

  const listeners = new Set();
  const element = { getBoundingClientRect: () => ({ width: 300, height: 600 }) };
  const fakeWindow = {
    devicePixelRatio: 2,
    performance: { now: () => 12 },
    requestAnimationFrame: callback => { listeners.add(callback); return 1; },
    cancelAnimationFrame: () => {},
    addEventListener: (_, callback) => listeners.add(callback),
    removeEventListener: (_, callback) => listeners.delete(callback),
  };
  const env = createBrowserEnvironment({ root: element, windowObject: fakeWindow,
    cryptoObject: { subtle: { digest: async (_, bytes) => createHash('sha256').update(bytes).digest() } }, utcNow });
  assert.deepEqual(env.getViewport(), { width: 300, height: 600, dpr: 2, orientation: 'portrait' });
  assert.equal(env.now(), 12);
  assert.equal(await env.digestSha256(new TextEncoder().encode('test')),
    createHash('sha256').update('test').digest('hex'));
  const detach = env.observeViewport(() => {});
  detach();
});

test('browser storage refuses absent provider and malformed JSON without inventing a record', async () => {
  assert.throws(() => createBrowserStorage({ storage: null }), errorCode('STORAGE_UNAVAILABLE'));
  const provider = { getItem: () => '{broken', setItem() {}, removeItem() {} };
  const adapter = createBrowserStorage({ storage: provider });
  await assert.rejects(adapter.load('slot'), errorCode('RESTORE_CORRUPT'));
});

test('browser storage wraps denied localStorage discovery as STORAGE_UNAVAILABLE', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true,
      get() { throw new Error('SecurityError: storage denied'); } });
    assert.throws(() => createBrowserStorage(), error =>
      errorCode('STORAGE_UNAVAILABLE')(error) && error.cause?.message.includes('SecurityError'));
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
});
