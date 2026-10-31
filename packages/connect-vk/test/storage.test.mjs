import test from 'node:test';
import assert from 'node:assert/strict';
import { createVkStorage } from '../src/storage.mjs';
import { VkConnectError } from '../src/errors.mjs';

const record = (score = 2) => ({
  formatVersion: 1, savedAt: '2026-10-31T00:00:00.000Z',
  snapshot: { schemaVersion: 1, gameId: 'test-game', gameVersion: '1.0.0',
    revision: 1, state: { score } }, snapshotSha256: '0'.repeat(64),
});
const code = expected => error => error instanceof VkConnectError && error.code === expected;
function fixture() {
  const items = new Map(), calls = [];
  const bridge = { async send(method, args) {
    calls.push([method, args]);
    if (method === 'VKWebAppStorageSet') {
      items.set(args.key, args.value);
      return { result: true };
    }
    if (method === 'VKWebAppStorageGet') {
      return { keys: args.keys.map(key => ({ key, value: items.get(key) ?? '' })) };
    }
    throw new Error('Unexpected method');
  } };
  return { items, calls, bridge };
}

test('VK save/load/clear uses game namespace without localStorage fallback', async () => {
  const f = fixture();
  const storage = createVkStorage({ bridge: f.bridge, namespace: 'new-game' });
  await storage.save('slot_1', record());
  assert.equal(f.calls[0][0], 'VKWebAppStorageSet');
  assert.equal(f.calls[0][1].key, 'ludory_8_new_game_v1_slot_1');
  assert.deepEqual(await storage.load('slot_1'), record());
  await storage.clear('slot_1');
  assert.equal(await storage.load('slot_1'), null);
  assert.equal(await storage.load('never_written'), null);
});

test('empty VK key array means missing while malformed response is a failure', async () => {
  const missing = createVkStorage({ bridge: { send: async () => ({ keys: [] }) }, namespace: 'demo' });
  assert.equal(await missing.load('slot'), null);
  const invalid = createVkStorage({ bridge: { send: async () => ({
    keys: [{ key: 'other', value: '{}' }],
  }) }, namespace: 'demo' });
  await assert.rejects(invalid.load('slot'), code('STORAGE_LOAD_FAILED'));
});

test('malformed and oversized remote VK JSON never becomes a valid save', async () => {
  const f = fixture(), storage = createVkStorage({ bridge: f.bridge, namespace: 'demo' });
  f.items.set('ludory_4_demo_v1_slot', '{"formatVersion":1,');
  await assert.rejects(storage.load('slot'), code('STORAGE_CORRUPT'));
  f.items.set('ludory_4_demo_v1_slot', 'Ж'.repeat(2000));
  await assert.rejects(storage.load('slot'), code('STORAGE_CORRUPT'));
});

test('UTF-8 quota blocks oversized Cyrillic snapshot before calling VK', async () => {
  const f = fixture(), storage = createVkStorage({ bridge: f.bridge, namespace: 'demo' });
  const long = record();
  long.snapshot.state.text = 'Ж'.repeat(2000);
  await assert.rejects(storage.save('slot', long), code('STORAGE_SAVE_FAILED'));
  assert.equal(f.calls.length, 0);
});

test('invalid Runtime record, unsafe keys and namespace are rejected', async () => {
  const f = fixture(), storage = createVkStorage({ bridge: f.bridge, namespace: 'demo' });
  await assert.rejects(storage.save('slot', { foo: 1 }), code('STORAGE_SAVE_FAILED'));
  await assert.rejects(storage.load('../other'), TypeError);
  await assert.rejects(storage.clear('a.b'), TypeError);
  assert.throws(() => createVkStorage({ bridge: f.bridge, namespace: 'Demo' }), TypeError);
  assert.deepEqual(f.calls, []);
});

test('concurrent save/read/clear serialize operations and preserve unrelated saves', async () => {
  const f = fixture(), storage = createVkStorage({ bridge: f.bridge, namespace: 'demo' });
  const results = await Promise.all([
    storage.save('one', record(1)), storage.save('two', record(99)),
    storage.load('one'), storage.clear('one'), storage.load('one'), storage.load('two'),
  ]);
  assert.equal(results[2].snapshot.state.score, 1);
  assert.equal(results[4], null);
  assert.equal(results[5].snapshot.state.score, 99);
});

test('Bridge rejects, non-promises and unacknowledged writes remain failures', async () => {
  const unavailable = createVkStorage({ bridge: { send() {
    throw new Error('offline');
  } }, namespace: 'demo' });
  await assert.rejects(unavailable.load('slot'), code('STORAGE_LOAD_FAILED'));
  await assert.rejects(unavailable.save('slot', record()), code('STORAGE_SAVE_FAILED'));
  await assert.rejects(unavailable.clear('slot'), code('STORAGE_CLEAR_FAILED'));
  const denied = createVkStorage({ bridge: { send: async () => ({ result: false }) }, namespace: 'demo' });
  await assert.rejects(denied.save('slot', record()), code('STORAGE_SAVE_FAILED'));
  await assert.rejects(denied.clear('slot'), code('STORAGE_CLEAR_FAILED'));
  const nonPromise = createVkStorage({ bridge: { send: () => ({ result: true }) }, namespace: 'demo' });
  await assert.rejects(nonPromise.save('slot', record()), code('STORAGE_SAVE_FAILED'));
});


test('namespace and key encoding is injective across distinct games', async () => {
  const f = fixture();
  const a = createVkStorage({ bridge: f.bridge, namespace: 'a' });
  const b = createVkStorage({ bridge: f.bridge, namespace: 'a-v1-b' });
  await a.save('b_v1_c', record(111));
  await b.save('c', record(222));
  assert.equal((await a.load('b_v1_c')).snapshot.state.score, 111);
  assert.equal((await b.load('c')).snapshot.state.score, 222);
  await b.clear('c');
  assert.equal((await a.load('b_v1_c')).snapshot.state.score, 111);
});
