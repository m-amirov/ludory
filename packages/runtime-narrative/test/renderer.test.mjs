import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceNarrative } from '@ludory/narrative';
import { applyEconomyOperation, createEconomyState } from '@ludory/economy';
import { createEconomyRuntime, definePremiumManifest } from '@ludory/runtime-economy';
import { createNarrativeRenderer } from '../src/index.mjs';
import { fixture } from './fixture.mjs';
import { fixture as premiumFixture } from '../../runtime-economy/test/fixture.mjs';

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
  assert.equal(root.children[1].dataset.mobilePreference, 'auto', 'existing callers retain auto preference');
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

test('explicit portrait preference remains stable across viewport rotation and story input', async () => {
  const { graph, catalog, initialState } = fixture();
  const { root } = screen();
  const events = [];
  const renderer = createNarrativeRenderer({ graph, catalog, preferredMobileOrientation: 'portrait', now: () => 42 });
  await renderer.mount({ root, viewport: { width: 320, height: 640, orientation: 'portrait' },
    snapshot: snapshot(initialState), dispatchInput: event => events.push(event) });
  const surface = root.children[1];
  assert.equal(surface.dataset.mobilePreference, 'portrait');
  assert.equal(surface.dataset.orientation, 'portrait');
  renderer.resize({ width: 667, height: 375, orientation: 'landscape' });
  assert.equal(surface.dataset.mobilePreference, 'portrait', 'preference is not device rotation');
  assert.equal(surface.dataset.orientation, 'landscape');
  find(root, node => node.dataset.action === 'narrative:next:intro').click();
  assert.deepEqual(events.map(event => event.action), ['narrative:next:intro']);
  await renderer.unmount();
});

