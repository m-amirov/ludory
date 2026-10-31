import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRuntimeHost, RuntimeError } from '@ludory/runtime';
import { createYandexPlayerStorage, YandexConnectError } from '../src/index.mjs';

const cloudKey = 'ludory:iceland-game:v1:iceland-game:manual';
const game = {
  schemaVersion: 1, id: 'iceland-game', version: '1.0.0',
  title: { en: 'Iceland game' }, engine: 'web', targets: ['yandex-games'],
};
const digest = async bytes => createHash('sha256').update(bytes).digest('hex');
const record = () => ({
  formatVersion: 1, savedAt: '2026-10-31T00:00:00.000Z',
  snapshot: { schemaVersion: 1, gameId: game.id, gameVersion: game.version, revision: 0, state: { score: 2 } },
  snapshotSha256: 'a'.repeat(64),
});

const connectError = code => error => error instanceof YandexConnectError && error.code === code;
const runtimeError = code => error => error instanceof RuntimeError && error.code === code;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakePlayer() {
  const data = new Map();
  const calls = [];
  const player = {
    getData(keys) {
      calls.push(['getData', keys]);
      return Promise.resolve(Object.fromEntries(keys.filter(key => data.has(key)).map(key => [key, data.get(key)])));
    },
    setData(entries, flush) {
      calls.push(['setData', structuredClone(entries), flush]);
      for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
      return Promise.resolve();
    },
  };
  return { player, data, calls };
}

function hostFixture(storage) {
  const environment = {
    root: {}, now: () => 0, utcNow: () => '2026-10-31T00:00:00.000Z', digestSha256: digest,
    requestFrame: () => 1, cancelFrame() {},
    getViewport: () => ({ width: 640, height: 360, dpr: 1, orientation: 'landscape' }),
    observeViewport: () => () => {},
  };
  return createRuntimeHost({
    game, initialState: { score: 2 }, update() {},
    renderer: { mount() {}, resize() {}, render() {}, unmount() {} },
    input: { subscribe: () => () => {}, enable() {}, disable() {} },
    storage, saveKey: 'iceland-game:manual', environment,
  });
}

test('Player storage reads and writes only its own versioned key, flushes and preserves a detached record', async () => {
  const { player, calls, data } = fakePlayer();
  let providers = 0;
  const storage = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => { providers++; return player; } });
  assert.equal(providers, 0, 'module construction must not invoke SDK');
  assert.equal(await storage.load('iceland-game:manual'), null);
  assert.deepEqual(calls.shift(), ['getData', [cloudKey]]);
  const incoming = record();
  await storage.save('iceland-game:manual', incoming);
  assert.deepEqual(calls.shift(), ['setData', { [cloudKey]: record() }, true]);
  incoming.snapshot.state.score = 99;
  assert.equal(data.get(cloudKey).snapshot.state.score, 2, 'SDK receives an independent snapshot');
  assert.deepEqual(await storage.load('iceland-game:manual'), record());
  assert.deepEqual(calls.shift(), ['getData', [cloudKey]]);
  assert.equal(providers, 1, 'successful Player provider is reused');
  data.set('unrelated:game:save', { keep: true });
  await storage.clear('iceland-game:manual');
  assert.deepEqual(calls.shift(), ['setData', { [cloudKey]: null }, true]);
  assert.deepEqual(data.get('unrelated:game:save'), { keep: true });
  assert.equal(await storage.load('iceland-game:manual'), null);
});

test('same key cannot leak between games and missing/null data never fabricate a record', async () => {
  const { player } = fakePlayer();
  const a = createYandexPlayerStorage({ namespace: 'first-game', getPlayer: async () => player });
  const b = createYandexPlayerStorage({ namespace: 'second-game', getPlayer: async () => player });
  await a.save('slot', record());
  assert.equal(await b.load('slot'), null);
  await b.save('slot', record());
  await a.clear('slot');
  assert.deepEqual(await b.load('slot'), record());
});

test('loaded records cannot mutate Player SDK data by aliasing without a cloud save', async () => {
  const { player, data, calls } = fakePlayer();
  const storage = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => player });
  await storage.save('slot', record());
  const loaded = await storage.load('slot');
  loaded.snapshot.state.score = 999;
  assert.deepEqual(await storage.load('slot'), record());
  assert.equal(data.get('ludory:iceland-game:v1:slot').snapshot.state.score, 2);
  assert.equal(calls.filter(call => call[0] === 'setData').length, 1,
    'a caller mutating its returned record must not trigger or simulate a save');
});

test('Player acquisition is lazy and shared in flight; denied Player is retried on next explicit operation', async () => {
  const acquisition = deferred();
  const { player } = fakePlayer();
  let attempts = 0;
  const adapter = createYandexPlayerStorage({ namespace: game.id, getPlayer: () => {
    attempts++;
    return attempts === 1 ? acquisition.promise : Promise.resolve(player);
  } });
  const first = adapter.load('slot-a');
  const second = adapter.load('slot-b');
  await Promise.resolve();
  assert.equal(attempts, 1);
  acquisition.reject(new Error('Player access denied'));
  await assert.rejects(first, connectError('PLAYER_UNAVAILABLE'));
  await assert.rejects(second, connectError('PLAYER_UNAVAILABLE'));
  assert.equal(await adapter.load('slot-c'), null);
  assert.equal(attempts, 2);
});

