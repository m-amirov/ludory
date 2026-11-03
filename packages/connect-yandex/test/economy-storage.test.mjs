import test from 'node:test';
import assert from 'node:assert/strict';
import { createEconomyState, applyEconomyOperation, defineEconomy } from '@ludory/economy';
import { createYandexEconomyStorage } from '../src/index.mjs';

const config = defineEconomy({ schemaVersion: 1, enabled: true, gameId: 'iceland-game', configVersion: 1,
  currency: { id: 'crystals', displayName: 'Crystals', icon: '💎' }, maxBalance: 500,
  rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 }, premium: {}, products: {} });
const key = 'ludory:iceland-game:economy:v1';

function fakePlayer() {
  const values = new Map(), calls = [];
  const player = {
    isAuthorized: () => true,
    getData(names) { calls.push(['get', names]); return Promise.resolve(Object.fromEntries(names.filter(name => values.has(name))
      .map(name => [name, structuredClone(values.get(name))]))); },
    setData(data, flush) { calls.push(['set', structuredClone(data), flush]);
      for (const [name, value] of Object.entries(data)) values.set(name, structuredClone(value)); return Promise.resolve(); },
  };
  return { player, values, calls };
}

test('Yandex wallet is isolated from Core saves; validates and verifies flush/readback', async () => {
  const f = fakePlayer();
  const storage = createYandexEconomyStorage({ config, getPlayer: async () => f.player });
  assert.equal(storage.purchaseCloud, true);
  assert.equal(await storage.load(), null);
  const state = applyEconomyOperation(config, createEconomyState(config), { type: 'GRANT_STARTER' }).state;
  assert.equal(await storage.save(state), true);
  assert.deepEqual(f.calls.map(call => call[0]), ['get', 'set', 'get']);
  assert.deepEqual(f.calls[1], ['set', { [key]: state }, true]);
  const loaded = await storage.load();
  assert.deepEqual(loaded, state);
  assert.notStrictEqual(loaded, f.values.get(key));
  assert.equal(f.values.has('ludory:iceland-game:v1:slot'), false);
});

test('Yandex monetary adapter fails closed on unsigned, corrupt, lost-ack and mismatched readback', async () => {
  const f = fakePlayer();
  const state = createEconomyState(config);
  f.player.isAuthorized = () => false;
  const unauthorized = createYandexEconomyStorage({ config, getPlayer: async () => f.player });
  await assert.rejects(unauthorized.load(), { code: 'PLAYER_UNAVAILABLE' });
  assert.deepEqual(f.calls, []);
  f.player.isAuthorized = () => true;
  f.values.set(key, { schemaVersion: 1, balance: 1000 });
  const storage = createYandexEconomyStorage({ config, getPlayer: async () => f.player });
  await assert.rejects(storage.load(), { code: 'CLOUD_LOAD_FAILED' });
  f.player.setData = async () => {};
  await assert.rejects(storage.save(state), { code: 'CLOUD_SAVE_FAILED' });
  f.player.setData = () => Promise.reject(new Error('network'));
  await assert.rejects(storage.save(state), { code: 'CLOUD_SAVE_FAILED' });
});

test('Yandex monetary storage enforces capacity before write and prevents a broken save Promise', async () => {
  const f = fakePlayer();
  const storage = createYandexEconomyStorage({ config, getPlayer: async () => f.player, maxBytes: 50 });
  await assert.rejects(storage.save(createEconomyState(config)), { code: 'CLOUD_SAVE_FAILED' });
  assert.deepEqual(f.calls, []);
  assert.throws(() => createYandexEconomyStorage({ config, getPlayer: async () => f.player, maxBytes: 999_999 }));
});

test('a previously authorized Player cannot continue monetary writes after sign-out', async () => {
  const f = fakePlayer();
  const storage = createYandexEconomyStorage({ config, getPlayer: async () => f.player });
  assert.equal(await storage.load(), null);
  f.player.isAuthorized = () => false;
  await assert.rejects(storage.save(createEconomyState(config)), { code: 'PLAYER_UNAVAILABLE' });
  assert.deepEqual(f.calls.map(call => call[0]), ['get']);
});

test('cloud session can explicitly re-acquire Player identity after logout/login', async () => {
  const first = fakePlayer(), second = fakePlayer();
  let calls = 0;
  const storage = createYandexEconomyStorage({ config, getPlayer: async () => ++calls === 1 ? first.player : second.player });
  await storage.load();
  first.player.isAuthorized = () => false;
  await assert.rejects(storage.load(), { code: 'PLAYER_UNAVAILABLE' });
  assert.equal(await storage.load(), null);
  assert.equal(calls, 2);
});
