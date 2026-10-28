import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputQueue, RuntimeError } from '../src/index.mjs';

function keyboard(overrides = {}) {
  return {
    schemaVersion: 1, type: 'keyboard', action: 'jump', phase: 'down',
    timestamp: 10, source: 'input', key: 'Space', ...overrides,
  };
}

test('input queue accepts keyboard/pointer/touch in order and detaches original objects', () => {
  const queue = createInputQueue();
  const first = keyboard();
  const second = {
    schemaVersion: 1, type: 'pointer', action: 'aim', phase: 'move',
    timestamp: 11, source: 'renderer', pointer: { id: 0, x: 22, y: 35, button: -1 },
  };
  const third = {
    schemaVersion: 1, type: 'touch', action: 'tap', phase: 'up',
    timestamp: 12, source: 'input', pointer: { id: 2, x: -1, y: 0 },
  };
  assert.equal(queue.push(first), true);
  assert.equal(queue.push(second), true);
  assert.equal(queue.push(third), true);
  first.key = 'Changed';
  second.pointer.x = 900;
  const drained = queue.drain();
  assert.deepEqual(drained, [keyboard(), {
    ...second, pointer: { id: 0, x: 22, y: 35, button: -1 },
  }, third]);
  drained[1].pointer.y = 999;
  assert.deepEqual(queue.drain(), []);
  assert.equal(queue.size(), 0);
});

test('invalid input never enters queue, including accessors, spoofed prototypes and NaN', () => {
  const queue = createInputQueue();
  const accessor = keyboard();
  Object.defineProperty(accessor, 'action', { enumerable: true, get() { throw Error('executed getter'); } });
  for (const event of [
    keyboard({ timestamp: NaN }),
    keyboard({ unexpected: 'field' }),
    keyboard({ key: '' }),
    keyboard({ schemaVersion: 2 }),
    keyboard({ pointer: { id: 1, x: 2, y: 3 } }),
    accessor,
    Object.assign(Object.create({ inherited: true }), keyboard()),
  ]) {
    assert.throws(() => queue.push(event), TypeError);
  }
  assert.equal(queue.size(), 0);
});

test('input queue is bounded, rejects newest on overflow and preserves earlier events', () => {
  const errors = [];
  const queue = createInputQueue({ onOverflow: error => errors.push(error) });
  for (let i = 0; i < 256; i++) {
    assert.equal(queue.push(keyboard({ timestamp: i })), true);
  }
  assert.equal(queue.size(), 256);
  assert.equal(queue.push(keyboard({ timestamp: 256 })), false);
  assert.equal(queue.size(), 256);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof RuntimeError);
  assert.equal(errors[0].code, 'INPUT_QUEUE_OVERFLOW');
  const drained = queue.drain();
  assert.equal(drained.length, 256);
  assert.equal(drained[0].timestamp, 0);
  assert.equal(drained[255].timestamp, 255);
  assert.equal(queue.size(), 0);
  assert.equal(queue.push(keyboard({ timestamp: 257 })), true);
  queue.clear();
  assert.deepEqual(queue.drain(), []);
});

test('input queue rejects unsafe limits before accepting events', () => {
  for (const limit of [0, -1, 257, NaN, Infinity, 1.5, '256']) {
    assert.throws(() => createInputQueue({ limit }), TypeError);
  }
  const queue = createInputQueue({ limit: 1 });
  assert.equal(queue.push(keyboard()), true);
  assert.equal(queue.push(keyboard()), false);
  assert.equal(queue.size(), 1);
});
