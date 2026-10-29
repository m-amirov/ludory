import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceNarrative } from '@ludory/narrative';
import { createNarrativeRenderer } from '../src/index.mjs';
import { fixture } from './fixture.mjs';

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.textContent = '';
    this.className = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  appendChild(node) { this.children.push(node); node.parent = this; return node; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  replaceChildren(...nodes) { for (const node of this.children) node.parent = null; this.children = []; nodes.forEach(node => this.appendChild(node)); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get('click')?.({ detail: 1 }); }
}

function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

function screen() {
  const document = { createElement(tagName) { return new FakeElement(tagName, document); } };
  return { root: document.createElement('div'), find };
}

function snapshot(state) {
  return { schemaVersion: 1, gameId: 'n2-fixture', gameVersion: '1.0.0', revision: 0, state };
}

test('renderer mounts safely, shows escaped text and emits finite normalized action', async () => {
  const { graph, catalog, initialState } = fixture();
  const { root } = screen();
  const events = [];
  const renderer = createNarrativeRenderer({ graph, catalog, now: () => 123 });
  await renderer.mount({ root, viewport: { width: 380, height: 720, dpr: 1, orientation: 'portrait' },
    snapshot: snapshot(initialState), dispatchInput: event => events.push(event) });
  assert.equal(root.children.length, 2); // scoped stylesheet plus game surface
  assert.equal(find(root, node => node.textContent === '<b>Здравствуй</b>').tagName, 'P');
  const next = find(root, node => node.dataset.action === 'narrative:next:intro');
  next.click();
  assert.deepEqual(events, [{ schemaVersion: 1, type: 'pointer', action: 'narrative:next:intro',
    phase: 'up', timestamp: 123, source: 'renderer' }]);
  renderer.resize({ width: 1000, height: 720, dpr: 1, orientation: 'landscape' });
  assert.equal(root.children[1].dataset.orientation, 'landscape');
  await renderer.unmount();
  next.click();
  assert.equal(events.length, 1);
  assert.equal(root.children.length, 0);
});

test('renderer photo, keepsake and guided message intent/tone/attachment preview', async () => {
  const { graph, catalog, initialState } = fixture();
  const { root } = screen();
  const actions = [];
  const renderer = createNarrativeRenderer({ graph, catalog, assets: { harbor: './art/harbor.png' } });
  await renderer.mount({ root, viewport: { width: 350, height: 720, dpr: 1, orientation: 'portrait' },
    snapshot: snapshot(initialState), dispatchInput: event => actions.push(event.action) });
  let state = { ...initialState, narrative: advanceNarrative(graph, catalog, initialState.narrative, { type: 'next' }).state };
  renderer.render(snapshot(state));
  assert.ok(find(root, node => node.tagName === 'IMG' && node.getAttribute('src') === './art/harbor.png'));
  find(root, node => node.dataset.action === 'narrative:interact:take_photo:take').click();
  state = { ...state, narrative: advanceNarrative(graph, catalog, state.narrative, { type: 'interact', optionId: 'take' }).state };
  renderer.render(snapshot(state));
  assert.ok(find(root, node => node.dataset.action === 'narrative:interact:take_item:shell'));
  state = { ...state, narrative: advanceNarrative(graph, catalog, state.narrative, { type: 'interact', optionId: 'shell' }).state };
  renderer.render(snapshot(state));
  assert.ok(find(root, node => node.textContent === 'Встречаемся? Я пришлю фото.'));
  assert.ok(find(root, node => node.dataset.action === 'narrative:interact:send_message:warm'));
  const support = find(root, node => node.dataset.intent === 'support');
  support.click();
  assert.ok(find(root, node => node.textContent === 'Как ты?'));
  assert.ok(find(root, node => node.dataset.action === 'narrative:interact:send_message:care'));
  assert.ok(actions.includes('narrative:interact:take_photo:take'));
});

