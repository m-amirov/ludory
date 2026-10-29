import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState,
  advanceNarrative, resolveNarrativeView, buildNarrativeJournal,
  validateNarrativeState,
} from '../src/index.mjs';

const localized = (ru, en) => ({ ru, en });

function fixture() {
  const catalog = defineNarrativeCatalog({ schemaVersion: 1, interactions: [
    { id: 'first_photo', type: 'photo', label: localized('Фото', 'Photo'), options: [
      { id: 'share', label: localized('Поделиться', 'Share'), assetId: 'harbor', effects: [
        { op: 'album_add', id: 'harbor' }, { op: 'relation_delta', id: 'leo', value: 2 },
      ] },
      { id: 'decline', label: localized('Не снимать', 'Decline'), effects: [] },
    ] },
    { id: 'souvenir', type: 'keepsake', label: localized('Память', 'Keepsake'), options: [
      { id: 'shell', label: localized('Ракушка', 'Shell'), effects: [{ op: 'keepsake_add', id: 'shell' }] },
      { id: 'stone', label: localized('Камень', 'Stone'), effects: [{ op: 'keepsake_add', id: 'stone' }] },
    ] },
    { id: 'letter', type: 'message', label: localized('Написать', 'Write'), variants: [
      { id: 'warm', recipient: 'leo', intent: 'invite', tone: 'warm', attachmentId: 'harbor',
        preview: localized('Жду тебя у моря. Фото прилагаю.', 'Meet at the sea. Photo attached.'),
        reply: localized('Обязательно приду.', 'I will be there.'),
        effects: [{ op: 'flag_set', id: 'invited', value: true }] },
      { id: 'plain', recipient: 'leo', intent: 'invite', tone: 'plain',
        preview: localized('Увидимся?', 'See you?'), reply: localized('Да.', 'Yes.'),
        effects: [] },
    ] },
  ] });
  const graph = defineNarrativeGraph({ schemaVersion: 1, id: 'sample', startSceneId: 'pier', scenes: [
    { id: 'pier', beats: [
      { id: 'intro', type: 'dialogue', text: localized('Вечер.', 'Evening.') },
      { id: 'take_photo', type: 'photo', interactionId: 'first_photo' },
      { id: 'choose_item', type: 'keepsake', interactionId: 'souvenir' },
      { id: 'write_letter', type: 'message', interactionId: 'letter' },
      { id: 'remember', type: 'echo', sourceEventId: 'take_photo',
        when: { album: 'harbor' }, text: localized('Он вспоминает снимок.', 'He recalls the photo.') },
      { id: 'route', type: 'choice', choices: [
        { id: 'love', label: localized('Остаться', 'Stay'), targetSceneId: 'together',
          when: { relation: { id: 'leo', gte: 2 } },
          effects: [{ op: 'route_lock', id: 'leo' }] },
        { id: 'leave', label: localized('Уехать', 'Leave'), targetSceneId: 'alone' },
      ] },
    ] },
    { id: 'together', beats: [{ id: 'end_love', type: 'ending', endingId: 'love', text: localized('Вместе.', 'Together.') }] },
    { id: 'alone', beats: [{ id: 'end_alone', type: 'ending', endingId: 'alone', text: localized('Одна.', 'Alone.') }] },
  ] });
  return { catalog, graph };
}

test('graph rejects broken edges, unreachable endings and executable predicates', () => {
  const { graph } = fixture();
  assert.equal(Object.isFrozen(graph.scenes[0].beats), true);
  assert.throws(() => defineNarrativeGraph({ ...graph, scenes: graph.scenes.map(scene =>
    scene.id === 'pier' ? { ...scene, beats: scene.beats.map(beat =>
      beat.id === 'route' ? { ...beat, choices: [{ id: 'bad', label: localized('?', '?'), targetSceneId: 'missing' }] } : beat) } : scene) }), /target/i);
  assert.throws(() => defineNarrativeGraph({ ...graph, scenes: graph.scenes.filter(scene => scene.id !== 'alone'),
  }), /target/i);
  assert.throws(() => defineNarrativeGraph({ ...graph, scenes: [
    { id: 'pier', beats: [{ id: 'end', type: 'ending', endingId: 'x', text: localized('x', 'x') }] },
    { id: 'unused', beats: [{ id: 'other', type: 'ending', endingId: 'y', text: localized('y', 'y') }] },
  ] }), /unreachable/i);
  assert.throws(() => defineNarrativeGraph({ ...graph, scenes: graph.scenes.map(scene =>
    scene.id === 'pier' ? { ...scene, beats: scene.beats.map(beat =>
      beat.id === 'route' ? { ...beat, choices: [{ ...beat.choices[0], when: { eval: 'true' } }] } : beat) } : scene) }), /predicate|operator/i);
});

