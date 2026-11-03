import { advanceNarrative, createNarrativeState, defineNarrativeCatalog,
  defineNarrativeGraph, resolveNarrativeView } from '@ludory/narrative';
import { assertPremiumManifest } from './manifest.mjs';

const ID = /^[a-z][a-z0-9_-]{0,63}$/;

function terminal(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${name}: object required`);
  const keys = Reflect.ownKeys(value);
  if (keys.some(k => !['endingId','routeId'].includes(k)) || !Object.hasOwn(value, 'endingId')) {
    throw new TypeError(`${name}: unexpected fields`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'string' || !ID.test(descriptor.value)) throw new TypeError(`${name}: invalid ${key}`);
  }
  return { endingId: value.endingId, ...(Object.hasOwn(value, 'routeId') ? { routeId: value.routeId } : {}) };
}

function terminalKey(value) { return `${value.endingId}:${value.routeId ?? ''}`; }

function freeGraph(graph, locked) {
  const edges = new Map();
  const endingScenes = new Set();
  for (const scene of graph.scenes) {
    const last = scene.beats.at(-1);
    if (last.type === 'ending') endingScenes.add(scene.id);
    if (last.type === 'choice') {
      const targets = last.choices.filter(c => !locked.has(`${last.id}:${c.id}`)).map(c => c.targetSceneId);
      if (!targets.length) throw new TypeError(`choice beat ${last.id} has no free choice`);
      edges.set(scene.id, targets);
    } else edges.set(scene.id, scene.nextSceneId ? [scene.nextSceneId] : []);
  }
  const reached = new Set([graph.startSceneId]);
  const queue = [graph.startSceneId];
  while (queue.length) for (const next of edges.get(queue.shift())) if (!reached.has(next)) {
    reached.add(next); queue.push(next);
  }
  const canFinish = new Set(endingScenes);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [sceneId, targets] of edges) if (!canFinish.has(sceneId) && targets.some(t => canFinish.has(t))) {
      canFinish.add(sceneId); grew = true;
    }
  }
  for (const sceneId of reached) if (!canFinish.has(sceneId)) {
    throw new TypeError(`free-reachable scene ${sceneId} has no free ending path`);
  }
  return { reached, endingScenes };
}

/** Proves only the explicitly declared traces and conservative static free reachability. */
export function verifyFreeNarrativePaths({ graph: rawGraph, catalog: rawCatalog, manifest: rawManifest,
  terminals: rawTerminals, traces: rawTraces } = {}) {
  const graph = defineNarrativeGraph(rawGraph);
  const catalog = defineNarrativeCatalog(rawCatalog);
  const manifest = assertPremiumManifest(rawManifest);
  const authoredChoiceKeys = new Set(graph.scenes.flatMap(scene => scene.beats
    .filter(beat => beat.type === 'choice')
    .flatMap(beat => beat.choices.map(choice => `${beat.id}:${choice.id}`))));
  if (manifest.choices.some(choice => !authoredChoiceKeys.has(`${choice.beatId}:${choice.choiceId}`))) {
    throw new TypeError('stale premium manifest has unknown premium choice in this graph');
  }
  const locked = new Set(manifest.choices.map(c => `${c.beatId}:${c.choiceId}`));
  const structure = freeGraph(graph, locked);
  if (!Array.isArray(rawTerminals) || !rawTerminals.length || rawTerminals.length > 128 ||
      !Array.isArray(rawTraces) || rawTraces.length !== rawTerminals.length) {
    throw new TypeError('each intended free terminal needs exactly one trace');
  }
  const knownEndings = new Set(graph.scenes.flatMap(scene => scene.beats.at(-1).type === 'ending'
    ? [scene.beats.at(-1).endingId] : []));
  const targets = rawTerminals.map((item, index) => terminal(item, `terminal ${index}`));
  const unique = new Set(targets.map(terminalKey));
  if (unique.size !== targets.length || targets.some(target => !knownEndings.has(target.endingId))) {
    throw new TypeError('duplicate or unknown intended free terminal');
  }
  const proofs = new Map();
  for (const [index, rawTrace] of rawTraces.entries()) {
    if (!rawTrace || typeof rawTrace !== 'object' || Array.isArray(rawTrace) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(rawTrace))) throw new TypeError('trace must be an object');
    const expected = terminal({ endingId: rawTrace.endingId,
      ...(Object.hasOwn(rawTrace, 'routeId') ? { routeId: rawTrace.routeId } : {}) }, `trace ${index}`);
    const key = terminalKey(expected);
    if (!unique.has(key) || proofs.has(key) ||
        Reflect.ownKeys(rawTrace).some(field => !['endingId','routeId','actions'].includes(field))) {
      throw new TypeError('trace must have a unique declared free terminal');
    }
    if (!Array.isArray(rawTrace.actions) || !rawTrace.actions.length || rawTrace.actions.length > 10000) {
      throw new TypeError('trace actions must be a nonempty bounded list');
    }
    let state = createNarrativeState(graph);
    for (const [step, action] of rawTrace.actions.entries()) {
      if (action?.type === 'choose') {
        // The Narrative engine permits an omitted beatId; resolve the canonical
        // current beat instead of trusting the witness action's optional field.
        const view = resolveNarrativeView(graph, catalog, state);
        if (view.type === 'choice' && locked.has(`${view.beatId}:${action.optionId}`)) {
          throw new TypeError(`trace ${index} step ${step} uses a premium choice`);
        }
      }
      try { state = advanceNarrative(graph, catalog, state, action).state; }
      catch (error) { throw new TypeError(`invalid free trace ${index} step ${step}: ${error.message}`); }
    }
    const view = resolveNarrativeView(graph, catalog, state);
    if (view.type !== 'ending' || view.endingId !== expected.endingId ||
        (expected.routeId !== undefined && state.routeLock !== expected.routeId)) {
      throw new TypeError(`trace ${index} did not reach declared free ending/route`);
    }
    proofs.set(key, Object.freeze({ ...expected, actionCount: rawTrace.actions.length }));
  }
  if (proofs.size !== targets.length) throw new TypeError('missing intended free terminal trace');
  return Object.freeze({ structuralFreeScenes: structure.reached.size,
    proven: Object.freeze(targets.map(item => proofs.get(terminalKey(item)))) });
}
