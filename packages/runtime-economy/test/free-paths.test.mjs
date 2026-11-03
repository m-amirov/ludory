import test from 'node:test';
import assert from 'node:assert/strict';
import { defineNarrativeGraph } from '@ludory/narrative';
import { definePremiumManifest, verifyFreeNarrativePaths } from '../src/index.mjs';
import { fixture } from './fixture.mjs';

function validInput() {
  const f = fixture();
  const manifest = definePremiumManifest(f.rawManifest, { graph: f.graph, economyConfig: f.config });
  return { ...f, manifest, terminals: [{ endingId: 'good', routeId: 'partner' }], traces: [f.freeTrace] };
}

test('a free authored trace proves a good ending and a route lock without paying', () => {
  const data = validInput();
  const result = verifyFreeNarrativePaths(data);
  assert.deepEqual(result.proven, [{ endingId: 'good', routeId: 'partner', actionCount: 5 }]);
  assert.equal(result.structuralFreeScenes, 4);
});

test('independent free solo trace can be declared alongside the good ending', () => {
  const data = validInput();
  const solo = { endingId: 'solo', actions: [
    { type: 'next', beatId: 'intro' },
    { type: 'interact', beatId: 'photo', optionId: 'skip' },
    { type: 'choose', beatId: 'fork', optionId: 'leave' },
  ] };
  const result = verifyFreeNarrativePaths({ ...data,
    terminals: [...data.terminals, { endingId: 'solo' }], traces: [...data.traces, solo],
  });
  assert.deepEqual(result.proven.map(p => p.endingId), ['good', 'solo']);
});

test('a paid choice can never serve as a free good-ending witness', () => {
  const data = validInput();
  const premiumTrace = structuredClone(data.freeTrace);
  premiumTrace.actions[2].optionId = 'intimate';
  assert.throws(() => verifyFreeNarrativePaths({ ...data, traces: [premiumTrace] }), /premium/i);
});

test('a premium choice cannot evade a free witness by omitting the optional beatId', () => {
  const data = validInput();
  const premiumTrace = structuredClone(data.freeTrace);
  premiumTrace.actions[2] = { type: 'choose', optionId: 'intimate' };
  premiumTrace.actions.splice(4, 0, { type: 'next', beatId: 'spark_echo' });
  assert.throws(() => verifyFreeNarrativePaths({ ...data, traces: [premiumTrace] }), /premium|beatId/i);
});

test('unvalidated caller-crafted manifest cannot bypass declared premium gates', () => {
  const data = validInput();
  assert.throws(() => verifyFreeNarrativePaths({ ...data, manifest: { schemaVersion: 1, choices: [] } }), TypeError);
});

test('a sidecar referring to a choice removed from the current graph cannot be treated as valid', () => {
  const data = validInput();
  const changed = structuredClone(data.graph);
  changed.scenes[0].beats.find(b => b.id === 'fork').choices.find(c => c.id === 'intimate').id = 'private_now';
  const graph = defineNarrativeGraph(changed);
  assert.throws(() => verifyFreeNarrativePaths({ ...data, graph }), /stale.*manifest|unknown.*premium/i);
});

test('bad trace, incorrect ending/route, unsatisfied predicate and absent witnesses fail', () => {
  const data = validInput();
  const invalid = [
    { traces: [{ ...data.freeTrace, endingId: 'solo' }] },
    { traces: [{ ...data.freeTrace, routeId: 'other' }] },
    { traces: [{ ...data.freeTrace, actions: data.freeTrace.actions.map((a, i) =>
      i === 1 ? { ...a, optionId: 'skip' } : a) }] },
    { traces: [{ ...data.freeTrace, actions: [...data.freeTrace.actions, { type: 'choose', beatId: 'fake', optionId: 'stay' }] }] },
    { traces: [{ ...data.freeTrace, actions: data.freeTrace.actions.slice(0, -1) }] },
    { traces: [] },
    { terminals: [{ endingId: 'unknown' }] },
    { terminals: [...data.terminals, { endingId: 'solo' }] },
  ];
  for (const override of invalid) {
    assert.throws(() => verifyFreeNarrativePaths({ ...data, ...override }), TypeError);
  }
});

test('removing paid edges detects free-reachable dead ends even if original graph is valid', () => {
  const data = validInput();
  const raw = structuredClone(data.graph);
  const choice = raw.scenes.find(s => s.id === 'bridge').beats.find(b => b.id === 'bridge_choice');
  choice.choices.find(c => c.id === 'walk').targetSceneId = 'bridge';
  const graph = defineNarrativeGraph(raw);
  const rawManifest = { schemaVersion: 1, choices: [...data.rawManifest.choices,
    { beatId: 'bridge_choice', choiceId: 'stay', contentId: 'private_time' },
  ] };
  const manifest = definePremiumManifest(rawManifest, { graph, economyConfig: data.config });
  assert.throws(() => verifyFreeNarrativePaths({ ...data, graph, manifest }), /free.*ending|dead.end/i);
});
