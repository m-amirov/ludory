import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateStore } from '../src/index.mjs';

test('copies serializable game state on input and output', () => {
  const initial = { score: 1, quests: [{ done: false }] };
  const store = createStateStore(initial);
  initial.quests[0].done = true;
  const exposed = store.getState();
  exposed.quests[0].done = true;
  assert.deepEqual(store.getState(), { score: 1, quests: [{ done: false }] });
  assert.equal(store.getRevision(), 0);
});

test('increments revision and notifies only subscribed observers after replacement', () => {
  const store = createStateStore({ score: 0 });
  const seen = [];
  const unsubscribe = store.subscribe((value, revision) => seen.push([value.score, revision]));
  const next = { score: 2 };
  store.setState(next);
  next.score = 99;
  unsubscribe();
  store.setState({ score: 3 });

  assert.deepEqual(seen, [[2, 1]]);
  assert.equal(store.getRevision(), 2);
  assert.deepEqual(store.getState(), { score: 3 });
});

test('rejects cyclic, lossy, nonfinite and non-object state without changes', () => {
  const store = createStateStore({ valid: true });
  const cyclic = {};
  cyclic.self = cyclic;

  for (const invalid of [cyclic, { missing: undefined }, { bad: Number.NaN }, { bad: Infinity }, { bad: 10n }, { bad: new Date() }, ['array-root'], null]) {
    assert.throws(() => store.setState(invalid), /state/i);
  }
  assert.deepEqual(store.getState(), { valid: true });
  assert.equal(store.getRevision(), 0);
});

test('restores explicit revision atomically, rejecting malformed snapshots', () => {
  const store = createStateStore({ score: 1 });
  store.restore({ revision: 5, state: { score: 5 } });
  assert.equal(store.getRevision(), 5);
  assert.deepEqual(store.getState(), { score: 5 });
  for (const bad of [
    { revision: -1, state: { score: 7 } },
    { revision: 2.5, state: { score: 7 } },
    { revision: 6, state: { score: undefined } },
    null,
  ]) assert.throws(() => store.restore(bad), /snapshot|revision|state/i);
  assert.equal(store.getRevision(), 5);
  assert.deepEqual(store.getState(), { score: 5 });
});
