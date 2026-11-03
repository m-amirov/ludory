import test from 'node:test';
import assert from 'node:assert/strict';
import { defineEconomy, createEconomyState, applyEconomyOperation, getPremiumAccess, getEconomyView } from '../src/index.mjs';

const config = defineEconomy({
  schemaVersion: 1, enabled: true, gameId: 'romance', configVersion: 1,
  currency: { id: 'crystals', displayName: 'Crystals', icon: '💎' },
  maxBalance: 200, rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 },
  premium: { 'special-date': { cost: 12, type: 'scene' }, 'bonus-dialogue': { cost: 30, type: 'dialogue' } },
  products: {},
});

test('premium spend debits once and grants permanent entitlement, even across reload', () => {
  const empty = createEconomyState(config);
  assert.deepEqual(getPremiumAccess(config, empty, 'special-date'), { unlocked: false, cost: 12 });
  assert.throws(() => applyEconomyOperation(config, empty, { type: 'UNLOCK_PREMIUM', contentId: 'special-date' }), { code: 'INSUFFICIENT_FUNDS' });
  assert.equal(empty.journal.length, 0);
  const funded = applyEconomyOperation(config, empty, { type: 'GRANT_STARTER' }).state;
  const first = applyEconomyOperation(config, funded, { type: 'UNLOCK_PREMIUM', contentId: 'special-date' });
  assert.deepEqual(first.receipt, { operationId: 'premium:special-date', type: 'UNLOCK_PREMIUM', applied: true, delta: -12, balance: 8 });
  assert.deepEqual(first.state.entitlements, ['special-date']);
  assert.deepEqual(getPremiumAccess(config, first.state, 'special-date'), { unlocked: true, cost: 12 });
  assert.equal(funded.balance, 20);
  const restored = JSON.parse(JSON.stringify(first.state));
  const replay = applyEconomyOperation(config, restored, { type: 'UNLOCK_PREMIUM', contentId: 'special-date' });
  assert.equal(replay.receipt.applied, false);
  assert.equal(replay.receipt.delta, 0);
  assert.deepEqual(replay.state, first.state);
});

test('unknown premium content, caller-chosen cost and forged keys are rejected', () => {
  const initial = createEconomyState(config);
  assert.throws(() => getPremiumAccess(config, initial, 'nonexistent'), { code: 'INVALID_OPERATION' });
  assert.throws(() => applyEconomyOperation(config, initial, { type: 'UNLOCK_PREMIUM', contentId: 'nonexistent' }), { code: 'INVALID_OPERATION' });
  assert.throws(() => applyEconomyOperation(config, initial, { type: 'UNLOCK_PREMIUM', contentId: 'special-date', amount: 0 }), { code: 'INVALID_OPERATION' });
  assert.throws(() => applyEconomyOperation(config, initial, { type: 'UNLOCK_PREMIUM', contentId: 'Bad ID' }), { code: 'INVALID_OPERATION' });
});

test('economy view is detached and readonly and does not expose ledger or payment tokens', () => {
  const state = applyEconomyOperation(config, createEconomyState(config), { type: 'GRANT_STARTER' }).state;
  const view = getEconomyView(config, state);
  assert.deepEqual(view, { enabled: true, balance: 20, currency: config.currency, entitlements: [] });
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.currency));
  assert.ok(Object.isFrozen(view.entitlements));
  assert.notEqual(view.currency, config.currency);
  assert.equal(Object.hasOwn(view, 'journal'), false);
});
