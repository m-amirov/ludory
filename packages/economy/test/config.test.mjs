import test from 'node:test';
import assert from 'node:assert/strict';
import { defineEconomy, createEconomyState } from '../src/index.mjs';

const sample = () => ({
  schemaVersion: 1,
  enabled: false,
  gameId: 'future-novel',
  configVersion: 1,
  currency: { id: 'crystals', displayName: 'Кристаллы', icon: '💎' },
  maxBalance: 1000,
  rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 },
  premium: { 'extra-date': { cost: 12, type: 'scene' } },
  products: { 'crystals-50': { currencyAmount: 50 } },
});

test('config is detached and frozen while default-off wallet starts empty', () => {
  const source = sample();
  const config = defineEconomy(source);
  source.currency.displayName = 'Changed';
  assert.equal(config.currency.displayName, 'Кристаллы');
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.currency));
  assert.ok(Object.isFrozen(config.premium['extra-date']));
  const state = createEconomyState(config);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.journal));
  assert.deepEqual(state, {
    schemaVersion: 1,
    gameId: 'future-novel',
    configVersion: 1,
    balance: 0,
    entitlements: [],
    completedGrants: [],
    purchaseTokens: [],
    journal: [],
    lastDailyClaim: null,
    revision: 0,
  });
});

test('strict config rejects invalid and unexpected monetary definitions', () => {
  const examples = [
    { ...sample(), hidden: true },
    { ...sample(), schemaVersion: 2 },
    { ...sample(), rewards: { ...sample().rewards, rewarded: -1 } },
    { ...sample(), maxBalance: Number.MAX_SAFE_INTEGER + 1 },
    { ...sample(), currency: { ...sample().currency, id: 'Unsafe ID' } },
    { ...sample(), premium: { bonus: { cost: 0, type: 'scene' } } },
    { ...sample(), premium: { bonus: { cost: 10, type: 'wrong' } } },
    { ...sample(), products: { invalid: { currencyAmount: 0 } } },
  ];
  for (const config of examples) assert.throws(() => defineEconomy(config), TypeError);
});
