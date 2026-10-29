import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession } from '@ludory/core';
import { defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState,
  resolveNarrativeView, advanceNarrative, validateNarrativeState, buildNarrativeJournal } from '../src/index.mjs';

const t = (ru, en) => ({ ru, en });

function story() {
  const catalog = defineNarrativeCatalog({ schemaVersion: 1, interactions: [{
    id: 'note', type: 'message', label: t('Сообщение', 'Message'), variants: [
      { id: 'warm', recipient: 'leo', intent: 'meet', tone: 'soft',
        when: { flag: 'trusted' }, preview: t('Я скучаю.', 'I miss you.'),
        reply: t('Я тоже.', 'Me too.'), effects: [{ op: 'memory_add', id: 'love_letter' }] },
      { id: 'neutral', recipient: 'leo', intent: 'meet', tone: 'neutral',
        preview: t('Встреча?', 'Meet?'), reply: t('Хорошо.', 'Sure.'), effects: [] },
    ],
  }] });
  const graph = defineNarrativeGraph({ schemaVersion: 1, id: 'letter_scene', startSceneId: 'scene', scenes: [
    { id: 'scene', beats: [
      { id: 'trust', type: 'choice', choices: [
        { id: 'open', label: t('Довериться', 'Trust'), targetSceneId: 'trusted', effects: [{ op: 'flag_set', id: 'trusted', value: true }] },
        { id: 'shy', label: t('Промолчать', 'Stay quiet'), targetSceneId: 'trusted' },
      ] },
    ] },
    { id: 'trusted', beats: [ { id: 'send', type: 'message', interactionId: 'note' } ], nextSceneId: 'end' },
    { id: 'end', beats: [{ id: 'the_end', type: 'ending', endingId: 'end', text: t('Конец', 'End') }] },
  ] });
  return { catalog, graph };
}

test('message reactions are authored but depend on previous in-game trust', () => {
  const { graph, catalog } = story();
  let state = createNarrativeState(graph);
  state = advanceNarrative(graph, catalog, state, { type: 'choose', optionId: 'shy' }).state;
  assert.deepEqual(resolveNarrativeView(graph, catalog, state).variants.map(v => v.id), ['neutral']);
  assert.throws(() => advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'warm' }), /unavailable/i);
  let trusted = createNarrativeState(graph);
  trusted = advanceNarrative(graph, catalog, trusted, { type: 'choose', optionId: 'open' }).state;
  assert.deepEqual(resolveNarrativeView(graph, catalog, trusted).variants.map(v => v.id), ['warm', 'neutral']);
  trusted = advanceNarrative(graph, catalog, trusted, { type: 'interact', optionId: 'warm' }).state;
  assert.deepEqual(trusted.memories, ['love_letter']);
  assert.equal(trusted.sceneId, 'end');
});

test('real Core snapshots preserve graph state without an external save service', () => {
  const { graph, catalog } = story();
  const definition = { schemaVersion: 1, id: 'narrative-sample', version: '0.1.0',
    title: { ru: 'Нарративный пример' }, engine: 'ludory', targets: ['vk-games'] };
  const first = createGameSession({ definition, initialState: { narrative: createNarrativeState(graph) } });
  first.setState({ narrative: advanceNarrative(graph, catalog, first.getState().narrative,
    { type: 'choose', optionId: 'open' }).state });
  const snapshot = first.snapshot();
  const restored = createGameSession({ definition });
  restored.restore(snapshot);
  assert.equal(validateNarrativeState(graph, catalog, restored.getState().narrative).flags.trusted, true);
  assert.equal(resolveNarrativeView(graph, catalog, restored.getState().narrative).type, 'message');
});

test('unknown condition operator on message is rejected before runtime', () => {
  assert.throws(() => defineNarrativeCatalog({ schemaVersion: 1, interactions: [{
    id: 'msg', type: 'message', label: t('О', 'O'), variants: [{ id: 'v', recipient: 'leo',
      intent: 'meet', tone: 'soft', when: { script: 'return true' }, preview: t('А', 'A'),
      reply: t('Б', 'B'), effects: [] }],
  }] }), /predicate|operator/i);
});

test('journal rejects fabricated unreached memories instead of displaying spoilers', () => {
  const { graph, catalog } = story();
  const state = createNarrativeState(graph);
  assert.deepEqual(buildNarrativeJournal(graph, catalog, state, 'ru').memories, []);
  assert.throws(() => buildNarrativeJournal(graph, catalog, { ...state, memories: ['spoiler'] }, 'ru'), /unknown|state/i);
});
