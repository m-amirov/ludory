import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeHost } from '@ludory/runtime';
import { resolveNarrativeView } from '@ludory/narrative';
import { createNarrativeRuntimeUpdate, narrativeAction } from '../src/index.mjs';
import { fixture, input } from './fixture.mjs';

const GAME = { schemaVersion: 1, id: 'n2-runtime-smoke', version: '1.0.0',
  title: { en: 'N2 Runtime' }, engine: 'web', targets: ['yandex-games'] };

function setup(savedState) {
  const { graph, catalog, initialState } = fixture();
  const frames = new Map();
  let generation = 0;
  let clock = 0;
  let mountContext;
  const environment = {
    root: {}, now: () => clock,
    getViewport: () => ({ width: 1000, height: 720, dpr: 1, orientation: 'landscape' }),
    observeViewport: () => () => {},
    requestFrame(callback) { const id = ++generation; frames.set(id, callback); return id; },
    cancelFrame(id) { frames.delete(id); },
  };
  const renderer = {
    mount(context) { mountContext = context; }, resize() {}, render() {}, unmount() {},
  };
  const inputAdapter = { subscribe: () => () => {}, enable() {}, disable() {} };
  const update = createNarrativeRuntimeUpdate({ graph, catalog });
  const host = createRuntimeHost({ game: GAME, initialState: savedState ?? initialState,
    update, renderer, environment, input: inputAdapter });
  return {
    host, graph, catalog,
    send(action) { mountContext.dispatchInput({ ...input(action), timestamp: clock }); },
    step() { clock += 16; const [id, frame] = frames.entries().next().value; frames.delete(id); frame(); },
    current() { return resolveNarrativeView(graph, catalog, host.getSnapshot().state.narrative); },
  };
}

test('real Runtime host handles renderer input, Back, pause and restored Core state', async () => {
  const h = setup();
  await h.host.initialize();
  h.host.start();
  h.send(narrativeAction('next', 'intro'));
  h.step();
  assert.equal(h.current().type, 'photo');
  h.send(narrativeAction('interact', 'take_photo', 'take'));
  h.step();
  assert.equal(h.current().type, 'keepsake');
  const savedState = structuredClone(h.host.getSnapshot().state);
  h.host.pause();
  h.send(narrativeAction('interact', 'take_item', 'shell'));
  h.host.resume();
  h.step();
  assert.equal(h.current().type, 'keepsake', 'paused input must not replay');
  h.send('narrative:back');
  h.step();
  assert.equal(h.current().type, 'photo');
  assert.deepEqual(h.host.getSnapshot().state.narrative.album, []);
  await h.host.destroy();

  const recovered = setup(savedState);
  await recovered.host.initialize();
  recovered.host.start();
  recovered.send('narrative:back');
  recovered.step();
  assert.equal(recovered.current().type, 'keepsake', 'new session does not carry transient undo stack');
  recovered.send(narrativeAction('interact', 'take_item', 'shell'));
  recovered.step();
  assert.equal(recovered.current().type, 'message');
  await recovered.host.destroy();
});
