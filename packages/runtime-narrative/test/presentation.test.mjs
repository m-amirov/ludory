import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/index.mjs';
import { fixture } from './fixture.mjs';

const media = {
  arrival: { kind: 'background', src: 'assets/vis-arrival.webp', alt: { ru: 'Аэропорт', en: 'Airport' } },
  alice: { kind: 'portrait', src: 'assets/vis-alice.png', alt: { ru: 'Алиса', en: 'Alice' } },
  embrace: { kind: 'cg', src: 'assets/vis-embrace.jpg', alt: { ru: 'Объятие', en: 'Embrace' } },
};

function data(beats = { intro: [{ id: 'airport', background: 'arrival', portraits: [
  { characterId: 'alice', mediaId: 'alice', slot: 'center' },
], speaker: { ru: 'Алиса', en: 'Alice' } }] }) {
  return { schemaVersion: 1, media: structuredClone(media), beats };
}

function define(raw = data()) {
  return api.defineNarrativePresentation(fixture().graph, raw);
}

test('presentation exports a validation gate and a pure resolver', () => {
  assert.equal(typeof api.defineNarrativePresentation, 'function');
  assert.equal(typeof api.resolveNarrativePresentation, 'function');
});

test('resolved beat has correct art, characters and authored speaker', () => {
  const { graph, initialState } = fixture();
  const result = api.resolveNarrativePresentation(graph, define(), initialState.narrative);
  assert.equal(result.background, 'arrival');
  assert.deepEqual(JSON.parse(JSON.stringify(result.portraits)), [{ characterId: 'alice', mediaId: 'alice', slot: 'center' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.speaker)), { ru: 'Алиса', en: 'Alice' });
});

test('conditional presentation follows narrative flags and fails closed for ambiguous matches', () => {
  const { graph, initialState } = fixture();
  const scoped = api.defineNarrativePresentation(graph, data({ intro: [
    { id: 'eric-seat', when: { flag: 's01-seat-eric' }, background: 'arrival' },
    { id: 'neutral-seat', when: { not: { flag: 's01-seat-eric' } }, neutral: { reason: 'unillustrated' } },
  ] }));
  assert.equal(api.resolveNarrativePresentation(graph, scoped, initialState.narrative).id, 'neutral-seat');
  const changed = { ...initialState.narrative, flags: { 's01-seat-eric': true } };
  assert.equal(api.resolveNarrativePresentation(graph, scoped, changed).id, 'eric-seat');
  const overlapping = api.defineNarrativePresentation(graph, data({ intro: [
    { id: 'first', background: 'arrival' }, { id: 'second', when: { flag: 's01-seat-eric' }, background: 'arrival' },
  ] }));
  assert.throws(() => api.resolveNarrativePresentation(graph, overlapping, changed), /ambig|overlap|multiple|conflict/i);
});

test('unmapped beat returns null instead of borrowing prior art', () => {
  const { graph, initialState } = fixture();
  assert.equal(api.resolveNarrativePresentation(graph, define(data({ happy_end: [
    { id: 'happy-stage', background: 'arrival' },
  ] })), initialState.narrative), null);
});

test('CG modes and neutral states are explicit', () => {
  const cg = define(data({ intro: [{ id: 'memory', cg: { mediaId: 'embrace', mode: 'replace-stage' } }] }));
  assert.deepEqual(JSON.parse(JSON.stringify(cg.beats.intro[0].cg)), { mediaId: 'embrace', mode: 'replace-stage' });
  assert.doesNotThrow(() => define(data({ intro: [{ id: 'waiting', neutral: { reason: 'author-unillustrated' } }] })));
  for (const invalid of [
    { id: 'implicit-empty' },
    { id: 'speaker-only', speaker: { ru: 'Алиса', en: 'Alice' } },
    { id: 'empty-portraits', portraits: [] },
    { id: 'unknown', neutral: {} },
    { id: 'unknown', neutral: { reason: ' ' } },
    { id: 'unknown', neutral: { reason: 'empty' }, background: 'arrival' },
    { id: 'unknown', neutral: { reason: 'empty' }, portraits: [] },
  ]) assert.throws(() => define(data({ intro: [invalid] })), TypeError);
});

test('unrecognized beat and media references are rejected before mount', () => {
  assert.throws(() => define(data({ not_a_beat: [{ id: 'unused', background: 'arrival' }] })), TypeError);
  for (const variant of [
    { id: 'missing', background: 'unregistered' },
    { id: 'portrait-as-bg', background: 'alice' },
    { id: 'cg-as-portrait', portraits: [{ characterId: 'alice', mediaId: 'embrace', slot: 'center' }] },
    { id: 'bad-slot', portraits: [{ characterId: 'alice', mediaId: 'alice', slot: 'far-off' }] },
    { id: 'bad-cg-mode', cg: { mediaId: 'embrace', mode: 'auto' } },
  ]) assert.throws(() => define(data({ intro: [variant] })), TypeError, variant.id);
  assert.throws(() => define(data({ intro: [{ id: 'repeat' }, { id: 'repeat' }] })), TypeError);
});

test('image src rejects traversal and cross-origin aliases', () => {
  for (const src of [
    'https://example.invalid/a.webp', '//evil.invalid/a.webp', '/assets/a.webp',
    '../assets/a.webp', 'assets/../a.webp', 'assets/%2e%2e.webp',
    'assets\\evil.webp', 'assets/x\0.webp', 'assets/subdir/a.webp',
    'data:image/png;base64,YWJj', 'assets/a.svg', 'assets/a.webp?trick=1',
  ]) {
    const raw = data(); raw.media.arrival.src = src;
    assert.throws(() => define(raw), TypeError, `unsafe src ${JSON.stringify(src)}`);
  }
});

test('non-plain objects and accessors never run during validation', () => {
  const getter = data();
  Object.defineProperty(getter.media.arrival, 'kind', { enumerable: true, get() { throw new Error('EXECUTED'); } });
  assert.throws(() => define(getter), /accessor|plain|invalid|non-json/i);
  const polluted = JSON.parse('{"schemaVersion":1,"media":{"__proto__":{"kind":"background","src":"assets/a.webp"}},"beats":{}}');
  assert.throws(() => define(polluted), TypeError);
});

test('presentation is deep-frozen and author data is not mutated', () => {
  const raw = data();
  const before = structuredClone(raw);
  const result = define(raw);
  assert.deepEqual(raw, before);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.media));
  assert.ok(Object.isFrozen(result.media.alice));
  assert.ok(Object.isFrozen(result.beats.intro[0].portraits[0]));
});