test('scene progression, photo, keepsake, messages, delayed echo and route lock', () => {
  const { graph, catalog } = fixture();
  let state = createNarrativeState(graph);
  assert.equal(resolveNarrativeView(graph, catalog, state, 'ru').text, 'Вечер.');
  state = advanceNarrative(graph, catalog, state, { type: 'next' }).state;
  assert.equal(resolveNarrativeView(graph, catalog, state).type, 'photo');
  assert.throws(() => advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'invalid' }), /option/i);
  const before = structuredClone(state);
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'share' }).state;
  assert.deepEqual(before.album, []);
  assert.deepEqual(state.album, ['harbor']);
  assert.equal(state.relations.leo, 2);
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'shell' }).state;
  const view = resolveNarrativeView(graph, catalog, state, 'ru');
  assert.equal(view.type, 'message');
  assert.deepEqual(view.variants.map(v => v.id), ['warm', 'plain']);
  assert.equal(view.variants[0].preview, 'Жду тебя у моря. Фото прилагаю.');
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'warm' }).state;
  assert.equal(state.messages[0].reply.ru, 'Обязательно приду.');
  assert.equal(state.flags.invited, true);
  assert.equal(resolveNarrativeView(graph, catalog, state).type, 'echo');
  state = advanceNarrative(graph, catalog, state, { type: 'next' }).state;
  assert.deepEqual(state.completedEchoes, ['remember']);
  assert.equal(resolveNarrativeView(graph, catalog, state).type, 'choice');
  state = advanceNarrative(graph, catalog, state, { type: 'choose', optionId: 'love' }).state;
  assert.equal(state.routeLock, 'leo');
  assert.equal(state.sceneId, 'together');
  assert.equal(resolveNarrativeView(graph, catalog, state).endingId, 'love');
  assert.deepEqual(buildNarrativeJournal(graph, catalog, state, 'en').album, ['harbor']);
  assert.deepEqual(validateNarrativeState(graph, catalog, state).completedEvents, ['take_photo', 'choose_item', 'write_letter']);
});

test('declined photo blocks unavailable attachment and inaccessible love route', () => {
  const { graph, catalog } = fixture();
  let state = createNarrativeState(graph);
  state = advanceNarrative(graph, catalog, state, { type: 'next' }).state;
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'decline' }).state;
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'stone' }).state;
  assert.deepEqual(resolveNarrativeView(graph, catalog, state).variants.map(v => v.id), ['plain']);
  assert.throws(() => advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'warm' }), /unavailable|attachment/i);
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'plain' }).state;
  assert.equal(resolveNarrativeView(graph, catalog, state).type, 'choice'); // hidden echo auto-skipped
  assert.deepEqual(resolveNarrativeView(graph, catalog, state).choices.map(c => c.id), ['leave']);
  assert.throws(() => advanceNarrative(graph, catalog, state, { type: 'choose', optionId: 'love' }), /unavailable|choice/i);
  state = advanceNarrative(graph, catalog, state, { type: 'choose', optionId: 'leave' }).state;
  assert.equal(state.sceneId, 'alone');
  assert.equal(state.routeLock, null);
});

test('rejects malformed save, unknown content and double dispatch without lost state', () => {
  const { graph, catalog } = fixture();
  let state = createNarrativeState(graph);
  assert.throws(() => validateNarrativeState(graph, catalog, { ...state, sceneId: 'unknown' }), /scene/i);
  assert.throws(() => validateNarrativeState(graph, catalog, { ...state, added: true }), /unexpected|field/i);
  assert.throws(() => advanceNarrative(graph, catalog, state, { type: 'choose', optionId: '__proto__' }), /invalid ID|choice|beat/i);
  state = advanceNarrative(graph, catalog, state, { type: 'next' }).state;
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'share' }).state;
  const duplicate = advanceNarrative(graph, catalog, state, { type: 'interact', beatId: 'take_photo', optionId: 'share' });
  assert.equal(duplicate.receipt.duplicate, true);
  assert.deepEqual(duplicate.state, state);
});

