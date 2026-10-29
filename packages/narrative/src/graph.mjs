import { jsonCopy, fields, id, localized, freezeDeep, unique, validateEffects } from './validate.mjs';

export function validatePredicate(predicate) {
  if (predicate === undefined) return;
  fields(predicate, ['all','any','not','flag','memory','album','routeIntent','routeLock','relation'], [], 'predicate');
  const keys = Object.keys(predicate);
  if (keys.length !== 1) throw new TypeError('predicate: expected exactly one operator');
  const operator = keys[0];
  const value = predicate[operator];
  if (operator === 'all' || operator === 'any') {
    if (!Array.isArray(value) || !value.length) throw new TypeError('predicate: nonempty children required');
    value.forEach(validatePredicate);
  } else if (operator === 'not') validatePredicate(value);
  else if (operator === 'relation') {
    fields(value, ['id', 'gte', 'lte'], ['id'], 'relation predicate');
    id(value.id, 'relation ID');
    if (!Object.hasOwn(value, 'gte') && !Object.hasOwn(value, 'lte')) throw new TypeError('relation predicate requires bounds');
    for (const field of ['gte', 'lte']) if (Object.hasOwn(value, field) &&
      (!Number.isSafeInteger(value[field]) || Math.abs(value[field]) > 100)) throw new TypeError('relation predicate: invalid bound');
  } else if (operator === 'flag') {
    if (typeof value === 'string') id(value, 'flag ID');
    else { fields(value, ['id', 'value'], ['id', 'value'], 'flag predicate'); id(value.id, 'flag ID');
      if (typeof value.value !== 'boolean') throw new TypeError('flag predicate: boolean required'); }
  } else id(value, `predicate ${operator}`);
}

export function evaluateNarrativePredicate(predicate, state) {
  if (predicate === undefined) return true;
  validatePredicate(predicate);
  if (predicate.all) return predicate.all.every(p => evaluateNarrativePredicate(p, state));
  if (predicate.any) return predicate.any.some(p => evaluateNarrativePredicate(p, state));
  if (predicate.not) return !evaluateNarrativePredicate(predicate.not, state);
  if (predicate.flag) return state.flags[typeof predicate.flag === 'string' ? predicate.flag : predicate.flag.id] ===
    (typeof predicate.flag === 'string' ? true : predicate.flag.value);
  if (predicate.memory) return state.memories.includes(predicate.memory);
  if (predicate.album) return state.album.includes(predicate.album);
  if (predicate.routeIntent) return state.routeIntent === predicate.routeIntent;
  if (predicate.routeLock) return state.routeLock === predicate.routeLock;
  if (predicate.relation) {
    const score = state.relations[predicate.relation.id] ?? 0;
    return (!Object.hasOwn(predicate.relation, 'gte') || score >= predicate.relation.gte) &&
      (!Object.hasOwn(predicate.relation, 'lte') || score <= predicate.relation.lte);
  }
  return false;
}

