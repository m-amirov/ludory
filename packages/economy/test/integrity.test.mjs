import test from 'node:test';
import assert from 'node:assert/strict';
import { defineEconomy, createEconomyState, applyEconomyOperation, validateEconomyState, getEconomyView } from '../src/index.mjs';

const config = defineEconomy({
  schemaVersion: 1, enabled: true, gameId: 'romance', configVersion: 1,
  currency: { id: 'crystals', displayName: 'Crystals', icon: '💎' },
  maxBalance: 100, rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 },
  premium: { 'extra-date': { cost: 12, type: 'scene' } },
  products: { 'crystals-50': { currencyAmount: 50 } },
});
const digest = 'b'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));

function history() {
  let state = createEconomyState(config);
  for (const operation of [
    { type: 'GRANT_STARTER' },
    { type: 'GRANT_DAILY', date: '2026-11-03' },
    { type: 'GRANT_PURCHASE', sku: 'crystals-50', tokenDigest: digest },
    { type: 'UNLOCK_PREMIUM', contentId: 'extra-date' },
  ]) state = applyEconomyOperation(config, state, operation).state;
  return state;
}

test('replay accepts pristine round trip, returns detached immutable state', () => {
  const original = history();
  const persisted = clone(original);
  const validated = validateEconomyState(config, persisted);
  assert.deepEqual(validated, original);
  assert.notEqual(validated, persisted);
  assert.notEqual(validated.journal[0], persisted.journal[0]);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated.journal));
  assert.ok(Object.isFrozen(validated.journal[0]));
  assert.throws(() => { validated.balance = 999; }, TypeError);
});

test('replay detects tampered balances, entitlements, evidence, revision and journal', () => {
  const mutations = [
    state => { state.balance++; },
    state => { state.entitlements = []; },
    state => { state.completedGrants = []; },
    state => { state.purchaseTokens = []; },
    state => { state.lastDailyClaim = null; },
    state => { state.revision++; },
    state => { state.journal[0].delta++; },
    state => { state.journal[2].sku = 'unknown-sku'; },
    state => { state.journal[3].contentId = 'unknown'; },
    state => { state.journal.splice(1, 1); },
    state => { state.journal.push(clone(state.journal[0])); state.revision++; },
    state => { [state.journal[0], state.journal[3]] = [state.journal[3], state.journal[0]]; },
    state => { state.journal[1].operationId = 'daily:2026-13-40'; },
    state => { state.gameId = 'another-game'; },
    state => { state.configVersion = 2; },
  ];
  for (const mutate of mutations) {
    const state = clone(history());
    mutate(state);
    assert.throws(() => validateEconomyState(config, state), { code: 'CORRUPT_STATE' });
    assert.throws(() => applyEconomyOperation(config, state, { type: 'GRANT_EPISODE', episodeId: 'ep01' }), { code: 'CORRUPT_STATE' });
    assert.throws(() => getEconomyView(config, state), { code: 'CORRUPT_STATE' });
  }
});

test('replay rejects negative zero in a zero-value grant journal entry', () => {
  const noStarter = defineEconomy({ ...config, rewards: { ...config.rewards, starter: 0 } });
  const state = clone(applyEconomyOperation(noStarter, createEconomyState(noStarter), { type: 'GRANT_STARTER' }).state);
  state.journal[0].delta = -0;
  assert.throws(() => validateEconomyState(noStarter, state), { code: 'CORRUPT_STATE' });
});

test('malicious shapes, accessors, cyclic records, nondata arrays and extra fields fail closed', () => {
  const mutations = [
    state => { state.newField = 1; },
    state => { Object.defineProperty(state, 'balance', { get: () => 999 }); },
    state => { state.journal[0].self = state; },
    state => { state.journal = Object.create(null); },
    state => { state.entitlements = Object.assign([], { fake: 1 }); },
    state => { state.journal[0] = Object.create({ operationId: 'starter:romance' }); },
    state => { state.purchaseTokens[0] = Symbol('fake'); },
  ];
  for (const mutate of mutations) {
    const state = clone(history());
    mutate(state);
    assert.throws(() => validateEconomyState(config, state), { code: 'CORRUPT_STATE' });
  }
});

test('capacity blocks oversized journal and invalid state without dropping purchase evidence', () => {
  const state = clone(history());
  state.journal = Array.from({ length: 2001 }, () => clone(state.journal[0]));
  assert.throws(() => validateEconomyState(config, state), { code: 'CAPACITY_EXCEEDED' });
});

test('full valid journal permits duplicate receipt but refuses a new transaction', () => {
  const zeroRewards = defineEconomy({ ...config,
    rewards: { starter: 0, episode: 0, daily: 0, rewarded: 0 },
  });
  const completedGrants = Array.from({ length: 2000 }, (_, i) => `rewarded:ad-${i}`);
  const full = {
    ...createEconomyState(zeroRewards),
    completedGrants,
    revision: 2000,
    journal: completedGrants.map(operationId => ({
      operationId, type: 'GRANT_REWARDED', delta: 0, contentId: null, sku: null,
    })),
  };
  assert.equal(validateEconomyState(zeroRewards, full).journal.length, 2000);
  const readStarted = performance.now();
  assert.equal(getEconomyView(zeroRewards, full).balance, 0);
  const readDurationMs = performance.now() - readStarted;
  assert.ok(readDurationMs < 100,
    `Wallet view replay took ${readDurationMs.toFixed(1)}ms for 2,000 entries (expected <100ms)`);
  assert.equal(applyEconomyOperation(zeroRewards, full, { type: 'GRANT_REWARDED', attemptId: 'ad-1999' }).receipt.applied, false);
  assert.throws(() => applyEconomyOperation(zeroRewards, full, { type: 'GRANT_REWARDED', attemptId: 'new' }), { code: 'CAPACITY_EXCEEDED' });
});

test('state cannot gain coins by changing active configuration or journal price', () => {
  const paid = history();
  const changed = defineEconomy({ ...config, products: { 'crystals-50': { currencyAmount: 80 } } });
  assert.throws(() => validateEconomyState(changed, paid), { code: 'CORRUPT_STATE' });
  const changedPrice = defineEconomy({ ...config, premium: { 'extra-date': { cost: 13, type: 'scene' } } });
  assert.throws(() => validateEconomyState(changedPrice, paid), { code: 'CORRUPT_STATE' });
});
