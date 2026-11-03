import test from 'node:test';
import assert from 'node:assert/strict';
import { defineEconomy, createEconomyState, applyEconomyOperation } from '../src/index.mjs';

const config = (overrides = {}) => defineEconomy({
  schemaVersion: 1, enabled: true, gameId: 'future-novel', configVersion: 1,
  currency: { id: 'crystals', displayName: 'Кристаллы', icon: '💎' },
  maxBalance: 100,
  rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 },
  premium: {}, products: {}, ...overrides,
});

test('starter grant is idempotent and does not mutate its input', () => {
  const settings = config();
  const initial = createEconomyState(settings);
  const first = applyEconomyOperation(settings, initial, { type: 'GRANT_STARTER' });
  assert.deepEqual(initial, createEconomyState(settings));
  assert.deepEqual(first.receipt, { operationId: 'starter:future-novel', type: 'GRANT_STARTER', applied: true, delta: 20, balance: 20 });
  assert.equal(first.state.balance, 20);
  assert.equal(first.state.revision, 1);
  assert.deepEqual(first.state.completedGrants, ['starter:future-novel']);
  assert.deepEqual(first.state.journal, [{ operationId: 'starter:future-novel', type: 'GRANT_STARTER', delta: 20, contentId: null, sku: null }]);
  const repeated = applyEconomyOperation(settings, first.state, { type: 'GRANT_STARTER' });
  assert.deepEqual(repeated.receipt, { operationId: 'starter:future-novel', type: 'GRANT_STARTER', applied: false, delta: 0, balance: 20 });
  assert.deepEqual(repeated.state, first.state);
  assert.notEqual(repeated.state, first.state);
});

test('episode and rewarded events each grant exactly once per source id', () => {
  const settings = config();
  let state = createEconomyState(settings);
  const operations = [
    { type: 'GRANT_EPISODE', episodeId: 'ep01' },
    { type: 'GRANT_EPISODE', episodeId: 'ep01' },
    { type: 'GRANT_EPISODE', episodeId: 'ep02' },
    { type: 'GRANT_REWARDED', attemptId: 'ad-01' },
    { type: 'GRANT_REWARDED', attemptId: 'ad-01' },
    { type: 'GRANT_REWARDED', attemptId: 'ad-02' },
  ];
  const applied = [];
  for (const op of operations) {
    const result = applyEconomyOperation(settings, state, op);
    applied.push(result.receipt.applied);
    state = result.state;
  }
  assert.deepEqual(applied, [true, false, true, true, false, true]);
  assert.equal(state.balance, 16);
  assert.equal(state.journal.length, 4);
  assert.equal(state.revision, 4);
});

test('episode identifiers conforming to Narrative grammar can receive a grant', () => {
  const settings = config();
  const result = applyEconomyOperation(settings, createEconomyState(settings), {
    type: 'GRANT_EPISODE', episodeId: 'episode_01',
  });
  assert.equal(result.receipt.operationId, 'episode:episode_01');
  assert.equal(result.state.balance, 3);
});

test('daily claim checks a real UTC date, disallows older days and repeats are no-ops', () => {
  const settings = config();
  const initial = createEconomyState(settings);
  const first = applyEconomyOperation(settings, initial, { type: 'GRANT_DAILY', date: '2026-11-03' });
  assert.equal(first.state.lastDailyClaim, '2026-11-03');
  assert.equal(applyEconomyOperation(settings, first.state, { type: 'GRANT_DAILY', date: '2026-11-03' }).receipt.applied, false);
  assert.throws(() => applyEconomyOperation(settings, first.state, { type: 'GRANT_DAILY', date: '2026-11-02' }), { code: 'STALE_DAILY_CLAIM' });
  const second = applyEconomyOperation(settings, first.state, { type: 'GRANT_DAILY', date: '2026-11-04' });
  assert.throws(() => applyEconomyOperation(settings, second.state, { type: 'GRANT_DAILY', date: '2026-11-03' }),
    { code: 'STALE_DAILY_CLAIM' }, 'a previously claimed day is still a clock rollback after a newer day');
  assert.equal(second.state.balance, 4);
  assert.throws(() => applyEconomyOperation(settings, first.state, { type: 'GRANT_DAILY', date: '2026-02-30' }));
});

test('disabled config and malformed or inflated operations cannot grant currency', () => {
  const enabled = config();
  const initial = createEconomyState(enabled);
  assert.throws(() => applyEconomyOperation(config({ enabled: false }), initial, { type: 'GRANT_STARTER' }), { code: 'DISABLED' });
  for (const op of [
    { type: 'GRANT_STARTER', amount: 1000 },
    { type: 'GRANT_EPISODE', episodeId: 'BAD' },
    { type: 'GRANT_REWARDED', attemptId: '' },
    { type: 'GRANT_DAILY', date: '2026-1-1' },
    { type: 'GRANT_MAGIC' },
  ]) assert.throws(() => applyEconomyOperation(enabled, initial, op), { code: 'INVALID_OPERATION' });
  assert.deepEqual(initial, createEconomyState(enabled));
});

test('overflow rejects atomically, zero grant remains marked completed', () => {
  const nearCap = config({ maxBalance: 20 });
  const initial = createEconomyState(nearCap);
  const first = applyEconomyOperation(nearCap, initial, { type: 'GRANT_STARTER' });
  assert.throws(() => applyEconomyOperation(nearCap, first.state, { type: 'GRANT_EPISODE', episodeId: 'ep01' }), { code: 'BALANCE_OVERFLOW' });
  assert.equal(first.state.journal.length, 1);
  const zero = config({ rewards: { starter: 0, episode: 3, daily: 2, rewarded: 5 } });
  const result = applyEconomyOperation(zero, createEconomyState(zero), { type: 'GRANT_STARTER' });
  assert.equal(result.receipt.applied, true);
  assert.equal(result.state.balance, 0);
  assert.equal(result.state.journal.length, 1);
  assert.equal(applyEconomyOperation(zero, result.state, { type: 'GRANT_STARTER' }).receipt.applied, false);
});