test('renderer rejects unsupported mobile orientation preferences before mounting', () => {
  const { graph, catalog } = fixture();
  for (const preference of ['landscape', '', null, 1, {}, false]) {
    assert.throws(() => createNarrativeRenderer({ graph, catalog, preferredMobileOrientation: preference }),
      TypeError, `unsupported preference ${String(preference)} should fail`);
  }
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

async function premiumEnvironment({ denySave = false, pendingSave = false, startingCrystals = 20 } = {}) {
  const f = premiumFixture();
  const manifest = definePremiumManifest(f.rawManifest, { graph: f.graph, economyConfig: f.config });
  let wallet = createEconomyState(f.config);
  if (startingCrystals > 0) wallet = applyEconomyOperation(f.config, wallet, { type: 'GRANT_STARTER' }).state;
  let finishSave;
  let saveCount = 0;
  let allowSave = !denySave;
  const runtime = createEconomyRuntime({ config: f.config, manifest, graph: f.graph, storage: {
    async load() { return structuredClone(wallet); },
    async save(next) {
      saveCount++;
      if (!allowSave) throw new Error('network');
      if (pendingSave) await new Promise(resolve => { finishSave = resolve; });
      wallet = structuredClone(next);
      return true;
    },
  } });
  await runtime.initialize();
  let n = f.initialNarrative;
  n = advanceNarrative(f.graph, f.catalog, n, { type: 'next', beatId: 'intro' }).state;
  n = advanceNarrative(f.graph, f.catalog, n, { type: 'interact', beatId: 'photo', optionId: 'snap' }).state;
  return { ...f, runtime, narrative: n, finishSave: () => finishSave?.(), recover: () => { allowSave = true; }, saves: () => saveCount,
    wallet: () => wallet };
}

test('premium renderer labels price, requires explicit confirmation, and never auto-chooses after save', async () => {
  const f = await premiumEnvironment();
  const { root } = screen();
  const events = [];
  const renderer = createNarrativeRenderer({ graph: f.graph, catalog: f.catalog, premiumChoices: f.runtime });
  await renderer.mount({ root, viewport: { width: 340, height: 700, orientation: 'portrait' },
    snapshot: snapshot({ narrative: f.narrative }), dispatchInput: event => events.push(event.action) });
  assert.ok(find(root, node => node.textContent.includes('Особый вечер') && node.textContent.includes('12') && node.tagName === 'BUTTON'));
  assert.equal(find(root, node => node.dataset.action === 'narrative:choose:fork:intimate'), null);
  find(root, node => node.dataset.ui === 'premium-unlock').click();
  assert.equal(f.saves(), 0);
  assert.ok(find(root, node => node.dataset.ui === 'premium-confirm'));
  assert.deepEqual(events, []);
  find(root, node => node.dataset.ui === 'premium-confirm').click();
  await new Promise(resolve => setImmediate(resolve));
  renderer.render(snapshot({ narrative: f.narrative }));
  assert.equal(f.wallet().balance, 8);
  assert.deepEqual(events, [], 'purchase of entitlement does not advance story');
  const unlocked = find(root, node => node.dataset.action === 'narrative:choose:fork:intimate');
  assert.ok(unlocked);
  unlocked.click();
  assert.deepEqual(events, ['narrative:choose:fork:intimate']);
  await renderer.unmount();
});

test('failed premium save shows error, keeps choice locked and emits no forged narrative action', async () => {
  const f = await premiumEnvironment({ denySave: true });
  const { root } = screen();
  const events = [];
  const renderer = createNarrativeRenderer({ graph: f.graph, catalog: f.catalog, premiumChoices: f.runtime });
  await renderer.mount({ root, viewport: { width: 340, height: 700, orientation: 'portrait' },
    snapshot: snapshot({ narrative: f.narrative }), dispatchInput: event => events.push(event.action) });
  find(root, node => node.dataset.ui === 'premium-unlock').click();
  find(root, node => node.dataset.ui === 'premium-confirm').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(find(root, node => node.dataset.ui === 'premium-error'));
  assert.equal(find(root, node => node.dataset.action === 'narrative:choose:fork:intimate'), null);
  assert.equal(f.wallet().balance, 20);
  assert.deepEqual(events, []);
  await renderer.unmount();
});

test('premium screen recovers rejected save through an explicit user retry, then permits a new confirmed spend', async () => {
  const f = await premiumEnvironment({ denySave: true });
  const { root } = screen();
  const events = [];
  const renderer = createNarrativeRenderer({ graph: f.graph, catalog: f.catalog, premiumChoices: f.runtime });
  await renderer.mount({ root, viewport: { width: 340, height: 700 },
    snapshot: snapshot({ narrative: f.narrative }), dispatchInput: event => events.push(event.action) });
  find(root, node => node.dataset.ui === 'premium-unlock').click();
  find(root, node => node.dataset.ui === 'premium-confirm').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.runtime.getChoiceAccess('fork', 'intimate').status, 'unavailable');
  assert.equal(find(root, node => node.dataset.ui === 'premium-unlock'), null);
  const retry = find(root, node => node.dataset.ui === 'premium-retry');
  assert.ok(retry, 'unavailable premium access needs a visible recovery action');
  f.recover();
  retry.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.runtime.getChoiceAccess('fork', 'intimate').status, 'locked');
  find(root, node => node.dataset.ui === 'premium-unlock').click();
  find(root, node => node.dataset.ui === 'premium-confirm').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.wallet().balance, 8);
  assert.ok(find(root, node => node.dataset.action === 'narrative:choose:fork:intimate'));
  assert.deepEqual(events, []);
  await renderer.unmount();
});

test('recovering an ambiguous committed premium save does not debit twice', async () => {
  const f = premiumFixture();
  const manifest = definePremiumManifest(f.rawManifest, { graph: f.graph, economyConfig: f.config });
  let wallet = applyEconomyOperation(f.config, createEconomyState(f.config), { type: 'GRANT_STARTER' }).state;
  let saves = 0;
  const runtime = createEconomyRuntime({ config: f.config, graph: f.graph, manifest, storage: {
    async load() { return structuredClone(wallet); },
    async save(next) { saves++; wallet = structuredClone(next); if (saves === 1) throw new Error('lost acknowledgement'); return true; },
  } });
  await runtime.initialize();
  let narrative = advanceNarrative(f.graph, f.catalog, f.initialNarrative, { type: 'next' }).state;
  narrative = advanceNarrative(f.graph, f.catalog, narrative, { type: 'interact', optionId: 'snap' }).state;
  const { root } = screen();
  const renderer = createNarrativeRenderer({ graph: f.graph, catalog: f.catalog, premiumChoices: runtime });
  await renderer.mount({ root, viewport: { width: 340, height: 700 },
    snapshot: snapshot({ narrative }), dispatchInput() {} });
  find(root, node => node.dataset.ui === 'premium-unlock').click();
  find(root, node => node.dataset.ui === 'premium-confirm').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(find(root, node => node.dataset.ui === 'premium-retry'));
  find(root, node => node.dataset.ui === 'premium-retry').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.getChoiceAccess('fork', 'intimate').status, 'unlocked');
  assert.equal(wallet.balance, 8);
  assert.equal(saves, 1, 'reconciliation must not charge or save again');
  assert.ok(find(root, node => node.dataset.action === 'narrative:choose:fork:intimate'));
  await renderer.unmount();
});