test('journal and localization show only earned entries without author HTML injection', async () => {
  const { graph, catalog, initialState } = fixture();
  const { root } = screen();
  const renderer = createNarrativeRenderer({ graph, catalog });
  await renderer.mount({ root, viewport: { width: 1000, height: 720, dpr: 1, orientation: 'landscape' },
    snapshot: snapshot(initialState), dispatchInput() {} });
  find(root, node => node.dataset.ui === 'journal').click();
  assert.ok(find(root, node => node.textContent === 'Пока нет воспоминаний'));
  renderer.setLocale('en');
  find(root, node => node.dataset.ui === 'journal').click();
  assert.ok(find(root, node => node.textContent === '<b>Hello</b>'));
  assert.equal(find(root, node => node.tagName === 'B'), null);
});

test('rejects scheme-relative backslash asset escape and never advertises unavailable Back', async () => {
  const { graph, catalog, initialState } = fixture();
  const { root } = screen();
  const renderer = createNarrativeRenderer({ graph, catalog, assets: { harbor: '/\\evil.example/image.png' },
    canBack: () => false });
  await renderer.mount({ root, viewport: { width: 380, height: 720, dpr: 1, orientation: 'portrait' },
    snapshot: snapshot(initialState), dispatchInput() {} });
  const photoState = { ...initialState, narrative: advanceNarrative(graph, catalog, initialState.narrative, { type: 'next' }).state };
  renderer.render(snapshot(photoState));
  assert.equal(find(root, node => node.tagName === 'IMG'), null);
  assert.ok(find(root, node => node.textContent === 'Изображение недоступно: harbor'));
  assert.equal(find(root, node => node.dataset.action === 'narrative:back'), null);
});

test('detached buttons from a prior mount cannot dispatch into a new host generation', async () => {
  const { graph, catalog, initialState } = fixture();
  const { root } = screen();
  const renderer = createNarrativeRenderer({ graph, catalog, now: () => 100 });
  const events = [];
  const mount = dispatchInput => renderer.mount({ root, viewport: { width: 380, height: 720,
    dpr: 1, orientation: 'portrait' }, snapshot: snapshot(initialState), dispatchInput });
  await mount(event => events.push(['old', event.action]));
  const stale = find(root, node => node.dataset.action === 'narrative:next:intro');
  await renderer.unmount();
  await mount(event => events.push(['new', event.action]));
  stale.click();
  assert.deepEqual(events, []);
  find(root, node => node.dataset.action === 'narrative:next:intro').click();
  assert.deepEqual(events, [['new', 'narrative:next:intro']]);
});

test('message Cancel is local-only and authored labels make intent, tone and journal readable', async () => {
  const { graph, catalog, initialState } = fixture();
  const { root } = screen();
  const events = [];
  const renderer = createNarrativeRenderer({ graph, catalog, labels: {
    intent: { invite: { ru: 'Пригласить', en: 'Invite' } },
    tone: { warm: { ru: 'Нежно', en: 'Warm' } },
    journal: { harbor: { ru: 'Вечер в порту', en: 'Harbor at dusk' } },
  }, relationFacts: [{ id: 'friend', min: 2, text: { ru: 'Мы стали ближе', en: 'We grew closer' } }] });
  await renderer.mount({ root, viewport: { width: 380, height: 720, dpr: 1, orientation: 'portrait' },
    snapshot: snapshot(initialState), dispatchInput: event => events.push(event) });
  let n = initialState.narrative;
  for (const action of [{ type: 'next' }, { type: 'interact', optionId: 'take' },
    { type: 'interact', optionId: 'shell' }]) n = advanceNarrative(graph, catalog, n, action).state;
  renderer.render(snapshot({ narrative: n }));
  assert.ok(find(root, node => node.textContent === 'Пригласить'));
  assert.ok(find(root, node => node.textContent === 'Нежно'));
  find(root, node => node.dataset.ui === 'cancel-message').click();
  assert.equal(find(root, node => node.textContent === 'Встречаемся? Я пришлю фото.'), null);
  assert.equal(events.length, 0, 'cancel is never sent as a gameplay command');
  find(root, node => node.dataset.ui === 'compose-message').click();
  assert.ok(find(root, node => node.textContent === 'Встречаемся? Я пришлю фото.'));
  find(root, node => node.dataset.ui === 'journal').click();
  assert.ok(find(root, node => node.textContent === 'Вечер в порту'));
  assert.ok(find(root, node => node.textContent === 'Мы стали ближе'));
});