test('rejects reachable dead-end cycles that can never reach an ending', () => {
  assert.throws(() => defineNarrativeGraph({ schemaVersion: 1, id: 'trap', startSceneId: 'start', scenes: [
    { id: 'start', beats: [{ id: 'start_choice', type: 'choice', choices: [
      { id: 'trap', label: localized('Ловушка', 'Trap'), targetSceneId: 'loop' },
      { id: 'exit', label: localized('Выход', 'Exit'), targetSceneId: 'end' },
    ] }] },
    { id: 'loop', beats: [{ id: 'loop_choice', type: 'choice', choices: [
      { id: 'again', label: localized('Ещё', 'Again'), targetSceneId: 'loop' },
    ] }] },
    { id: 'end', beats: [{ id: 'last', type: 'ending', endingId: 'good', text: localized('Конец', 'End') }] },
  ] }), /ending|trap|dead.end/i);
});

test('route lock filters incompatible future branches', () => {
  const graph = defineNarrativeGraph({ schemaVersion: 1, id: 'routes', startSceneId: 'start', scenes: [
    { id: 'start', beats: [{ id: 'lock_route', type: 'choice', choices: [
      { id: 'a', label: localized('А', 'A'), targetSceneId: 'cross', effects: [{ op: 'route_lock', id: 'leo' }] },
      { id: 'b', label: localized('Б', 'B'), targetSceneId: 'cross', effects: [{ op: 'route_lock', id: 'max' }] },
    ] }] },
    { id: 'cross', beats: [{ id: 'crossroads', type: 'choice', choices: [
      { id: 'a', label: localized('С Лео', 'With Leo'), targetSceneId: 'end_a', routeId: 'leo' },
      { id: 'b', label: localized('С Максом', 'With Max'), targetSceneId: 'end_b', routeId: 'max' },
    ] }] },
    { id: 'end_a', beats: [{ id: 'end_a_beat', type: 'ending', endingId: 'leo', text: localized('А', 'A') }] },
    { id: 'end_b', beats: [{ id: 'end_b_beat', type: 'ending', endingId: 'max', text: localized('Б', 'B') }] },
  ] });
  const catalog = defineNarrativeCatalog({ schemaVersion: 1, interactions: [] });
  let state = createNarrativeState(graph);
  state = advanceNarrative(graph, catalog, state, { type: 'choose', optionId: 'a' }).state;
  assert.deepEqual(resolveNarrativeView(graph, catalog, state).choices.map(c => c.id), ['a']);
  assert.throws(() => advanceNarrative(graph, catalog, state, { type: 'choose', optionId: 'b' }), /unavailable/i);
});

test('source catalogs are copied; functions, accessors and hostile object keys are rejected', () => {
  const raw = { schemaVersion: 1, interactions: [] };
  const catalog = defineNarrativeCatalog(raw);
  raw.interactions.push({ id: 'later' });
  assert.deepEqual(catalog.interactions, []);
  assert.throws(() => defineNarrativeCatalog({ schemaVersion: 1, interactions: [], extra: () => {} }), /non-JSON/i);
  const malicious = Object.create(null);
  Object.defineProperty(malicious, '__proto__', { value: 'oops', enumerable: true });
  assert.throws(() => defineNarrativeCatalog(malicious), /unsafe key/i);
  const getters = { schemaVersion: 1 };
  Object.defineProperty(getters, 'interactions', { enumerable: true, get() { throw new Error('must not invoke'); } });
  assert.throws(() => defineNarrativeCatalog(getters), /accessor/i);
});

