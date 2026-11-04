import test from 'node:test';
import assert from 'node:assert/strict';
import { createEconomyPanel } from '../src/index.mjs';

class Element {
  constructor(name, doc) {
    this.tagName = name.toUpperCase(); this.ownerDocument = doc;
    this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {};
    this.textContent = ''; this.disabled = false;
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'disabled') this.disabled = true; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
  click() { if (!this.disabled) return this.listeners.click?.(); }
}

function screen() {
  const doc = { createElement: tag => new Element(tag, doc) };
  const root = doc.createElement('section');
  const find = key => {
    const visit = node => node.dataset.ui === key ? node : node.children.map(visit).find(Boolean);
    return visit(root);
  };
  const text = () => {
    const visit = node => `${node.textContent} ${node.children.map(visit).join(' ')}`;
    return visit(root);
  };
  return { root, find, text };
}

function wallet({ enabled = true, ready = true, rewardedPending = false, store = [] } = {}) {
  const calls = [];
  let balance = 20;
  let dailyEligible = true;
  let starterClaimed = false;
  let fail = null;
  const api = {
    calls, failWith(error) { fail = error; },
    getView() { calls.push('view'); return { enabled, ready, balance: ready ? balance : null,
      currency: { icon: '💎', displayName: 'Кристаллы' }, pendingReward: rewardedPending }; },
    getRewardsView() { calls.push('rewardsView'); return { enabled, ready,
      pendingReward: rewardedPending, amounts: { starter: 20, episode: 3, daily: 2, rewarded: 5 },
      daily: { eligible: dailyEligible, utcDate: '2026-11-04', lastClaim: null } }; },
    async initialize() { calls.push('initialize'); if (fail) throw fail; ready = true; },
    async grantStarter() { calls.push('starter'); if (fail) throw fail; if (!starterClaimed) { starterClaimed = true; balance += 20; } },
    async claimDaily() { calls.push('daily'); if (fail) throw fail; if (dailyEligible) { dailyEligible = false; balance += 2; } },
    async claimRewarded() { calls.push('rewarded'); if (fail) throw fail; balance += 5; },
    async retryPendingReward() { calls.push('retryReward'); if (fail) throw fail; rewardedPending = false; balance += 5; },
    async getStoreCatalog() { calls.push('catalog'); if (fail) throw fail; return store; },
    async purchaseProduct(sku) { calls.push(`purchase:${sku}`); if (fail) throw fail; balance += 25; },
    async restorePurchases() { calls.push('restore'); if (fail) throw fail; },
  };
  return api;
}

test('disabled config renders no economy screen and triggers zero SDK or storage operations', () => {
  const f = screen(); const w = wallet({ enabled: false });
  const panel = createEconomyPanel({ root: f.root, wallet: w });
  panel.render();
  assert.equal(f.root.children.length, 0);
  assert.deepEqual(w.calls, ['view']);
});

test('enabled wallet shows balance, eligibility and keyboard-accessible voluntary buttons', async () => {
  const f = screen(); const w = wallet();
  const panel = createEconomyPanel({ root: f.root, wallet: w, locale: 'ru' });
  panel.render();
  assert.match(f.text(), /20.*Кристаллы|Кристаллы.*20/);
  assert.equal(f.find('economy-daily').tagName, 'BUTTON');
  assert.equal(f.find('economy-rewarded').tagName, 'BUTTON');
  assert.equal(f.find('economy-catalog'), undefined, 'store is opt-in and never auto-listed');
  assert.equal(w.calls.some(call => ['catalog','daily','rewarded'].includes(call)), false);
  await f.find('economy-daily').click();
  assert.match(f.text(), /22/);
  assert.equal(f.find('economy-daily').disabled, true);
  await f.find('economy-rewarded').click();
  assert.match(f.text(), /27/);
  assert.deepEqual(w.calls.filter(call => ['daily', 'rewarded'].includes(call)), ['daily','rewarded']);
});

test('starter currency is only granted on an explicit claim and is not granted again on rerender', async () => {
  const f = screen(); const w = wallet();
  const panel = createEconomyPanel({ root: f.root, wallet: w });
  panel.render(); panel.render();
  assert.equal(w.calls.includes('starter'), false);
  await f.find('economy-starter').click();
  assert.match(f.text(), /40/);
  assert.deepEqual(w.calls.filter(call => call === 'starter'), ['starter']);
});

