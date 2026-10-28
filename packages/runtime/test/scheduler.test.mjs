import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameScheduler } from '../src/scheduler.mjs';

function clock() {
  let time = 10;
  let nextHandle = 0;
  const active = new Map();
  const all = new Map();
  const canceled = [];
  return {
    now: () => time,
    setTime: value => { time = value; },
    requestFrame(callback) {
      const handle = ++nextHandle;
      active.set(handle, callback);
      all.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) { canceled.push(handle); active.delete(handle); },
    step() {
      assert.equal(active.size, 1, 'exactly one pending frame');
      const [[handle, callback]] = active;
      active.delete(handle);
      callback();
      return handle;
    },
    late(handle) { all.get(handle)(); },
    get pending() { return active.size; },
    canceled,
  };
}

test('scheduler emits first and resumed ticks with zero delta, then bounded monotonic deltas', () => {
  const env = clock();
  const deltas = [];
  const failures = [];
  const scheduler = createFrameScheduler({ ...env, onFrame: delta => deltas.push(delta), onError: error => failures.push(error) });
  scheduler.start();
  assert.equal(env.pending, 1);
  env.setTime(45);
  env.step();
  env.setTime(61);
  env.step();
  env.setTime(5_000);
  env.step();
  env.setTime(4_999);
  env.step();
  scheduler.stop();
  assert.equal(env.pending, 0);
  scheduler.start();
  env.setTime(9_000);
  env.step();
  assert.deepEqual(deltas, [0, 16, 100, 0, 0]);
  assert.deepEqual(failures, []);
});

test('scheduler invalidates canceled callbacks even when an environment delivers them late', () => {
  const env = clock();
  const deltas = [];
  const scheduler = createFrameScheduler({ ...env, onFrame: delta => deltas.push(delta), onError: () => {} });
  scheduler.start();
  const oldHandle = 1;
  scheduler.stop();
  scheduler.start();
  env.late(oldHandle);
  assert.equal(env.pending, 1);
  env.step();
  assert.deepEqual(deltas, [0]);
  assert.deepEqual(env.canceled, [oldHandle]);
});

test('scheduler stops and reports frame and clock failures exactly once', () => {
  for (const trigger of ['update', 'clock']) {
    const env = clock();
    const cause = new Error(trigger);
    const errors = [];
    const scheduler = createFrameScheduler({
      ...env,
      now: trigger === 'clock' ? () => { throw cause; } : env.now,
      onFrame: () => { if (trigger === 'update') throw cause; },
      onError: error => errors.push(error),
    });
    scheduler.start();
    env.step();
    assert.deepEqual(errors, [cause]);
    assert.equal(env.pending, 0);
    scheduler.stop();
  }
});
