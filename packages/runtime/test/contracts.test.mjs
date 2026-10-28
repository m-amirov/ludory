import test from 'node:test';
import assert from 'node:assert/strict';
import { defineGame, createGameSession } from '@ludory/core';
import {
  RUNTIME_ERROR_CODES,
  RuntimeError,
  validatePersistedRecordShape,
  validateRuntimeInputEvent,
  validateViewport,
} from '../src/index.mjs';

const definition = defineGame({
  schemaVersion: 1,
  id: 'runtime-contracts',
  version: '1.2.3',
  title: { en: 'Runtime contracts' },
  engine: 'web',
  targets: ['yandex-games', 'vk-games'],
});

function snapshot() {
  const session = createGameSession({ definition, initialState: { score: 3 } });
  session.initialize();
  session.start();
  session.tick(16);
  return session.snapshot();
}

function record(overrides = {}) {
  return {
    formatVersion: 1,
    savedAt: '2026-10-28T12:00:00.000Z',
    snapshot: snapshot(),
    snapshotSha256: 'a'.repeat(64),
    ...overrides,
  };
}

function assertTypeError(callback) {
  assert.throws(callback, error => error instanceof TypeError);
}

const keyboardDown = {
  schemaVersion: 1,
  type: 'keyboard',
  action: 'jump',
  phase: 'down',
  timestamp: 12,
  source: 'input',
  key: 'Space',
};

const pointerMove = {
  schemaVersion: 1,
  type: 'pointer',
  action: 'aim',
  phase: 'move',
  timestamp: 13,
  source: 'renderer',
  pointer: { id: 1, x: 10.5, y: -2, button: 0 },
};

test('validates and detaches keyboard, pointer and touch input v1 events', () => {
  const keyboard = validateRuntimeInputEvent(keyboardDown);
  const pointer = validateRuntimeInputEvent(pointerMove);
  const touch = validateRuntimeInputEvent({
    schemaVersion: 1, type: 'touch', action: 'tap', phase: 'up', timestamp: 14,
    source: 'input', pointer: { id: 2, x: 4, y: 5 },
  });

  assert.deepEqual(keyboard, keyboardDown);
  assert.deepEqual(pointer, pointerMove);
  assert.deepEqual(touch.pointer, { id: 2, x: 4, y: 5 });
  assert.notStrictEqual(pointer, pointerMove);
  assert.notStrictEqual(pointer.pointer, pointerMove.pointer);
  pointer.pointer.x = 99;
  assert.equal(pointerMove.pointer.x, 10.5);
});

test('keeps optional input payloads optional and accepts documented event phases', () => {
  const { key: ignoredKey, ...keyboardWithoutKey } = keyboardDown;
  const { pointer: ignoredPointer, ...pointerWithoutCoordinates } = pointerMove;
  assert.deepEqual(validateRuntimeInputEvent(keyboardWithoutKey), keyboardWithoutKey);
  assert.deepEqual(validateRuntimeInputEvent(pointerWithoutCoordinates), pointerWithoutCoordinates);
  assert.deepEqual(validateRuntimeInputEvent({ ...keyboardWithoutKey, phase: 'cancel' }), {
    ...keyboardWithoutKey, phase: 'cancel',
  });
  assert.deepEqual(validateRuntimeInputEvent({ ...keyboardWithoutKey, phase: 'move' }), {
    ...keyboardWithoutKey, phase: 'move',
  });
  assert.deepEqual(validateRuntimeInputEvent({
    ...pointerMove, pointer: { id: 1, x: 10, y: 20, button: -1 },
  }).pointer, { id: 1, x: 10, y: 20, button: -1 });
});

test('copies keyboard own-data descriptors without invoking proxy get traps', () => {
  const event = new Proxy(keyboardDown, {
    get(target, property, receiver) {
      if (property === 'key') throw new Error('unsafe direct property read');
      return Reflect.get(target, property, receiver);
    },
  });
  assert.deepEqual(validateRuntimeInputEvent(event), keyboardDown);
});

test('never silently drops optional payloads with changing proxy descriptors', () => {
  for (const [input, optionalField] of [
    [keyboardDown, 'key'],
    [pointerMove, 'pointer'],
  ]) {
    let reads = 0;
    const event = new Proxy(input, {
      getOwnPropertyDescriptor(target, field) {
        if (field === optionalField && ++reads > 1) return undefined;
        return Reflect.getOwnPropertyDescriptor(target, field);
      },
    });
    assertTypeError(() => validateRuntimeInputEvent(event));
    assert.equal(reads, 2);
  }
});