test('unavailable or malformed Player APIs and SDK failures remain typed errors with cause and no fallback', async () => {
  const unavailable = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => null });
  await assert.rejects(unavailable.load('slot'), connectError('PLAYER_UNAVAILABLE'));
  const malformed = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => ({ getData() {} }) });
  await assert.rejects(malformed.save('slot', record()), connectError('PLAYER_UNAVAILABLE'));

  const sdkError = new Error('RateLimitExceeded');
  const player = {
    getData: () => Promise.reject(sdkError),
    setData: () => Promise.reject(sdkError),
  };
  const adapter = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => player });
  await assert.rejects(adapter.load('slot'), error => connectError('CLOUD_LOAD_FAILED')(error) && error.cause === sdkError);
  await assert.rejects(adapter.save('slot', record()), error => connectError('CLOUD_SAVE_FAILED')(error) && error.cause === sdkError);
  await assert.rejects(adapter.clear('slot'), error => connectError('CLOUD_CLEAR_FAILED')(error) && error.cause === sdkError);

  const noAck = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => ({
    getData: () => undefined, setData: () => undefined,
  }) });
  await assert.rejects(noAck.load('slot'), connectError('CLOUD_LOAD_FAILED'));
  await assert.rejects(noAck.save('slot', record()), connectError('CLOUD_SAVE_FAILED'));
  await assert.rejects(noAck.clear('slot'), connectError('CLOUD_CLEAR_FAILED'));
});

test('invalid inputs and oversized UTF-8 JSON are rejected before any Player SDK write', async () => {
  assert.throws(() => createYandexPlayerStorage({ namespace: '', getPlayer() {} }), TypeError);
  assert.throws(() => createYandexPlayerStorage({ namespace: 'other/game', getPlayer() {} }), TypeError);
  assert.throws(() => createYandexPlayerStorage({ namespace: 'game', getPlayer: null }), TypeError);
  const { player, calls } = fakePlayer();
  const adapter = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => player });
  await assert.rejects(adapter.load(''), TypeError);
  await assert.rejects(adapter.save('slot', { bogus: true }), connectError('CLOUD_SAVE_FAILED'));
  await assert.rejects(adapter.save('slot', {
    ...record(), snapshot: { ...record().snapshot, state: { memo: 'я'.repeat(105_000) } },
  }), connectError('CLOUD_SAVE_FAILED'));
  assert.deepEqual(calls, [], 'bad inputs never write or consume Player requests');
});

test('serialized save/clear/load order waits for acknowledged writes', async () => {
  const pending = deferred();
  const firstWriteStarted = deferred();
  const { player, calls } = fakePlayer();
  const originalSetData = player.setData;
  let writes = 0;
  player.setData = (...args) => {
    writes++;
    if (writes === 1) {
      firstWriteStarted.resolve();
      return pending.promise.then(() => originalSetData(...args));
    }
    return originalSetData(...args);
  };
  const adapter = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => player });
  const saving = adapter.save('slot', record());
  const clearing = adapter.clear('slot');
  const loading = adapter.load('slot');
  await firstWriteStarted.promise;
  assert.equal(writes, 1, 'clear cannot overtake unresolved save');
  assert.equal(calls.length, 0, 'load cannot read inconsistent pending mutation');
  pending.resolve();
  await saving;
  await clearing;
  assert.equal(await loading, null);
  assert.deepEqual(calls.map(call => call[0]), ['setData', 'setData', 'getData']);
});

test('a rejected Player write does not poison the subsequent explicit retry', async () => {
  const { player } = fakePlayer();
  const regularSetData = player.setData;
  const failure = new Error('Temporary network failure');
  let attempts = 0;
  player.setData = (...args) => {
    attempts++;
    return attempts === 1 ? Promise.reject(failure) : regularSetData(...args);
  };
  const adapter = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => player });
  await assert.rejects(adapter.save('slot', record()), error => connectError('CLOUD_SAVE_FAILED')(error) && error.cause === failure);
  await adapter.save('slot', record());
  assert.deepEqual(await adapter.load('slot'), record());
  assert.equal(attempts, 2);
});

test('real Runtime host saves SHA-256 envelope through Player and restores it without losing state', async () => {
  const { player, data } = fakePlayer();
  const storage = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => player });
  const source = hostFixture(storage);
  await source.initialize();
  await source.save();
  const saved = data.get(cloudKey);
  assert.match(saved.snapshotSha256, /^[0-9a-f]{64}$/);
  assert.equal(saved.snapshot.state.score, 2);
  // Recreate the adapter as a fresh game launch would, against the same cloud state.
  const reopenedStorage = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => player });
  const target = hostFixture(reopenedStorage);
  await target.initialize();
  await target.restore();
  assert.deepEqual(target.getSnapshot(), source.getSnapshot());
  await source.destroy();
  await target.destroy();
});

test('Runtime rejects malformed hash and incompatible schema fetched from Player without changing state', async () => {
  const { player, data } = fakePlayer();
  const storage = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => player });
  const source = hostFixture(storage);
  await source.initialize();
  await source.save();
  const original = structuredClone(data.get(cloudKey));
  await source.destroy();

  for (const [change, expected] of [
    [{ snapshotSha256: '0'.repeat(64) }, 'RESTORE_CORRUPT'],
    [{ formatVersion: 2 }, 'RESTORE_INCOMPATIBLE'],
  ]) {
    data.set(cloudKey, { ...structuredClone(original), ...change });
    const target = hostFixture(storage);
    await target.initialize();
    await assert.rejects(target.restore(), runtimeError(expected));
    assert.deepEqual(target.getSnapshot().state, { score: 2 });
    await target.destroy();
  }
});

test('unavailable cloud Player cannot fabricate save or restore success in Runtime', async () => {
  const storage = createYandexPlayerStorage({ namespace: game.id, getPlayer: async () => { throw new Error('offline'); } });
  const host = hostFixture(storage);
  await host.initialize();
  await assert.rejects(host.save(), runtimeError('SAVE_FAILED'));
  await assert.rejects(host.restore(), runtimeError('RESTORE_FAILED'));
  await host.destroy();
});
