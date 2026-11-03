import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyEconomyOperation, createEconomyState, defineEconomy } from '@ludory/economy';
import { createEconomyRuntime, definePremiumManifest } from '../src/index.mjs';
import { fixture } from './fixture.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
function setup({ enabled = true, cloud = true } = {}) {
  const f = fixture({ enabled });
  const config = defineEconomy({ ...f.config,
    products: { pack_small: { currencyAmount: 60 }, pack_old: { currencyAmount: 10 } } });
  let persisted = createEconomyState(config), saveFailure = null, consumeFailure = false, lockEnabled = true;
  const pending = [], calls = [];
  const storage = {
    purchaseCloud: cloud,
    async load() { calls.push('load'); return structuredClone(persisted); },
    async save(state) {
      calls.push('save');
      if (saveFailure === 'offline') throw new Error('cloud offline');
      persisted = structuredClone(state);
      if (saveFailure === 'ambiguous') throw new Error('cloud ack lost');
      return true;
    },
  };
  let serial = 0;
  const purchases = {
    async getCatalog() { calls.push('catalog'); return [{ id: 'pack_small', title: 'Gems', price: '15 Yans',
      priceValue: '15', priceCurrencyCode: 'YAN', priceCurrencyImage: 'sdk://icon' }]; },
    async purchase(sku) { calls.push(`purchase:${sku}`); const receipt = { productID: sku, purchaseToken: `secret-${++serial}` };
      pending.push(receipt); return receipt; },
    async getPurchases() { calls.push('getPurchases'); return pending.map(item => ({ ...item })); },
    async consumePurchase(token) { calls.push(`consume:${token}`); if (consumeFailure) throw new Error('consume error');
      const index = pending.findIndex(item => item.purchaseToken === token);
      if (index !== -1) pending.splice(index, 1);
    },
    async runExclusive(task) { calls.push('lock'); if (!lockEnabled) throw new Error('another tab'); return task(); },
  };
  const manifest = definePremiumManifest(f.rawManifest, { graph: f.graph, economyConfig: config });
  const makeRuntime = (options = {}) => createEconomyRuntime({ config, graph: f.graph, manifest, storage,
    purchases, activeSkus: ['pack_small'], ...options });
  const runtime = makeRuntime();
  return { config, runtime, calls, pending, purchases, storage,
    makeRuntime,
    persisted: () => persisted, setSaveFailure: value => { saveFailure = value; },
    setConsumeFailure: value => { consumeFailure = value; },
    setLockEnabled: value => { lockEnabled = value; } };
}

test('purchase lists current SDK prices only, fulfills product and consumes after persisted digest', async () => {
  const f = setup();
  await f.runtime.initialize();
  assert.deepEqual(await f.runtime.getStoreCatalog(), [{ id: 'pack_small', currencyAmount: 60, title: 'Gems',
    price: '15 Yans', priceValue: '15', priceCurrencyCode: 'YAN', priceCurrencyImage: 'sdk://icon' }]);
  const result = await f.runtime.purchaseProduct('pack_small');
  assert.equal(result.applied, true);
  assert.equal(f.persisted().balance, 60);
  assert.deepEqual(f.persisted().purchaseTokens, [digest('secret-1')]);
  assert.deepEqual(f.calls.slice(-4), ['purchase:pack_small', 'load', 'save', 'consume:secret-1']);
  assert.equal(JSON.stringify(f.persisted()).includes('secret-1'), false);
  await assert.rejects(f.runtime.purchaseProduct('pack_old'), /inactive|catalog|SKU/i);
  assert.equal(f.calls.filter(call => call === 'purchase:pack_old').length, 0);
});

test('ambiguous cloud save: no consume, restore reloads evidence and skips duplicate grant', async () => {
  const f = setup();
  await f.runtime.initialize();
  f.setSaveFailure('ambiguous');
  await assert.rejects(f.runtime.purchaseProduct('pack_small'));
  assert.equal(f.persisted().balance, 60);
  assert.equal(f.calls.some(call => call.startsWith('consume:')), false);
  f.setSaveFailure(null);
  const result = await f.runtime.restorePurchases();
  assert.equal(result.processed, 1);
  assert.equal(result.credited, 0);
  assert.equal(f.persisted().balance, 60);
  assert.equal(f.persisted().purchaseTokens.length, 1);
  assert.deepEqual(f.pending, []);
});

test('offline cloud saves never consume; failed consume restores without paying twice', async () => {
  const f = setup();
  await f.runtime.initialize();
  f.setSaveFailure('offline');
  await assert.rejects(f.runtime.purchaseProduct('pack_small'));
  assert.equal(f.persisted().balance, 0);
  assert.equal(f.calls.some(call => call.startsWith('consume:')), false);
  f.setSaveFailure(null);
  f.setConsumeFailure(true);
  await assert.rejects(f.runtime.restorePurchases());
  assert.equal(f.persisted().balance, 60);
  f.setConsumeFailure(false);
  assert.deepEqual(await f.runtime.restorePurchases(), { processed: 1, credited: 0, unknownSkus: 0 });
  assert.equal(f.persisted().balance, 60);
  assert.deepEqual(f.pending, []);
});

