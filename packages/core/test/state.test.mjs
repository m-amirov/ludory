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

test('rejects hidden and symbol properties in arrays instead of losing them', () => {
  const store = createStateStore({ items: [] });
  const hidden = [1];
  Object.defineProperty(hidden, 'hidden', { value: () => {}, enumerable: false });
  const symbolic = [1];
  symbolic[Symbol('metadata')] = 10n;
  for (const value of [hidden, symbolic]) {
    assert.throws(() => store.setState({ items: value }), /state/i);
  }
  assert.deepEqual(store.getState(), { items: [] });
  assert.equal(store.getRevision(), 0);
});

test('refuses revision overflow without mutating state', () => {
  const store = createStateStore({ score: 0 });
  store.restore({ revision: Number.MAX_SAFE_INTEGER, state: { score: 5 } });
  assert.throws(() => store.setState({ score: 6 }), /revision|overflow/i);
  assert.equal(store.getRevision(), Number.MAX_SAFE_INTEGER);
  assert.deepEqual(store.getState(), { score: 5 });
});

test('delivers immutable revision events in order despite reentrant writes', () => {
  const store = createStateStore({ score: 0 });
  const seen = [];
  store.subscribe((state, revision) => {
    if (revision === 1) store.setState({ score: state.score + 1 });
  });
  store.subscribe((state, revision) => seen.push([state.score, revision]));
  store.setState({ score: 1 });
  assert.deepEqual(seen, [[1, 1], [2, 2]]);
  assert.equal(store.getRevision(), 2);
});

test('delivers to remaining subscribers when another subscriber throws', () => {
  const store = createStateStore({ score: 0 });
  const seen = [];
  store.subscribe(() => { throw new Error('subscriber failure'); });
  store.subscribe((state, revision) => seen.push([state.score, revision]));
  assert.throws(() => store.setState({ score: 1 }), /subscriber/i);
  assert.deepEqual(seen, [[1, 1]]);
  assert.equal(store.getRevision(), 1);
});

test('rejects prototype-derived restore data with no own snapshot fields', () => {
  const store = createStateStore({ score: 0 });
  assert.throws(() => store.restore(Object.create({ revision: 4, state: { score: 8 } })), /snapshot/i);
  assert.deepEqual(store.getState(), { score: 0 });
});
