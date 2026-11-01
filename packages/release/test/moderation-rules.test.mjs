import test from 'node:test';
import assert from 'node:assert/strict';
import { getModerationRulePack } from '../src/moderation-rules.mjs';

test('Yandex and VK rule packs keep local SDK checks and official policy trust separate', () => {
  const yandex = getModerationRulePack('yandex-games');
  const vk = getModerationRulePack('vk-games');
  assert.equal(yandex.revision, '2026-11-01-p3a');
  assert.equal(vk.revision, '2026-11-01-p3a');
  assert.equal(yandex.target, 'yandex-games');
  assert.equal(vk.target, 'vk-games');
  assert.ok(yandex.sources.some(source => source.verified && source.url.includes('yandex.ru')));
  assert.ok(vk.sources.some(source => !source.verified && source.url.includes('dev.vk.com')));
  assert.ok(yandex.rules.some(rule => rule.id === 'sdk-contract'));
  assert.ok(!yandex.rules.some(rule => rule.id === 'bridge-contract'));
  assert.ok(vk.rules.some(rule => rule.id === 'bridge-contract'));
  assert.ok(!vk.rules.some(rule => rule.id === 'sdk-contract'));
  assert.equal(new Set(yandex.rules.map(rule => rule.id)).size, yandex.rules.length);
  assert.equal(new Set(vk.rules.map(rule => rule.id)).size, vk.rules.length);
  assert.ok(yandex.rules.every(rule => rule.required && ['P0', 'P1', 'P2'].includes(rule.severity)));
});

test('rule packs cannot be mutated across QA runs', () => {
  const yandex = getModerationRulePack('yandex-games');
  assert.ok(Object.isFrozen(yandex));
  assert.ok(Object.isFrozen(yandex.rules));
  assert.ok(Object.isFrozen(yandex.rules[0]));
  assert.throws(() => yandex.rules.push({ id: 'fake-pass' }), TypeError);
  assert.throws(() => { yandex.sources[0].verified = false; }, TypeError);
  assert.ok(getModerationRulePack('yandex-games').sources[0].verified);
});

test('unknown targets fail instead of inheriting another platform rulebook', () => {
  for (const invalid of [undefined, null, '', 'vk', 'yandex', 'other', '__proto__']) {
    assert.throws(() => getModerationRulePack(invalid), error => error.code === 'QA_TARGET_INVALID');
  }
});
