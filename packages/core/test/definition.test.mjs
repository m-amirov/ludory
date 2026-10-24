import test from 'node:test';
import assert from 'node:assert/strict';
import { defineGame } from '../src/index.mjs';

const valid = () => ({
  schemaVersion: 1,
  id: 'sky-routes',
  version: '0.1.0',
  title: { ru: 'Небесные маршруты', en: 'Sky Routes' },
  engine: 'phaser',
  targets: ['yandex-games', 'vk-games'],
});

test('defines a frozen independent game shared across platform targets', () => {
  const input = valid();
  const game = defineGame(input);
  input.title.en = 'Changed';
  input.targets.push('other');

  assert.deepEqual(game, valid());
  assert.equal(Object.isFrozen(game), true);
  assert.equal(Object.isFrozen(game.title), true);
  assert.equal(Object.isFrozen(game.targets), true);
  assert.throws(() => game.targets.push('another'), TypeError);
});

test('rejects invalid project identifiers, versions and labels', () => {
  assert.throws(() => defineGame({ ...valid(), schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => defineGame({ ...valid(), id: '../game' }), /id/);
  assert.throws(() => defineGame({ ...valid(), version: 'latest' }), /version/);
  assert.throws(() => defineGame({ ...valid(), version: '1.0.0-01' }), /version/);
  assert.throws(() => defineGame({ ...valid(), title: { en: '  ' } }), /title/);
  assert.throws(() => defineGame({ ...valid(), engine: '' }), /engine/);
  assert.throws(() => defineGame(null), /definition/);
});

test('requires distinct, non-empty but extensible platform identifiers', () => {
  assert.throws(() => defineGame({ ...valid(), targets: [] }), /targets/);
  assert.throws(() => defineGame({ ...valid(), targets: ['vk-games', 'vk-games'] }), /duplicate/i);
  assert.throws(() => defineGame({ ...valid(), targets: ['invalid target'] }), /targets/);
  assert.deepEqual(defineGame({ ...valid(), targets: ['web', 'future-console'] }).targets, ['web', 'future-console']);
});