export function defineNarrativeGraph(raw) {
  const graph = jsonCopy(raw, 'graph');
  fields(graph, ['schemaVersion','id','startSceneId','scenes'], ['schemaVersion','id','startSceneId','scenes'], 'graph');
  if (graph.schemaVersion !== 1) throw new TypeError('graph: unsupported schemaVersion');
  id(graph.id, 'graph ID');
  id(graph.startSceneId, 'startSceneId');
  if (!Array.isArray(graph.scenes) || !graph.scenes.length) throw new TypeError('graph: scenes required');
  unique(graph.scenes.map(s => s.id), 'scenes');
  const beatIds = [];
  const eventIds = new Set();
  const links = new Map();
  let endings = 0;
  for (const scene of graph.scenes) {
    fields(scene, ['id','beats','nextSceneId'], ['id','beats'], 'scene');
    id(scene.id, 'scene ID');
    if (!Array.isArray(scene.beats) || !scene.beats.length) throw new TypeError('scene: beats required');
    let sawTerminator = false;
    const destinations = [];
    for (const [index, beat] of scene.beats.entries()) {
      fields(beat, ['id','type','text','interactionId','sourceEventId','when','choices','endingId'], ['id','type'], 'beat');
      id(beat.id, 'beat ID');
      beatIds.push(beat.id);
      if (!['dialogue','choice','photo','keepsake','message','echo','ending'].includes(beat.type)) throw new TypeError('beat: unsupported type');
      if (['dialogue','echo','ending'].includes(beat.type)) { localized(beat.text, 'beat text'); }
      if (['photo','keepsake','message'].includes(beat.type)) {
        id(beat.interactionId, 'beat interactionId');
        eventIds.add(beat.id);
      }
      if (beat.type === 'echo') { id(beat.sourceEventId, 'echo sourceEventId'); validatePredicate(beat.when); }
      if (beat.type === 'choice') {
        if (!Array.isArray(beat.choices) || !beat.choices.length) throw new TypeError('choice: choices required');
        unique(beat.choices.map(c => c.id), 'scene choices');
        for (const choice of beat.choices) {
          fields(choice, ['id','label','targetSceneId','routeId','when','effects'], ['id','label','targetSceneId'], 'choice');
          id(choice.id, 'choice ID'); id(choice.targetSceneId, 'choice targetSceneId');
          if (choice.routeId !== undefined) id(choice.routeId, 'choice routeId');
          localized(choice.label, 'choice label'); validatePredicate(choice.when);
          validateEffects(choice.effects ?? [], 'choice');
          destinations.push(choice.targetSceneId);
        }
      }
      if (beat.type === 'ending') { id(beat.endingId, 'ending ID'); endings++; }
      if (['choice', 'ending'].includes(beat.type)) {
        if (index !== scene.beats.length - 1) throw new TypeError('choice/ending must terminate a scene');
        sawTerminator = true;
      }
    }
    if (scene.nextSceneId) {
      if (sawTerminator) throw new TypeError('scene nextSceneId conflicts with choice/ending');
      id(scene.nextSceneId, 'nextSceneId');
      destinations.push(scene.nextSceneId);
    } else if (!sawTerminator) throw new TypeError('non-ending scene needs choice or nextSceneId');
    links.set(scene.id, destinations);
  }
  unique(beatIds, 'beats');
  if (!graph.scenes.some(s => s.id === graph.startSceneId)) throw new TypeError('start scene missing');
  for (const scene of graph.scenes) {
    for (const target of links.get(scene.id)) if (!links.has(target)) throw new TypeError(`invalid target scene ${target}`);
    for (const beat of scene.beats) if (beat.type === 'echo' && !eventIds.has(beat.sourceEventId)) {
      throw new TypeError(`echo ${beat.id}: missing source event ${beat.sourceEventId}`);
    }
  }
  const sourcePositions = new Map(graph.scenes.flatMap(s => s.beats.flatMap((b, index) =>
    ['photo', 'keepsake', 'message'].includes(b.type) ? [[b.id, { sceneId: s.id, index }]] : [])));
  for (const scene of graph.scenes) for (const [index, beat] of scene.beats.entries()) {
    if (beat.type !== 'echo') continue;
    const source = sourcePositions.get(beat.sourceEventId);
    if (source.sceneId === scene.id && source.index >= index) {
      throw new TypeError(`echo ${beat.id}: source event must appear before the echo`);
    }
    if (source.sceneId !== scene.id) {
      const seen = new Set([source.sceneId]);
      const pending = [source.sceneId];
      while (pending.length) for (const next of links.get(pending.shift())) if (!seen.has(next)) {
        seen.add(next); pending.push(next);
      }
      if (!seen.has(scene.id)) throw new TypeError(`echo ${beat.id}: source event has no path to echo`);
    }
  }
  if (!endings) throw new TypeError('graph requires an ending');
  const reached = new Set([graph.startSceneId]);
  const queue = [graph.startSceneId];
  while (queue.length) for (const target of links.get(queue.shift())) if (!reached.has(target)) {
    reached.add(target); queue.push(target);
  }
  if (reached.size !== graph.scenes.length) throw new TypeError('graph has unreachable scenes');
  const canReachEnding = new Set(graph.scenes.filter(s => s.beats.at(-1).type === 'ending').map(s => s.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [source, destinations] of links) if (!canReachEnding.has(source) && destinations.some(target => canReachEnding.has(target))) {
      canReachEnding.add(source);
      changed = true;
    }
  }
  if (canReachEnding.size !== graph.scenes.length) throw new TypeError('graph contains dead-end scenes without an ending path');
  return freezeDeep(graph);
}

/** Explicit strict authoring gate; not every prototype or standalone scene needs a delayed callback. */
export function validateNarrativeEchoCoverage(graph) {
  const echoSources = new Set(graph.scenes.flatMap(scene => scene.beats
    .filter(beat => beat.type === 'echo').map(beat => beat.sourceEventId)));
  const missing = graph.scenes.flatMap(scene => scene.beats
    .filter(beat => ['photo','keepsake','message'].includes(beat.type) && !echoSources.has(beat.id))
    .map(beat => beat.id));
  if (missing.length) throw new TypeError(`narrative echo coverage missing: ${missing.join(', ')}`);
  return true;
}