test('pending rewarded grant offers explicit persistence retry instead of showing another ad', async () => {
  const f = screen(); const w = wallet({ rewardedPending: true, ready: false });
  const panel = createEconomyPanel({ root: f.root, wallet: w });
  panel.render();
  assert.equal(f.find('economy-rewarded'), undefined);
  assert.ok(f.find('economy-retry-reward'));
  await f.find('economy-retry-reward').click();
  assert.ok(w.calls.includes('retryReward'));
  assert.equal(w.calls.includes('rewarded'), false);
});

test('store is Yandex-only, fetches catalog on gesture, shows native numeric prices and never substitutes own price', async () => {
  const f = screen(); const w = wallet({ store: [{ id: 'pack_small', title: '<svg onload=alert(1)>',
    currencyAmount: 25, priceValue: '17', priceCurrencyCode: 'YAN', priceCurrencyImage: 'javascript:alert(1)' }] });
  const panel = createEconomyPanel({ root: f.root, wallet: w, target: 'yandex-games', storeEnabled: true });
  panel.render();
  assert.equal(w.calls.includes('catalog'), false);
  await f.find('economy-catalog').click();
  assert.match(f.text(), /17 YAN/);
  assert.match(f.text(), /<svg onload=alert\(1\)>/);
  assert.equal(f.find('economy-product-pack_small').tagName, 'BUTTON');
  await f.find('economy-product-pack_small').click();
  assert.ok(w.calls.includes('purchase:pack_small'));
  assert.equal(f.root.children.some(node => node.tagName === 'SCRIPT'), false);
  const v = screen(); const vk = wallet();
  createEconomyPanel({ root: v.root, wallet: vk, target: 'vk-games', storeEnabled: true }).render();
  assert.equal(v.find('economy-catalog'), undefined);
});

test('store shows only the portal currency image supplied over HTTPS and rejects non-HTTPS image schemes', async () => {
  const f = screen(); const w = wallet({ store: [{ id: 'pack', title: 'Crystals',
    currencyAmount: 25, priceValue: 11, priceCurrencyCode: 'YAN',
    priceCurrencyImage: 'https://yandex.example/portal-currency.svg' }] });
  createEconomyPanel({ root: f.root, wallet: w, target: 'yandex-games', storeEnabled: true }).render();
  await f.find('economy-catalog').click();
  const image = f.root.children[0].children.find(node => node.dataset.ui === 'economy-offer')?.children
    .find(node => node.tagName === 'IMG');
  assert.equal(image?.getAttribute('src'), 'https://yandex.example/portal-currency.svg');
  const v = screen(); const invalid = wallet({ store: [{ id: 'pack', title: 'Crystals',
    currencyAmount: 25, priceValue: 11, priceCurrencyCode: 'YAN', priceCurrencyImage: 'javascript:alert(1)' }] });
  createEconomyPanel({ root: v.root, wallet: invalid, target: 'yandex-games', storeEnabled: true }).render();
  await v.find('economy-catalog').click();
  const unauthorizedImage = v.root.children[0].children.find(node => node.dataset.ui === 'economy-offer')?.children
    .find(node => node.tagName === 'IMG');
  assert.equal(unauthorizedImage, undefined);
});

test('unavailable save and failed purchase show a recover action, not success or phantom money', async () => {
  const f = screen(); const w = wallet({ ready: false });
  createEconomyPanel({ root: f.root, wallet: w }).render();
  assert.equal(f.find('economy-daily'), undefined);
  assert.ok(f.find('economy-reload'));
  w.failWith(new Error('cloud down'));
  await f.find('economy-reload').click();
  assert.match(f.text(), /Не удалось выполнить операцию/);
  assert.doesNotMatch(f.text(), /cloud down|Успешно/, 'no raw SDK exception or misleading success');
});

test('repeated tap coalesces while operation is pending and stale controls cannot act after dispose', async () => {
  const f = screen(); const w = wallet();
  let finish;
  w.claimRewarded = async () => { w.calls.push('rewarded'); await new Promise(resolve => { finish = resolve; }); };
  const panel = createEconomyPanel({ root: f.root, wallet: w });
  panel.render();
  const first = f.find('economy-rewarded');
  const flight = first.click();
  assert.equal(first.click(), undefined);
  panel.dispose();
  finish();
  await flight;
  assert.equal(first.click(), undefined);
  assert.equal(f.root.children.length, 0);
  assert.deepEqual(w.calls.filter(call => call === 'rewarded'), ['rewarded']);
});