test('historical inactive known SKUs restore but are never shown in the store', async () => {
  const f = setup();
  f.pending.push({ productID: 'pack_old', purchaseToken: 'old-token' },
    { productID: 'unknown_sku', purchaseToken: 'unknown-token' });
  await f.runtime.initialize();
  assert.deepEqual(await f.runtime.restorePurchases(), { processed: 1, credited: 1, unknownSkus: 1 });
  assert.equal(f.persisted().balance, 10);
  assert.deepEqual(f.pending.map(x => x.productID), ['unknown_sku']);
  assert.deepEqual((await f.runtime.getStoreCatalog()).map(x => x.id), ['pack_small']);
});

test('new purchase reconciles older outstanding order before initiating another payment', async () => {
  const f = setup();
  f.pending.push({ productID: 'pack_old', purchaseToken: 'previous-session-token' });
  await f.runtime.initialize();
  await f.runtime.purchaseProduct('pack_small');
  assert.equal(f.persisted().balance, 70);
  assert.equal(f.persisted().purchaseTokens.length, 2);
  assert.equal(f.calls.indexOf('consume:previous-session-token') < f.calls.indexOf('purchase:pack_small'), true);
});

test('premium spending waits for first outstanding-purchase reconciliation when IAP is configured', async () => {
  const f = setup();
  await f.runtime.initialize();
  await assert.rejects(f.runtime.unlockChoice('fork', 'intimate'), /Restore outstanding purchases/i);
  await f.runtime.restorePurchases();
  await assert.rejects(f.runtime.unlockChoice('fork', 'intimate'), { code: 'INSUFFICIENT_FUNDS' });
});

test('two stale runtime tabs cannot overwrite a consumed purchase with a free grant or unlock', async () => {
  const f = setup();
  const other = f.makeRuntime();
  await Promise.all([f.runtime.initialize(), other.initialize()]);
  await f.runtime.purchaseProduct('pack_small');
  await other.grantStarter();
  assert.equal(f.persisted().balance, 80);
  assert.deepEqual(f.persisted().purchaseTokens, [digest('secret-1')]);
  await other.restorePurchases();
  await other.unlockChoice('fork', 'intimate');
  assert.equal(f.persisted().balance, 68);
  assert.equal(f.persisted().entitlements.includes('private_time'), true);
  assert.equal(f.persisted().purchaseTokens.length, 1);
  assert.equal(f.calls.filter(x => x === 'lock').length >= 4, true, 'every cloud mutation must lock the origin');
});

test('reward verified after another tab buys crystals commits from fresh cloud state', async () => {
  const f = setup();
  const other = f.makeRuntime({ ads: { async showRewarded() {
    await f.runtime.purchaseProduct('pack_small');
    return { shown: true, rewarded: true };
  } }, newAttemptId: () => 'ad_new' });
  await Promise.all([f.runtime.initialize(), other.initialize()]);
  await other.claimRewarded();
  assert.equal(f.persisted().balance, 65);
  assert.equal(f.persisted().purchaseTokens.length, 1);
  assert.equal(f.persisted().completedGrants.includes('rewarded:ad_new'), true);
});

test('a failed foreground reconciliation re-locks premium spending', async () => {
  const f = setup();
  await f.runtime.initialize();
  await f.runtime.restorePurchases();
  f.purchases.getPurchases = async () => { throw new Error('outage'); };
  await assert.rejects(f.runtime.restorePurchases());
  await assert.rejects(f.runtime.unlockChoice('fork', 'intimate'), /Restore outstanding purchases/i);
});

test('mismatched purchase response, malformed token and locked tab cannot credit or consume', async () => {
  const f = setup();
  await f.runtime.initialize();
  f.purchases.purchase = async () => ({ productID: 'pack_old', purchaseToken: 'secret-1' });
  await assert.rejects(f.runtime.purchaseProduct('pack_small'), /mismatch|SKU|product/i);
  f.purchases.purchase = async () => ({ productID: 'pack_small', purchaseToken: '' });
  await assert.rejects(f.runtime.purchaseProduct('pack_small'), /token|receipt/i);
  f.setLockEnabled(false);
  await assert.rejects(f.runtime.restorePurchases());
  assert.equal(f.persisted().balance, 0);
  assert.equal(f.calls.some(call => call.startsWith('consume:')), false);
});

test('no cloud wallet and economy-disabled runtime never call the Payments SDK', async () => {
  const f = fixture({ enabled: true });
  const config = defineEconomy({ ...f.config, products: { pack_small: { currencyAmount: 50 } } });
  const payments = { getCatalog() { throw new Error('must not invoke'); },
    getPurchases() { throw new Error('must not invoke'); }, runExclusive() { throw new Error('must not invoke'); } };
  const manifest = definePremiumManifest(f.rawManifest, { graph: f.graph, economyConfig: config });
  assert.throws(() => createEconomyRuntime({ config, graph: f.graph, manifest,
    storage: { load: async () => createEconomyState(config), save: async () => true },
    purchases: payments, activeSkus: ['pack_small'] }), /cloud/i);
  const disabled = defineEconomy({ ...config, enabled: false });
  const runtime = createEconomyRuntime({ config: disabled, manifest, purchases: payments });
  await runtime.initialize();
  assert.deepEqual(await runtime.getStoreCatalog(), []);
  await assert.rejects(runtime.restorePurchases(), /disabled/i);
});
