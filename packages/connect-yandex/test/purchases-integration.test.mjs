import test from 'node:test';
import assert from 'node:assert/strict';
import { defineEconomy } from '@ludory/economy';
import { createEconomyRuntime } from '@ludory/runtime-economy';
import { createYandexEconomyStorage, createYandexPurchases } from '../src/index.mjs';

function setup() {
  const config = defineEconomy({ schemaVersion: 1, enabled: true, gameId: 'test-iap', configVersion: 1,
    currency: { id: 'crystals', displayName: 'Crystals', icon: '💎' }, maxBalance: 500,
    rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 }, premium: {},
    products: { pack_small: { currencyAmount: 100 } } });
  const db = new Map(), events = [], outstanding = [];
  const player = { isAuthorized: () => true,
    async getData(keys) { events.push('getData'); return Object.fromEntries(keys.filter(key => db.has(key))
      .map(key => [key, structuredClone(db.get(key))])); },
    async setData(object, flush) { events.push('setData'); assert.equal(flush, true);
      for (const [key, value] of Object.entries(object)) db.set(key, structuredClone(value)); },
  };
  const payments = {
    async getCatalog() { return [{ id: 'pack_small', title: '100 crystals', price: '12 портальных единиц',
      priceValue: '12', priceCurrencyCode: 'YAN', getPriceCurrencyImage: () => 'sdk://currency' }]; },
    async getPurchases() { return outstanding.map(item => ({ ...item })); },
    async purchase({ id }) { events.push('purchase'); const item = { productID: id, purchaseToken: 'sdk-secret' };
      outstanding.push(item); return item; },
    async consumePurchase(token) { events.push('consume'); const index = outstanding.findIndex(item => item.purchaseToken === token);
      if (index !== -1) outstanding.splice(index, 1); },
  };
  const sdk = { async getPayments() { events.push('getPayments'); return payments; } };
  const locks = { request: (_, __, task) => task({}) };
  const runtime = () => createEconomyRuntime({ config,
    storage: createYandexEconomyStorage({ config, getPlayer: async () => player }),
    purchases: createYandexPurchases({ sdk, getPlayer: async () => player, gameId: config.gameId, lockManager: locks }),
    activeSkus: ['pack_small'],
  });
  return { config, db, events, outstanding, player, payments, sdk, runtime };
}

test('end-to-end mock SDK credit is persisted under separate cloud key before consume; survives new runtime', async () => {
  const f = setup();
  const first = f.runtime();
  await first.initialize();
  assert.equal((await first.getStoreCatalog())[0].price, '12 портальных единиц');
  await first.purchaseProduct('pack_small');
  assert.equal(f.events.indexOf('setData') < f.events.lastIndexOf('consume'), true);
  assert.equal(first.getView().balance, 100);
  assert.equal(f.db.has('ludory:test-iap:economy:v1'), true);
  first.dispose();
  const second = f.runtime();
  await second.initialize();
  assert.deepEqual(await second.restorePurchases(), { processed: 0, credited: 0, unknownSkus: 0 });
  assert.equal(second.getView().balance, 100);
  assert.deepEqual(f.outstanding, []);
});

test('silent Player write loss blocks consume and never reports successful purchase', async () => {
  const f = setup();
  const runtime = f.runtime();
  await runtime.initialize();
  f.player.setData = async () => { f.events.push('dropped-write'); };
  await assert.rejects(runtime.purchaseProduct('pack_small'), { code: 'CLOUD_SAVE_FAILED' });
  assert.equal(f.events.includes('consume'), false);
  assert.equal(runtime.getView().ready, false);
  assert.equal(f.outstanding.length, 1);
});
