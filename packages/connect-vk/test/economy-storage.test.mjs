import test from 'node:test';
import assert from 'node:assert/strict';
import { createEconomyState, applyEconomyOperation, defineEconomy } from '@ludory/economy';
import { createVkEconomyStorage } from '../src/index.mjs';

const config = defineEconomy({ schemaVersion: 1, enabled: true, gameId: 'vk-game', configVersion: 1,
  currency: { id: 'crystals', displayName: 'Crystals', icon: '💎' }, maxBalance: 500,
  rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 }, premium: {}, products: {} });
function fakeBridge() {
  const data = new Map(), calls = [];
  const bridge = { async send(method, params) {
    calls.push([method, params]);
    if (method === 'VKWebAppStorageSet') { data.set(params.key, params.value); return { result: true }; }
    if (method === 'VKWebAppStorageGet') return { keys: params.keys.map(key => ({ key, value: data.get(key) ?? '' })) };
  } };
  return { bridge, calls, data };
}

test('VK wallet uses separate bounded cloud key, readback and no payment capability', async () => {
  const f = fakeBridge();
  const storage = createVkEconomyStorage({ config, bridge: f.bridge });
  assert.equal(storage.purchaseCloud, false);
  assert.equal(await storage.load(), null);
  const state = applyEconomyOperation(config, createEconomyState(config), { type: 'GRANT_STARTER' }).state;
  assert.equal(await storage.save(state), true);
  assert.deepEqual(await storage.load(), state);
  assert.equal(f.calls[0][0], 'VKWebAppStorageGet');
  assert.equal(f.calls[1][0], 'VKWebAppStorageSet');
  assert.match(f.calls[1][1].key, /economy/);
  assert.equal(f.calls[2][0], 'VKWebAppStorageGet');
});

test('VK corrupt, quota, failed write, and truncation all fail closed', async () => {
  const f = fakeBridge();
  const storage = createVkEconomyStorage({ config, bridge: f.bridge, maxBytes: 150 });
  await assert.rejects(storage.save(createEconomyState(config)), { code: 'STORAGE_SAVE_FAILED' });
  assert.deepEqual(f.calls, []);
  const regular = createVkEconomyStorage({ config, bridge: f.bridge });
  const state = createEconomyState(config);
  await regular.save(state);
  const name = f.calls[0][1].key;
  f.data.set(name, '{bad');
  await assert.rejects(regular.load(), { code: 'STORAGE_CORRUPT' });
  f.data.set(name, JSON.stringify({ ...state, balance: 123 }));
  await assert.rejects(regular.load(), { code: 'STORAGE_CORRUPT' });
  f.bridge.send = async (method, args) => method === 'VKWebAppStorageSet' ? { result: false } : { keys: [{ key: args.keys[0], value: '' }] };
  await assert.rejects(regular.save(state), { code: 'STORAGE_SAVE_FAILED' });
});

test('VK game slug underscores cannot collide with hyphens in another game wallet', async () => {
  const f = fakeBridge();
  const a = defineEconomy({ ...config, gameId: 'a-b' });
  const b = defineEconomy({ ...config, gameId: 'a_b' });
  const first = createVkEconomyStorage({ config: a, bridge: f.bridge });
  const second = createVkEconomyStorage({ config: b, bridge: f.bridge });
  await first.save(createEconomyState(a));
  await second.save(createEconomyState(b));
  assert.equal(f.data.size, 2);
  assert.equal((await first.load()).gameId, 'a-b');
  assert.equal((await second.load()).gameId, 'a_b');
});

test('a VK Bridge read network failure is not mislabeled as a corrupt wallet', async () => {
  const f = fakeBridge();
  const storage = createVkEconomyStorage({ config, bridge: f.bridge });
  f.bridge.send = async () => { throw new Error('offline'); };
  await assert.rejects(storage.load(), { code: 'STORAGE_LOAD_FAILED' });
});