test('rejects missing, extra, accessor and inherited input fields', () => {
  assertTypeError(() => validateRuntimeInputEvent({ ...keyboardDown, key: undefined }));
  assertTypeError(() => validateRuntimeInputEvent({ ...pointerMove, pointer: undefined }));
  assertTypeError(() => validateRuntimeInputEvent({ ...keyboardDown, pointer: { id: 1, x: 0, y: 0 } }));
  assertTypeError(() => validateRuntimeInputEvent({ ...pointerMove, key: 'Pointer' }));
  assertTypeError(() => validateRuntimeInputEvent({ ...keyboardDown, extra: true }));

  const accessor = { ...keyboardDown };
  delete accessor.key;
  Object.defineProperty(accessor, 'key', { enumerable: true, get: () => 'Space' });
  assertTypeError(() => validateRuntimeInputEvent(accessor));

  const inherited = Object.assign(Object.create({ extra: true }), keyboardDown);
  assertTypeError(() => validateRuntimeInputEvent(inherited));

  const symbol = { ...keyboardDown, [Symbol('unexpected')]: true };
  assertTypeError(() => validateRuntimeInputEvent(symbol));
});

test('rejects unsupported input combinations and non-finite values', () => {
  for (const bad of [
    { ...keyboardDown, type: 'keyboard', phase: 'scroll' },
    { ...keyboardDown, key: '' },
    { ...keyboardDown, timestamp: Number.NaN },
    { ...keyboardDown, timestamp: Infinity },
    { ...pointerMove, type: 'pointer', pointer: { id: -1, x: 0, y: 0 } },
    { ...pointerMove, pointer: { id: 1, x: Number.NaN, y: 0, button: 0 } },
    { ...pointerMove, pointer: { id: 1, x: 0, y: 0, button: Infinity } },
    { ...pointerMove, type: 'touch', pointer: { id: 1, x: 0, y: 0, button: 0 } },
  ]) assertTypeError(() => validateRuntimeInputEvent(bad));
});

test('validates positive finite viewport dimensions and derived orientation', () => {
  assert.deepEqual(validateViewport({ width: 1280, height: 720, dpr: 1, orientation: 'landscape' }), {
    width: 1280, height: 720, dpr: 1, orientation: 'landscape',
  });
  assert.deepEqual(validateViewport({ width: 640, height: 640, dpr: 2, orientation: 'portrait' }), {
    width: 640, height: 640, dpr: 2, orientation: 'portrait',
  });
  assert.deepEqual(validateViewport(Object.assign(Object.create(null), {
    width: 360, height: 640, dpr: 3, orientation: 'portrait',
  })), { width: 360, height: 640, dpr: 3, orientation: 'portrait' });
});

test('rejects invalid viewport fields, orientation and prototypes', () => {
  const valid = { width: 1280, height: 720, dpr: 1, orientation: 'landscape' };
  for (const bad of [
    { ...valid, width: 0 },
    { ...valid, height: -1 },
    { ...valid, dpr: Number.NaN },
    { ...valid, dpr: Infinity },
    { ...valid, orientation: 'portrait' },
    { ...valid, deviceClass: 'mobile' },
  ]) assertTypeError(() => validateViewport(bad));

  const accessor = { ...valid };
  delete accessor.width;
  Object.defineProperty(accessor, 'width', { enumerable: true, get: () => 1280 });
  assertTypeError(() => validateViewport(accessor));
  assertTypeError(() => validateViewport(Object.assign(Object.create({}), valid)));
});

test('validates a persisted record around the exact Core snapshot shape', () => {
  const input = record();
  const validated = validatePersistedRecordShape(input);
  assert.deepEqual(validated, input);
  assert.notStrictEqual(validated, input);
  assert.notStrictEqual(validated.snapshot, input.snapshot);
  assert.notStrictEqual(validated.snapshot.state, input.snapshot.state);
  validated.snapshot.state.score = 99;
  assert.equal(input.snapshot.state.score, 3);
});

test('preserves nonzero Core snapshot revision through record validation and restore', () => {
  const source = createGameSession({
    definition,
    initialState: { score: 3 },
    onUpdate: ({ state, setState }) => setState({ score: state.score + 1 }),
  });
  source.initialize();
  source.start();
  source.tick(16);
  const validated = validatePersistedRecordShape(record({ snapshot: source.snapshot() }));
  assert.equal(validated.snapshot.revision, 1);
  assert.deepEqual(validated.snapshot.state, { score: 4 });
  const target = createGameSession({ definition });
  target.initialize();
  target.restore(validated.snapshot);
  assert.deepEqual(target.snapshot(), validated.snapshot);
});