test('revisiting a completed interaction automatically skips it without duplicating rewards', () => {
  const catalog = defineNarrativeCatalog({ schemaVersion: 1, interactions: [{
    id: 'pic', type: 'photo', label: localized('Снимок', 'Photo'), options: [{
      id: 'yes', label: localized('Да', 'Yes'), effects: [{ op: 'relation_delta', id: 'leo', value: 1 }],
    }],
  }] });
  const graph = defineNarrativeGraph({ schemaVersion: 1, id: 'loop_game', startSceneId: 'start', scenes: [
    { id: 'start', beats: [
      { id: 'photo_once', type: 'photo', interactionId: 'pic' },
      { id: 'again_or_end', type: 'choice', choices: [
        { id: 'again', label: localized('Снова', 'Again'), targetSceneId: 'start' },
        { id: 'finish', label: localized('Конец', 'Finish'), targetSceneId: 'end' },
      ] },
    ] },
    { id: 'end', beats: [{ id: 'last', type: 'ending', endingId: 'done', text: localized('Готово', 'Done') }] },
  ] });
  let state = createNarrativeState(graph);
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'yes' }).state;
  const stale = advanceNarrative(graph, catalog, state, { type: 'interact', beatId: 'photo_once', optionId: 'yes' });
  assert.equal(stale.receipt.duplicate, true);
  state = advanceNarrative(graph, catalog, state, { type: 'choose', optionId: 'again' }).state;
  assert.equal(resolveNarrativeView(graph, catalog, state).type, 'choice');
  state = advanceNarrative(graph, catalog, state, { type: 'choose', optionId: 'finish' }).state;
  assert.equal(state.relations.leo, 1);
  assert.equal(state.sceneId, 'end');
});

test('saved state cannot claim earned memory, switch a route or jump to a future ending', () => {
  const catalog = defineNarrativeCatalog({ schemaVersion: 1, interactions: [{
    id: 'photo', type: 'photo', label: localized('Снимок', 'Photo'), options: [{
      id: 'take', label: localized('Снять', 'Take'), effects: [{ op: 'memory_add', id: 'secret' }],
    }],
  }] });
  const graph = defineNarrativeGraph({ schemaVersion: 1, id: 'save_game', startSceneId: 'start', scenes: [
    { id: 'start', beats: [
      { id: 'snap', type: 'photo', interactionId: 'photo' },
      { id: 'branch', type: 'choice', choices: [
        { id: 'route_a', label: localized('А', 'A'), targetSceneId: 'cross', effects: [{ op: 'route_lock', id: 'a' }] },
        { id: 'route_b', label: localized('Б', 'B'), targetSceneId: 'cross', effects: [{ op: 'route_lock', id: 'b' }] },
      ] },
    ] },
    { id: 'cross', beats: [{ id: 'crossroads', type: 'choice', choices: [
      { id: 'a', label: localized('А', 'A'), routeId: 'a', targetSceneId: 'end_a' },
      { id: 'b', label: localized('Б', 'B'), routeId: 'b', targetSceneId: 'end_b' },
    ] }] },
    { id: 'end_a', beats: [{ id: 'a_end', type: 'ending', endingId: 'a', text: localized('А', 'A') }] },
    { id: 'end_b', beats: [{ id: 'b_end', type: 'ending', endingId: 'b', text: localized('Б', 'B') }] },
  ] });
  const initial = createNarrativeState(graph);
  assert.throws(() => validateNarrativeState(graph, catalog, { ...initial, memories: ['secret'] }), /provenance|history|state|inconsistent/i);
  let state = advanceNarrative(graph, catalog, initial, { type: 'interact', optionId: 'take' }).state;
  state = advanceNarrative(graph, catalog, state, { type: 'choose', optionId: 'route_a' }).state;
  assert.throws(() => validateNarrativeState(graph, catalog, { ...state, routeLock: 'b' }), /provenance|history|state|inconsistent/i);
  assert.throws(() => validateNarrativeState(graph, catalog, { ...initial, sceneId: 'end_b', visitedScenes: ['start','end_b'] }), /provenance|history|state|inconsistent/i);
});

test('echo cannot precede its source within a single scene', () => {
  assert.throws(() => defineNarrativeGraph({ schemaVersion: 1, id: 'wrong_echo', startSceneId: 'start', scenes: [{
    id: 'start', beats: [
      { id: 'early_echo', type: 'echo', sourceEventId: 'late_photo', text: localized('Поздно', 'Too early') },
      { id: 'late_photo', type: 'photo', interactionId: 'some_photo' },
      { id: 'finish', type: 'ending', endingId: 'end', text: localized('Конец', 'End') },
    ],
  }] }), /echo|source|order/i);
});

test('strict echo coverage checker finds interactions with no delayed payoff', async () => {
  const { validateNarrativeEchoCoverage } = await import('../src/index.mjs');
  const { graph } = fixture();
  assert.throws(() => validateNarrativeEchoCoverage(graph), /echo|coverage|choose_item|write_letter/i);
});