test('pending save never dispatches choice and stale premium buttons do not act after unmount', async () => {
  const f = await premiumEnvironment({ pendingSave: true });
  const { root } = screen();
  const events = [];
  const renderer = createNarrativeRenderer({ graph: f.graph, catalog: f.catalog, premiumChoices: f.runtime });
  await renderer.mount({ root, viewport: { width: 340, height: 700, orientation: 'portrait' },
    snapshot: snapshot({ narrative: f.narrative }), dispatchInput: event => events.push(event.action) });
  const stale = find(root, node => node.dataset.ui === 'premium-unlock');
  stale.click();
  find(root, node => node.dataset.ui === 'premium-confirm').click();
  assert.ok(find(root, node => node.dataset.ui === 'premium-pending'));
  assert.deepEqual(events, []);
  await renderer.unmount();
  stale.click();
  await new Promise(resolve => setImmediate(resolve));
  f.finishSave();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, []);
});

test('insufficient currency is reported accurately without unlocking or dispatching a choice', async () => {
  const f = await premiumEnvironment({ startingCrystals: 0 });
  const { root } = screen();
  const events = [];
  const renderer = createNarrativeRenderer({ graph: f.graph, catalog: f.catalog, premiumChoices: f.runtime });
  await renderer.mount({ root, viewport: { width: 340, height: 700 },
    snapshot: snapshot({ narrative: f.narrative }), dispatchInput: event => events.push(event.action) });
  find(root, node => node.dataset.ui === 'premium-unlock').click();
  find(root, node => node.dataset.ui === 'premium-confirm').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(find(root, node => node.dataset.ui === 'premium-insufficient'));
  assert.equal(find(root, node => node.dataset.action === 'narrative:choose:fork:intimate'), null);
  assert.equal(f.saves(), 0);
  assert.deepEqual(events, []);
  await renderer.unmount();
});

test('detached confirmation from another narrative beat cannot later spend currency', async () => {
  const f = await premiumEnvironment();
  const { root } = screen();
  const renderer = createNarrativeRenderer({ graph: f.graph, catalog: f.catalog, premiumChoices: f.runtime });
  await renderer.mount({ root, viewport: { width: 340, height: 700 },
    snapshot: snapshot({ narrative: f.narrative }), dispatchInput() {} });
  find(root, node => node.dataset.ui === 'premium-unlock').click();
  const staleConfirm = find(root, node => node.dataset.ui === 'premium-confirm');
  const moved = advanceNarrative(f.graph, f.catalog, f.narrative,
    { type: 'choose', beatId: 'fork', optionId: 'connect' }).state;
  renderer.render(snapshot({ narrative: moved }));
  staleConfirm.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.saves(), 0);
  assert.equal(f.wallet().balance, 20);
  await renderer.unmount();
});

test('premium renderer rejects a saved wallet attached to a different narrative graph', async () => {
  const f = await premiumEnvironment();
  const replaced = structuredClone(f.graph);
  replaced.scenes[0].beats.find(beat => beat.id === 'fork')
    .choices.find(choice => choice.id === 'intimate').id = 'private_now';
  assert.throws(() => createNarrativeRenderer({ graph: replaced, catalog: f.catalog,
    premiumChoices: f.runtime }), /graph|manifest/i);
});
