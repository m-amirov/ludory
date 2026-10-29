import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNarrativeView } from '@ludory/narrative';
import { createNarrativeRuntimeUpdate, narrativeAction } from '../src/index.mjs';
import { fixture, input } from './fixture.mjs';

function harness() {
  const { graph, catalog, initialState } = fixture();
  const update = createNarrativeRuntimeUpdate({ graph, catalog });
  let state = initialState;
  const tick = (...events) => update({ deltaMs: 16, inputs: events, state, setState(value) { state = value; } });
  const view = () => resolveNarrativeView(graph, catalog, state.narrative);
  return { graph, catalog, tick, view, state: () => state };
}

test('dialogue → photo → keepsake → contextual message → echo → locked ending', () => {
  const h = harness();
  h.tick(input(narrativeAction('next', 'intro')));
  assert.equal(h.view().type, 'photo');
  h.tick(input(narrativeAction('interact', 'take_photo', 'take')));
  h.tick(input(narrativeAction('interact', 'take_item', 'shell')));
  assert.equal(h.view().type, 'message');
  assert.deepEqual(h.view().variants.map(v => v.id), ['warm', 'plain', 'care']);
  h.tick(input(narrativeAction('interact', 'send_message', 'warm')));
  assert.equal(h.view().type, 'echo');
  assert.equal(h.state().narrative.messages[0].reply.ru, 'Конечно, встретимся!');
  h.tick(input(narrativeAction('next', 'echo')));
  h.tick(input(narrativeAction('choose', 'branch', 'together')));
  assert.equal(h.view().type, 'ending');
  assert.equal(h.state().narrative.routeLock, 'friend');
});

test('duplicate send, stale choices and unknown input never duplicate or corrupt state', () => {
  const h = harness();
  const noInput = h.state();
  h.tick(input('narrative:interact:intro:take'), input('narrative:nope:intro'), input('narrative:next:wrong'));
  assert.deepEqual(h.state(), noInput);
  h.tick(input(narrativeAction('next', 'intro')));
  h.tick(input(narrativeAction('interact', 'take_photo', 'skip')));
  h.tick(input(narrativeAction('interact', 'take_item', 'shell')));
  assert.deepEqual(h.view().variants.map(v => v.id), ['plain', 'care']);
  const send = input(narrativeAction('interact', 'send_message', 'plain'));
  h.tick(send, send);
  assert.equal(h.state().narrative.messages.length, 1);
  h.tick(input(narrativeAction('choose', 'branch', 'together')));
  assert.equal(h.view().type, 'choice');
  assert.deepEqual(h.view().choices.map(v => v.id), ['apart']);
});

test('Back atomically rolls back message, photo, relationship and ending', () => {
  const h = harness();
  h.tick(input(narrativeAction('next', 'intro')));
  h.tick(input(narrativeAction('interact', 'take_photo', 'take')));
  h.tick(input(narrativeAction('interact', 'take_item', 'shell')));
  h.tick(input(narrativeAction('interact', 'send_message', 'warm')));
  h.tick(input(narrativeAction('next', 'echo')));
  h.tick(input(narrativeAction('choose', 'branch', 'together')));
  h.tick(input('narrative:back'));
  assert.equal(h.view().type, 'choice');
  assert.equal(h.state().narrative.routeLock, null);
  h.tick(input('narrative:back'));
  assert.equal(h.view().type, 'echo');
  h.tick(input('narrative:back'));
  assert.equal(h.view().type, 'message');
  assert.deepEqual(h.state().narrative.messages, []);
  assert.deepEqual(h.state().narrative.memories, []);
  h.tick(input('narrative:back'));
  h.tick(input('narrative:back'));
  assert.equal(h.view().type, 'photo');
  assert.deepEqual(h.state().narrative.album, []);
  assert.deepEqual(Object.keys(h.state().narrative.relations), []);
});

test('restored session starts from saved canonical state with no stale undo stack', () => {
  const h = harness();
  h.tick(input(narrativeAction('next', 'intro')));
  const persisted = structuredClone(h.state());
  const { graph, catalog } = h;
  const fresh = createNarrativeRuntimeUpdate({ graph, catalog });
  assert.equal(fresh.canGoBack(), false);
  let state = persisted;
  fresh({ deltaMs: 16, inputs: [input('narrative:back')], state, setState(next) { state = next; } });
  assert.deepEqual(state, persisted);
  fresh({ deltaMs: 16, inputs: [input(narrativeAction('interact', 'take_photo', 'take'))], state,
    setState(next) { state = next; } });
  assert.deepEqual(state.narrative.album, ['harbor']);
  assert.equal(fresh.canGoBack(), true);
  fresh({ deltaMs: 16, inputs: [input('narrative:back')], state, setState(next) { state = next; } });
  assert.equal(fresh.canGoBack(), false);
});
