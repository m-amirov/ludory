import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEconomyOperation, createEconomyState } from '@ludory/economy';
import { resolveNarrativeView } from '@ludory/narrative';
import { createNarrativeRuntimeUpdate, narrativeAction } from '@ludory/runtime-narrative';
import { createEconomyRuntime, definePremiumManifest } from '../src/index.mjs';
import { fixture } from './fixture.mjs';

function setup({ startingCrystals = 20, saveBehavior = 'ok', enabled = true } = {}) {
  const f = fixture({ enabled });
  const manifest = definePremiumManifest(f.rawManifest, { graph: f.graph, economyConfig: f.config });
  let persisted = createEconomyState(f.config);
  if (enabled && startingCrystals) persisted = applyEconomyOperation(f.config, persisted, { type: 'GRANT_STARTER' }).state;
  let saveCount = 0;
  let loadCount = 0;
  const storage = {
    async load() { loadCount++; return structuredClone(persisted); },
    async save(next) {
      saveCount++;
      if (saveBehavior === 'reject') throw new Error('network');
      if (saveBehavior === 'false') return false;
      persisted = structuredClone(next);
      if (saveBehavior === 'ambiguous') throw new Error('ack lost');
      return true;
    },
  };
  const runtime = createEconomyRuntime({ config: f.config, graph: f.graph, manifest, storage });
  return { ...f, manifest, runtime, storage,
    persisted: () => persisted, saves: () => saveCount, loads: () => loadCount };
}

function guardedNarrative(f) {
  const update = createNarrativeRuntimeUpdate({ graph: f.graph, catalog: f.catalog,
    authorizeChoice: f.runtime.authorizeChoice });
  let state = { narrative: f.initialNarrative };
  const tick = action => update({ inputs: [{ schemaVersion: 1, type: 'pointer', source: 'input', phase: 'up',
    timestamp: 1, action }], state, setState(next) { state = next; } });
  return { tick, state: () => state.narrative,
    view: () => resolveNarrativeView(f.graph, f.catalog, state.narrative),
    reachFork() {
      tick(narrativeAction('next', 'intro'));
      tick(narrativeAction('interact', 'photo', 'snap'));
    },
  };
}

test('premium locked by default and forged narrative input cannot bypass the gate', async () => {
  const f = setup();
  const narrative = guardedNarrative(f);
  narrative.reachFork();
  narrative.tick(narrativeAction('choose', 'fork', 'intimate'));
  assert.equal(narrative.view().beatId, 'fork');
  assert.equal(narrative.state().relations.partner, 1);
  assert.deepEqual(narrative.state().memories, []);
  assert.equal(f.runtime.authorizeChoice({ beatId: 'fork', optionId: 'intimate' }), false);
  assert.equal(f.runtime.getChoiceAccess('fork', 'intimate').status, 'unavailable');
  await f.runtime.initialize();
  assert.equal(f.runtime.getChoiceAccess('fork', 'intimate').status, 'locked');
  assert.equal(f.runtime.authorizeChoice({ beatId: 'fork', optionId: 'connect' }), true);
});

test('persisted unlock charges once and affects neither relations nor timeline before choosing', async () => {
  const f = setup();
  await f.runtime.initialize();
  const n = guardedNarrative(f);
  n.reachFork();
  const before = n.state();
  const receipt = await f.runtime.unlockChoice('fork', 'intimate');
  assert.equal(receipt.applied, true);
  assert.equal(f.runtime.getChoiceAccess('fork', 'intimate').status, 'unlocked');
  assert.equal(f.persisted().balance, 8);
  assert.strictEqual(n.state(), before);
  n.tick(narrativeAction('choose', 'fork', 'intimate'));
  assert.equal(n.state().relations.partner, 3);
  assert.equal(n.state().flags.tender, true);
  assert.deepEqual(n.state().memories, ['private_night']);
  assert.equal(n.view().beatId, 'bridge_intro');
  n.tick(narrativeAction('next', 'bridge_intro'));
  assert.equal(n.view().beatId, 'spark_echo');
  n.tick('narrative:back');
  n.tick('narrative:back');
  assert.equal(n.view().beatId, 'fork');
  assert.deepEqual(n.state().memories, []);
  n.tick(narrativeAction('choose', 'fork', 'intimate'));
  assert.equal(n.state().relations.partner, 3);
  assert.equal(f.persisted().balance, 8);
  assert.equal((await f.runtime.unlockChoice('fork', 'intimate')).applied, false);
  assert.equal(f.persisted().journal.filter(x => x.type === 'UNLOCK_PREMIUM').length, 1);
});

