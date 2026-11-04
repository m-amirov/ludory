import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineEconomy } from '@ludory/economy';
import { defineNarrativeGraph, defineNarrativeCatalog } from '@ludory/narrative';
import { definePremiumManifest, verifyFreeNarrativePaths } from '@ludory/runtime-economy';
import { listCatalog } from '../src/catalog.mjs';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';

function empty(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-economy-template-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const options = { id: 'new-evening', title: 'New Evening', lang: 'ru',
  profile: 'narrative-game', template: 'narrative-economy', targets: ['yandex-games', 'vk-games'] };

test('economy narrative is separate opt-in Studio template, never part of default selected templates', t => {
  const templates = listCatalog('templates');
  assert.ok(templates.find(item => item.id === 'narrative-economy'));
  assert.ok(templates.find(item => item.id === 'narrative-interactive'));
  const root = empty(t);
  const plan = planCreate(root, options);
  assert.equal(plan.status, 'READY', plan.conflicts.join('; '));
  assert.deepEqual(fs.readdirSync(root), []);
  assert.ok(plan.writes.includes('config/economy.json'));
  assert.ok(plan.writes.includes('config/premium.json'));
  assert.ok(plan.writes.includes('assets/ludory-economy.js'));
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config/economy.json'))).enabled, false);
  const components = JSON.parse(fs.readFileSync(path.join(root, 'ludory.components.json')));
  assert.equal(components.files['config/economy.json'], undefined,
    'authored config is not managed or overwritten by component updates');
  assert.equal(components.files['config/premium.json'], undefined);
});

test('generated demo keeps a completely free good-ending path, while premium has authored effects', async t => {
  const root = empty(t);
  assert.equal(applyCreatePlan(planCreate(root, options)).status, 'APPLIED');
  const source = await import(pathToFileURL(path.join(root, 'src/story.js')).href);
  const config = defineEconomy({ ...JSON.parse(fs.readFileSync(path.join(root, 'config/economy.json'))),
    enabled: true, gameId: options.id });
  const graph = defineNarrativeGraph(source.graphData);
  const catalog = defineNarrativeCatalog(source.catalogData);
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'config/premium.json')));
  const sidecar = definePremiumManifest(raw, { graph, economyConfig: config });
  const checked = verifyFreeNarrativePaths({ graph, catalog, manifest: sidecar,
    terminals: [{ endingId: 'good', routeId: 'partner' }],
    traces: [{ endingId: 'good', routeId: 'partner', actions: [
      { type: 'next', beatId: 'intro' }, { type: 'choose', beatId: 'fork', optionId: 'chat' },
      { type: 'next', beatId: 'bridge_intro' }, { type: 'choose', beatId: 'bridge_choice', optionId: 'stay' },
    ] }],
  });
  assert.ok(checked);
  const premium = graph.scenes[0].beats[1].choices.find(choice => choice.id === 'intimate');
  assert.ok(premium.effects.some(e => e.op === 'relation_delta'));
  assert.ok(premium.effects.some(e => e.op === 'memory_add'));
});

test('template source is safe to import without browser and exposes explicit economy startup', async t => {
  const root = empty(t);
  assert.equal(applyCreatePlan(planCreate(root, options)).status, 'APPLIED');
  const main = await import(pathToFileURL(path.join(root, 'src/main.js')).href);
  assert.equal(typeof main.startEconomyNarrative, 'function');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /economy-panel/);
  assert.match(html, /ludory-mobile-orientation.*portrait/);
  assert.doesNotMatch(html, /https?:\/\//, 'default-off preview does not require a platform SDK');
});

test('bundled platform ports include separate wallet and narrative cloud storage factories', async t => {
  const root = empty(t);
  assert.equal(applyCreatePlan(planCreate(root, options)).status, 'APPLIED');
  const bundle = await import(pathToFileURL(path.join(root, 'assets/ludory-economy.js')).href);
  for (const name of ['createYandexEconomyStorage', 'createYandexPlayerStorage',
    'createVkEconomyStorage', 'createVkStorage', 'createYandexPurchases']) {
    assert.equal(typeof bundle[name], 'function', `${name} must be importable by a Studio game`);
  }
});

test('narrative restore failures block the session without overwriting the original save', async t => {
  const root = empty(t);
  assert.equal(applyCreatePlan(planCreate(root, options)).status, 'APPLIED');
  const { restoreNarrativeSession } = await import(pathToFileURL(path.join(root, 'src/restore.js')).href);
  const calls = [];
  const host = { async restore() { calls.push('restore'); }, start() { calls.push('start'); } };
  const broken = { async load() { calls.push('load'); throw new Error('corrupt'); },
    async save() { calls.push('save'); }, async clear() { calls.push('clear'); } };
  assert.equal(await restoreNarrativeSession({ host, storage: broken, saveKey: 'key' }), 'BLOCKED');
  assert.deepEqual(calls, ['load'], 'failed restore must neither start nor overwrite an incompatible save');
  calls.length = 0;
  assert.equal(await restoreNarrativeSession({ host, storage: { async load() { calls.push('load'); return { revision: 1 }; } },
    saveKey: 'key' }), 'RESTORED');
  assert.deepEqual(calls, ['load', 'restore', 'start']);
  calls.length = 0;
  assert.equal(await restoreNarrativeSession({ host, storage: null, saveKey: 'key' }), 'NEW');
  assert.deepEqual(calls, ['start']);
});

test('enabled economy cannot start without platform cloud adapters or substitute localStorage', async t => {
  const root = empty(t);
  assert.equal(applyCreatePlan(planCreate(root, options)).status, 'APPLIED');
  const main = await import(pathToFileURL(path.join(root, 'src/main.js')).href);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/economy.json'), 'utf8'));
  config.enabled = true;
  let localStorageReads = 0;
  const previous = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  t.after(() => { globalThis.document = previous.document; globalThis.window = previous.window;
    globalThis.fetch = previous.fetch; });
  const nodes = Object.fromEntries(['game','status','story-title','economy-panel','save'].map(id => [id, { textContent: '' }]));
  globalThis.document = { querySelector(selector) { return nodes[selector.slice(1)]; } };
  globalThis.window = { get localStorage() { localStorageReads++; throw new Error('local storage must remain untouched'); } };
  globalThis.fetch = async filename => ({ ok: true, async json() {
    if (filename === './ludory.project.json') return {
      schemaVersion: 1, id: options.id, version: '0.1.0', title: { ru: options.title },
      engine: 'web', targets: ['vk-games', 'yandex-games'],
    };
    if (filename === './config/economy.json') return config;
    if (filename === './config/premium.json') return JSON.parse(fs.readFileSync(path.join(root, 'config/premium.json')));
    throw new Error(`Unexpected fetch ${filename}`);
  } });
  await assert.rejects(main.startEconomyNarrative({ target: 'yandex-games' }), /cloud.*wallet|cloud.*storage/i);
  assert.equal(localStorageReads, 0);
  await assert.rejects(main.startEconomyNarrative({ target: 'vk-games', economyPorts: {
    storage: { purchaseCloud: true, load() {}, save() {} },
    narrativeStorage: { load() {}, save() {} },
  } }), /Wrong or unsupported platform/i);
  await assert.rejects(main.startEconomyNarrative({ target: 'vk-games', storeEnabled: true,
    economyPorts: { storage: { purchaseCloud: false, load() {}, save() {} },
      narrativeStorage: { load() {}, save() {} }, purchases: {} },
  }), /VK IAP/i);
  assert.equal(localStorageReads, 0);
});
