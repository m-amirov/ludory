import test from 'node:test';
import assert from 'node:assert/strict';
import { defineGame, createGameSession } from '../src/index.mjs';

const definition = defineGame({
  schemaVersion: 1,
  id: 'sky-routes',
  version: '0.1.0',
  title: { ru: 'Небесные маршруты' },
  engine: 'phaser',
  targets: ['yandex-games', 'vk-games'],
});

test('starts, pauses, resumes and stops in valid order', () => {
  const session = createGameSession({ definition });
  assert.equal(session.getStatus(), 'idle');
  session.initialize();
  assert.equal(session.getStatus(), 'ready');
  session.start();
  session.pause();
  assert.equal(session.getStatus(), 'paused');
  session.resume();
  assert.equal(session.getStatus(), 'running');
  session.stop();
  assert.equal(session.getStatus(), 'stopped');
  assert.throws(() => session.start(), /transition/i);
});

test('forbids illegal lifecycle changes and updates outside running state', () => {
  let calls = 0;
  const session = createGameSession({ definition, onUpdate: () => calls++ });
  assert.throws(() => session.start(), /transition/i);
  assert.throws(() => session.tick(16), /running/i);
  session.initialize();
  assert.throws(() => session.pause(), /transition/i);
  session.start();
  session.tick(16);
  for (const delta of [-1, Number.NaN, Infinity, '16']) assert.throws(() => session.tick(delta), /deltaMs/);
  session.pause();
  assert.throws(() => session.tick(16), /running/i);
  assert.equal(calls, 1);
});

test('tick receives state copy and can replace state without SDK dependencies', () => {
  const session = createGameSession({
    definition,
    initialState: { score: 0 },
    onUpdate: ({ deltaMs, state, setState }) => setState({ score: state.score + deltaMs }),
  });
  session.initialize();
  session.start();
  session.tick(20);
  assert.deepEqual(session.getState(), { score: 20 });
  assert.deepEqual(session.snapshot(), {
    schemaVersion: 1,
    gameId: 'sky-routes',
    gameVersion: '0.1.0',
    revision: 1,
    state: { score: 20 },
  });
});

test('loads same-game snapshots before start and rejects cross-game or malformed input', () => {
  const session = createGameSession({ definition, initialState: { score: 1 } });
  session.initialize();
  const accepted = { schemaVersion: 1, gameId: 'sky-routes', gameVersion: '0.1.0', revision: 7, state: { score: 77 } };
  session.restore(accepted);
  accepted.state.score = 999;
  assert.equal(session.snapshot().state.score, 77);
  for (const wrong of [
    { ...accepted, gameId: 'another-game' },
    { ...accepted, gameVersion: '1.0.0' },
    { ...accepted, schemaVersion: 2 },
    { ...accepted, revision: -2 },
    { ...accepted, state: { score: undefined } },
  ]) assert.throws(() => session.restore(wrong), /snapshot|revision|state/i);
  assert.equal(session.snapshot().state.score, 77);
  assert.equal(session.snapshot().revision, 7);
  session.start();
  assert.throws(() => session.restore(accepted), /restore/i);
});