test('never silently truncates arrays whose proxy reports a changing length', () => {
  const lengths = [2, 2, 1, 1];
  let reads = 0;
  const values = new Proxy([1, 2], {
    get(target, property, receiver) {
      if (property === 'length') return lengths[reads++] ?? 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const input = record({ snapshot: { ...snapshot(), state: { values } } });
  const validated = validatePersistedRecordShape(input);
  assert.deepEqual(validated.snapshot.state.values, [1, 2]);
});

test('rejects persisted records with wrong versions, fields, dates, hashes or snapshots', () => {
  const valid = record();
  const invalid = [
    { ...valid, formatVersion: 2 },
    { ...valid, extra: true },
    { ...valid, savedAt: '2026-10-28T12:00:00+03:00' },
    { ...valid, savedAt: 'not-a-date' },
    { ...valid, snapshotSha256: 'A'.repeat(64) },
    { ...valid, snapshot: { ...valid.snapshot, revision: undefined } },
    { ...valid, snapshot: { ...valid.snapshot, revision: -1 } },
    { ...valid, snapshot: { ...valid.snapshot, schemaVersion: 2 } },
    { ...valid, snapshot: { ...valid.snapshot, gameId: 'Not Valid' } },
    { ...valid, snapshot: { ...valid.snapshot, gameVersion: '1.0.0-01' } },
    { ...valid, snapshot: { ...valid.snapshot, extra: true } },
    { ...valid, snapshot: { ...valid.snapshot, state: [] } },
    { ...valid, snapshot: { ...valid.snapshot, state: { score: Infinity } } },
    { ...valid, savedAt: '2026-02-30T12:00:00.000Z' },
  ];
  for (const bad of invalid) assertTypeError(() => validatePersistedRecordShape(bad));

  const getter = record();
  Object.defineProperty(getter.snapshot, 'revision', { enumerable: true, get: () => 1 });
  assertTypeError(() => validatePersistedRecordShape(getter));

  const cyclic = record();
  cyclic.snapshot.state.self = cyclic.snapshot.state;
  assertTypeError(() => validatePersistedRecordShape(cyclic));

  const customArrayPrototype = record();
  const values = [1];
  Object.setPrototypeOf(values, { custom: true });
  customArrayPrototype.snapshot.state = { values };
  assertTypeError(() => validatePersistedRecordShape(customArrayPrototype));
});

test('rejects numeric prerelease identifiers with leading zeros even when build metadata follows', () => {
  for (const gameVersion of ['1.0.0-01+build', '1.0.0-alpha.01+build.7']) {
    assertTypeError(() => validatePersistedRecordShape(record({
      snapshot: { ...snapshot(), gameVersion },
    })));
  }

  const valid = record({ snapshot: { ...snapshot(), gameVersion: '1.0.0-alpha.1+build.7' } });
  assert.equal(validatePersistedRecordShape(valid).snapshot.gameVersion, '1.0.0-alpha.1+build.7');
});

test('RuntimeError exposes only stable machine codes and preserves cause', () => {
  const expected = [
    'INVALID_RUNTIME_TRANSITION',
    'RUNTIME_OPERATION_IN_PROGRESS',
    'INITIALIZE_FAILED',
    'INPUT_QUEUE_OVERFLOW',
    'STORAGE_UNAVAILABLE',
    'DIGEST_UNAVAILABLE',
    'SAVE_FAILED',
    'RESTORE_FAILED',
    'RESTORE_CORRUPT',
    'RESTORE_INCOMPATIBLE',
    'AUDIO_UNAVAILABLE',
  ];
  assert.deepEqual(Object.values(RUNTIME_ERROR_CODES), expected);
  const cause = new Error('storage quota');
  const error = new RuntimeError('SAVE_FAILED', { cause });
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'RuntimeError');
  assert.equal(error.code, 'SAVE_FAILED');
  assert.equal(error.message, 'SAVE_FAILED');
  assert.equal(error.cause, cause);
  assertTypeError(() => new RuntimeError('NOT_A_RUNTIME_CODE'));
});

test('Runtime imports in Node without browser, Phaser or platform globals and exposes no host factory in R1', async () => {
  assert.equal('window' in globalThis, false);
  assert.equal('document' in globalThis, false);
  const runtime = await import('../src/index.mjs');
  const packageRuntime = await import('@ludory/runtime');
  assert.equal(packageRuntime.validateViewport, runtime.validateViewport);
  assert.equal(typeof runtime.createRuntimeHost, 'undefined');
  assert.equal(typeof runtime.createPhaserRenderer, 'undefined');
  assert.equal(typeof runtime.createYandexAdapter, 'undefined');
  assert.equal(typeof runtime.createVkAdapter, 'undefined');
});
