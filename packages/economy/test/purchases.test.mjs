import test from 'node:test';
import assert from 'node:assert/strict';
import { defineEconomy, createEconomyState, applyEconomyOperation } from '../src/index.mjs';

const config = defineEconomy({
  schemaVersion: 1, enabled: true, gameId: 'romance', configVersion: 1,
  currency: { id: 'crystals', displayName: 'Crystals', icon: '💎' },
  maxBalance: 100, rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 }, premium: {},
  products: { 'crystals-50': { currencyAmount: 50 }, 'crystals-20': { currencyAmount: 20 } },
});
const token = 'a'.repeat(64);
const secondToken = 'b'.repeat(64);

test('verified purchase evidence digest grants configured amount once', () => {
  const initial = createEconomyState(config);
  const purchased = applyEconomyOperation(config, initial, { type: 'GRANT_PURCHASE', sku: 'crystals-50', tokenDigest: token });
  assert.deepEqual(purchased.receipt, { operationId: `purchase:${token}`, type: 'GRANT_PURCHASE', applied: true, delta: 50, balance: 50 });
  assert.deepEqual(purchased.state.purchaseTokens, [token]);
  assert.deepEqual(purchased.state.journal, [{ operationId: `purchase:${token}`, type: 'GRANT_PURCHASE', delta: 50, sku: 'crystals-50', contentId: null }]);
  const repeat = applyEconomyOperation(config, purchased.state, { type: 'GRANT_PURCHASE', sku: 'crystals-50', tokenDigest: token });
  assert.equal(repeat.receipt.applied, false);
  assert.equal(repeat.state.balance, 50);
  assert.throws(() => applyEconomyOperation(config, purchased.state, { type: 'GRANT_PURCHASE', sku: 'crystals-20', tokenDigest: token }), { code: 'INVALID_OPERATION' });
  assert.equal(initial.balance, 0);
});

test('unknown SKU, malformed evidence and arbitrary amounts never grant', () => {
  const initial = createEconomyState(config);
  const invalid = [
    { type: 'GRANT_PURCHASE', sku: 'unknown', tokenDigest: token },
    { type: 'GRANT_PURCHASE', sku: 'crystals-50', tokenDigest: 'invalid' },
    { type: 'GRANT_PURCHASE', sku: 'crystals-50', tokenDigest: token.toUpperCase() },
    { type: 'GRANT_PURCHASE', sku: 'crystals-50', tokenDigest: token, amount: 1000 },
    { type: 'GRANT_PURCHASE', sku: 'crystals-50', rawToken: 'secret', tokenDigest: token },
  ];
  for (const op of invalid) assert.throws(() => applyEconomyOperation(config, initial, op), { code: 'INVALID_OPERATION' });
  assert.equal(initial.journal.length, 0);
});

test('purchase overflow is atomic and different digests can credit separately', () => {
  const first = applyEconomyOperation(config, createEconomyState(config), { type: 'GRANT_PURCHASE', sku: 'crystals-50', tokenDigest: token });
  const second = applyEconomyOperation(config, first.state, { type: 'GRANT_PURCHASE', sku: 'crystals-50', tokenDigest: secondToken });
  assert.equal(second.state.balance, 100);
  const third = 'c'.repeat(64);
  assert.throws(() => applyEconomyOperation(config, second.state, { type: 'GRANT_PURCHASE', sku: 'crystals-20', tokenDigest: third }), { code: 'BALANCE_OVERFLOW' });
  assert.equal(second.state.purchaseTokens.length, 2);
});
