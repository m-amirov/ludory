import test from 'node:test';
import assert from 'node:assert/strict';
import { createYandexPurchases } from '../src/index.mjs';

function fixture() {
  const calls = [];
  const player = { isAuthorized: () => true };
  const payments = {
    getCatalog() { calls.push('catalog'); return Promise.resolve([{
      id: 'pack_small', title: 'Crystals', description: '100 gems', imageURI: 'https://example.test/i.png',
      price: '10 Yans', priceValue: '10', priceCurrencyCode: 'YAN',
      getPriceCurrencyImage: size => { calls.push(`icon:${size}`); return 'https://example.test/yan.svg'; },
    }]); },
    getPurchases() { calls.push('restore'); return Promise.resolve([{ productID: 'pack_small', purchaseToken: 'T-1' }]); },
    purchase({ id }) { calls.push(`buy:${id}`); return Promise.resolve({ productID: id, purchaseToken: 'T-2' }); },
    consumePurchase(token) { calls.push(`consume:${token}`); return Promise.resolve(); },
  };
  const sdk = { getPayments() { calls.push('getPayments'); return Promise.resolve(payments); } };
  const locks = { request(name, opts, callback) { calls.push(`lock:${name}`);
    assert.equal(opts.ifAvailable, true); return callback({ name }); } };
  return { calls, player, payments, sdk, locks };
}

test('Yandex payments are lazy, unsigned, authorized and expose SDK currency/price only', async () => {
  const f = fixture();
  const adapter = createYandexPurchases({ sdk: f.sdk, getPlayer: async () => f.player,
    lockManager: f.locks, gameId: 'iceland-game' });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await adapter.getCatalog(), [{ id: 'pack_small', title: 'Crystals', description: '100 gems',
    imageURI: 'https://example.test/i.png', price: '10 Yans', priceValue: '10',
    priceCurrencyCode: 'YAN', priceCurrencyImage: 'https://example.test/yan.svg' }]);
  assert.equal(f.calls[0], 'getPayments');
  assert.equal(f.calls.includes('icon:small'), true);
  await adapter.runExclusive(async () => {
    assert.deepEqual(await adapter.getPurchases(), [{ productID: 'pack_small', purchaseToken: 'T-1' }]);
    assert.deepEqual(await adapter.purchase('pack_small'), { productID: 'pack_small', purchaseToken: 'T-2' });
    await adapter.consumePurchase('T-2');
  });
  assert.deepEqual(f.calls.slice(-3), ['restore', 'buy:pack_small', 'consume:T-2']);
});

test('Yandex payment adapter fails closed without Web Locks, signed-in user, API or catalog metadata', async () => {
  const f = fixture();
  const noLock = createYandexPurchases({ sdk: f.sdk, getPlayer: async () => f.player,
    gameId: 'iceland-game', lockManager: null });
  await assert.rejects(noLock.runExclusive(async () => true), { code: 'PURCHASE_UNAVAILABLE' });
  f.player.isAuthorized = () => false;
  const noUser = createYandexPurchases({ sdk: f.sdk, getPlayer: async () => f.player,
    gameId: 'iceland-game', lockManager: f.locks });
  await assert.rejects(noUser.getCatalog(), { code: 'PURCHASE_UNAVAILABLE' });
  f.player.isAuthorized = () => true;
  f.payments.getCatalog = async () => [{ id: 'pack_small', price: '10' }];
  await assert.rejects(noUser.getCatalog(), { code: 'PURCHASE_FAILED' });
  const blocked = createYandexPurchases({ sdk: {}, getPlayer: async () => f.player,
    gameId: 'iceland-game', lockManager: f.locks });
  await assert.rejects(blocked.getPurchases(), { code: 'PURCHASE_UNAVAILABLE' });
});

test('lost lock and SDK purchase failure never silently fake a purchase', async () => {
  const f = fixture();
  const adapter = createYandexPurchases({ sdk: f.sdk, getPlayer: async () => f.player,
    gameId: 'iceland-game', lockManager: { request: (_, __, task) => task(null) } });
  await assert.rejects(adapter.runExclusive(async () => true), { code: 'PURCHASE_UNAVAILABLE' });
  f.payments.purchase = () => Promise.reject(new Error('cancelled'));
  const active = createYandexPurchases({ sdk: f.sdk, getPlayer: async () => f.player,
    gameId: 'iceland-game', lockManager: f.locks });
  await assert.rejects(active.purchase('pack_small'), { code: 'PURCHASE_FAILED' });
});

test('explicit retry can re-acquire a new authorized Player after guest session', async () => {
  const f = fixture();
  const guest = { isAuthorized: () => false };
  let calls = 0;
  const adapter = createYandexPurchases({ sdk: f.sdk,
    getPlayer: async () => ++calls === 1 ? guest : f.player,
    gameId: 'iceland-game', lockManager: f.locks });
  await assert.rejects(adapter.getCatalog(), { code: 'PURCHASE_UNAVAILABLE' });
  assert.equal((await adapter.getCatalog()).length, 1);
  assert.equal(calls, 2);
});

test('an unrelated broken SDK product must not hide configured valid store products', async () => {
  const f = fixture();
  const original = f.payments.getCatalog.bind(f.payments);
  f.payments.getCatalog = async () => [{ id: 'unrelated.product', price: '3', title: 'Unrelated' },
    ...(await original())];
  const adapter = createYandexPurchases({ sdk: f.sdk, getPlayer: async () => f.player,
    gameId: 'iceland-game', lockManager: f.locks });
  const catalog = await adapter.getCatalog();
  assert.deepEqual(catalog.map(item => item.id), ['pack_small']);
});

test('documented direct sdk.payments object is accepted without signed mode', async () => {
  const f = fixture();
  const adapter = createYandexPurchases({ sdk: { payments: f.payments }, getPlayer: async () => f.player,
    gameId: 'iceland-game', lockManager: f.locks });
  assert.equal((await adapter.getCatalog())[0].id, 'pack_small');
});

test('an SDK purchase that never settles times out without inventing a receipt or consuming', async () => {
  const f = fixture();
  f.payments.purchase = () => new Promise(() => {});
  const adapter = createYandexPurchases({ sdk: f.sdk, getPlayer: async () => f.player,
    gameId: 'iceland-game', lockManager: f.locks, timeoutMs: 20 });
  await assert.rejects(adapter.purchase('pack_small'), { code: 'PURCHASE_FAILED' });
  assert.equal(f.calls.some(call => call.startsWith('consume:')), false);
});