test('concurrent unlock requests serialize and debit just once, including after reload', async () => {
  const f = setup();
  await f.runtime.initialize();
  const [a, b] = await Promise.all([
    f.runtime.unlockChoice('fork', 'intimate'), f.runtime.unlockChoice('fork', 'intimate'),
  ]);
  assert.deepEqual([a.applied, b.applied], [true, false]);
  assert.equal(f.persisted().balance, 8);
  const second = createEconomyRuntime({ config: f.config, graph: f.graph, manifest: f.manifest, storage: f.storage });
  await second.initialize();
  assert.equal(second.authorizeChoice({ beatId: 'fork', optionId: 'intimate' }), true);
  assert.equal((await second.unlockChoice('fork', 'intimate')).applied, false);
  assert.equal(f.persisted().balance, 8);
});

test('failed and ambiguous durable saves never authorize an unacknowledged spend', async () => {
  for (const saveBehavior of ['reject', 'false', 'ambiguous']) {
    const f = setup({ saveBehavior });
    await f.runtime.initialize();
    await assert.rejects(f.runtime.unlockChoice('fork', 'intimate'));
    assert.equal(f.runtime.authorizeChoice({ beatId: 'fork', optionId: 'intimate' }), false);
    assert.equal(f.runtime.getChoiceAccess('fork', 'intimate').status, 'unavailable');
  }
});

test('ambiguous save is reloaded and reconciled so retry cannot charge twice', async () => {
  const f = setup({ saveBehavior: 'ambiguous' });
  await f.runtime.initialize();
  await assert.rejects(f.runtime.unlockChoice('fork', 'intimate'));
  assert.equal(f.persisted().balance, 8);
  assert.equal((await f.runtime.unlockChoice('fork', 'intimate')).applied, false);
  assert.equal(f.persisted().balance, 8);
});

test('missing storage, corrupt loaded state, insufficient funds and unacknowledged init fail closed', async () => {
  const f = setup({ startingCrystals: 0 });
  await f.runtime.initialize();
  await assert.rejects(f.runtime.unlockChoice('fork', 'intimate'), { code: 'INSUFFICIENT_FUNDS' });
  assert.equal(f.runtime.getChoiceAccess('fork', 'intimate').status, 'locked');
  assert.equal(f.persisted().balance, 0);
  const absent = createEconomyRuntime({ config: f.config, graph: f.graph, manifest: f.manifest });
  await assert.rejects(absent.initialize());
  assert.equal(absent.authorizeChoice({ beatId: 'fork', optionId: 'intimate' }), false);
  const corrupt = createEconomyRuntime({ config: f.config, graph: f.graph, manifest: f.manifest,
    storage: { load: async () => ({ balance: 99999 }), save: async () => true } });
  await assert.rejects(corrupt.initialize());
  const notSaved = createEconomyRuntime({ config: f.config, graph: f.graph, manifest: f.manifest,
    storage: { load: async () => null, save: async () => undefined } });
  await assert.rejects(notSaved.initialize());
});

test('disabled economy does not use storage or block historical narrative behavior', async () => {
  const f = fixture({ enabled: false });
  const manifest = definePremiumManifest(f.rawManifest, { graph: f.graph, economyConfig: f.config });
  const runtime = createEconomyRuntime({ config: f.config, manifest,
    storage: { load: () => { throw new Error('must not load'); }, save: () => { throw new Error('must not save'); } } });
  await runtime.initialize();
  assert.equal(runtime.authorizeChoice({ beatId: 'fork', optionId: 'intimate' }), true);
  const n = guardedNarrative({ ...f, runtime });
  n.reachFork();
  n.tick(narrativeAction('choose', 'fork', 'intimate'));
  assert.equal(n.state().relations.partner, 3);
  assert.equal(runtime.getView().enabled, false);
});

test('runtime refuses an old graph manifest and guarded update rejects a graph replacement', async () => {
  const f = setup();
  const replaced = structuredClone(f.graph);
  replaced.scenes[0].beats.find(beat => beat.id === 'fork')
    .choices.find(choice => choice.id === 'intimate').id = 'private_now';
  assert.throws(() => createEconomyRuntime({ config: f.config, manifest: f.manifest,
    graph: replaced, storage: f.storage }), /graph|manifest/i);
  assert.throws(() => createNarrativeRuntimeUpdate({ graph: replaced, catalog: f.catalog,
    authorizeChoice: f.runtime.authorizeChoice }), /graph|manifest/i);
  assert.throws(() => createEconomyRuntime({ config: f.config, manifest: f.manifest,
    storage: f.storage }), /graph|manifest/i, 'enabled games must specify their active graph');
});

test('dispose during a deferred empty load cannot start a zero-wallet save', async () => {
  const f = fixture();
  const manifest = definePremiumManifest(f.rawManifest, { graph: f.graph, economyConfig: f.config });
  let finishLoad;
  let saveCount = 0;
  const runtime = createEconomyRuntime({ config: f.config, manifest, graph: f.graph,
    storage: {
      load: () => new Promise(resolve => { finishLoad = resolve; }),
      async save() { saveCount++; return true; },
    },
  });
  const initialization = runtime.initialize();
  await new Promise(resolve => setImmediate(resolve));
  runtime.dispose();
  finishLoad(null);
  await assert.rejects(initialization, /disposed/i);
  assert.equal(saveCount, 0);
});
