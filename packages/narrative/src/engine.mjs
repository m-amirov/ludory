import { jsonCopy, fields, id, isObject, unique } from './validate.mjs';
import { evaluateNarrativePredicate } from './graph.mjs';

const STATE_FIELDS = [
  'schemaVersion', 'sceneId', 'beatIndex', 'relations', 'flags', 'routeIntent', 'routeLock',
  'memories', 'album', 'keepsakes', 'messages', 'completedEvents', 'completedEchoes', 'visitedScenes', 'actionLog',
];

const sceneById = (graph, sceneId) => graph.scenes.find(s => s.id === sceneId);
const interactionById = (catalog, interactionId) => catalog.interactions.find(i => i.id === interactionId);
const currentBeat = (graph, state) => sceneById(graph, state.sceneId)?.beats[state.beatIndex];

export function assertNarrativeReferences(graph, catalog) {
  const used = [];
  for (const scene of graph.scenes) for (const beat of scene.beats) {
    if (['photo','keepsake','message'].includes(beat.type)) {
      const interaction = interactionById(catalog, beat.interactionId);
      if (!interaction || interaction.type !== beat.type) throw new TypeError(`beat ${beat.id}: unresolved interaction`);
      used.push(beat.interactionId);
    }
  }
  return used;
}

export function createNarrativeState(graph) {
  const state = {
    schemaVersion: 1, sceneId: graph.startSceneId, beatIndex: 0, relations: {}, flags: {},
    routeIntent: null, routeLock: null, memories: [], album: [], keepsakes: [], messages: [],
    completedEvents: [], completedEchoes: [], visitedScenes: [graph.startSceneId], actionLog: [],
  };
  return jsonCopy(state);
}

function validStateIds(catalog, graph) {
  const possible = { album: new Set(), keepsakes: new Set(), memories: new Set(), routes: new Set() };
  for (const interaction of catalog.interactions) {
    const options = interaction.options ?? interaction.variants;
    for (const option of options) for (const effect of option.effects) {
      if (effect.op === 'album_add') possible.album.add(effect.id);
      if (effect.op === 'keepsake_add') possible.keepsakes.add(effect.id);
      if (effect.op === 'memory_add') possible.memories.add(effect.id);
      if (['route_lock','route_intent'].includes(effect.op)) possible.routes.add(effect.id);
    }
  }
  for (const scene of graph.scenes) for (const beat of scene.beats) {
    if (beat.type === 'choice') for (const choice of beat.choices) for (const effect of choice.effects ?? []) {
      if (effect.op === 'album_add') possible.album.add(effect.id);
      if (effect.op === 'keepsake_add') possible.keepsakes.add(effect.id);
      if (effect.op === 'memory_add') possible.memories.add(effect.id);
      if (['route_lock','route_intent'].includes(effect.op)) possible.routes.add(effect.id);
    }
  }
  return possible;
}

function sameJson(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]));
  }
  const a = Object.keys(left).sort();
  const b = Object.keys(right).sort();
  return a.length === b.length && a.every((key, i) => key === b[i] && sameJson(left[key], right[key]));
}

export function validateNarrativeState(graph, catalog, raw) {
  assertNarrativeReferences(graph, catalog);
  const state = jsonCopy(raw, 'narrative state');
  fields(state, STATE_FIELDS, STATE_FIELDS, 'narrative state');
  if (state.schemaVersion !== 1 || !sceneById(graph, state.sceneId)) throw new TypeError('state: invalid scene or schemaVersion');
  if (!Number.isSafeInteger(state.beatIndex) || state.beatIndex < 0 ||
    state.beatIndex >= sceneById(graph, state.sceneId).beats.length) throw new TypeError('state: invalid beatIndex');
  for (const [name, map, kind] of [['relations', state.relations, 'number'], ['flags', state.flags, 'boolean']]) {
    if (!isObject(map)) throw new TypeError(`state: invalid ${name}`);
    for (const [key, value] of Object.entries(map)) {
      id(key, `${name} key`);
      if (kind === 'number' ? !Number.isSafeInteger(value) || Math.abs(value) > 100 : typeof value !== 'boolean') {
        throw new TypeError(`state: invalid ${name} value`);
      }
    }
  }
  for (const route of ['routeIntent', 'routeLock']) if (state[route] !== null) id(state[route], route);
  const possible = validStateIds(catalog, graph);
  for (const name of ['memories', 'album', 'keepsakes', 'completedEvents', 'completedEchoes', 'visitedScenes']) {
    if (!Array.isArray(state[name])) throw new TypeError(`state: ${name} must be array`);
    state[name].forEach(value => id(value, `${name} ID`));
    unique(state[name], `state ${name}`);
  }
  for (const name of ['memories','album','keepsakes']) for (const value of state[name]) if (!possible[name].has(value)) {
    throw new TypeError(`state: unknown ${name} ID`);
  }
  if ((state.routeIntent !== null && !possible.routes.has(state.routeIntent)) ||
      (state.routeLock !== null && !possible.routes.has(state.routeLock))) throw new TypeError('state: unknown route');
  const beatTypes = new Map(graph.scenes.flatMap(s => s.beats.map(b => [b.id, b.type])));
  for (const value of state.completedEvents) if (!['photo','keepsake','message'].includes(beatTypes.get(value))) throw new TypeError('state: unknown event ID');
  for (const value of state.completedEchoes) if (beatTypes.get(value) !== 'echo') throw new TypeError('state: unknown echo ID');
  for (const value of state.visitedScenes) if (!sceneById(graph, value)) throw new TypeError('state: unknown visited scene');
  if (!state.visitedScenes.includes(state.sceneId) || !state.visitedScenes.includes(graph.startSceneId)) {
    throw new TypeError('state: missing visited scene');
  }
  if (!Array.isArray(state.messages)) throw new TypeError('state: invalid messages');
  for (const msg of state.messages) {
    fields(msg, ['interactionId','variantId','recipient','intent','tone','attachmentId','reply'],
      ['interactionId','variantId','recipient','intent','tone','reply'], 'state message');
    const interaction = interactionById(catalog, msg.interactionId);
    const variant = interaction?.type === 'message' && interaction.variants.find(v => v.id === msg.variantId);
    if (!variant || msg.recipient !== variant.recipient || msg.intent !== variant.intent || msg.tone !== variant.tone ||
      (msg.attachmentId ?? null) !== (variant.attachmentId ?? null) ||
      JSON.stringify(msg.reply) !== JSON.stringify(variant.reply)) throw new TypeError('state: invalid message variant');
  }
  if (!Array.isArray(state.actionLog) || state.actionLog.length > 10000) throw new TypeError('state: invalid actionLog');
  const replay = createNarrativeState(graph);
  for (const action of state.actionLog) {
    fields(action, ['type','beatId','optionId'], ['type','beatId'], 'state actionLog item');
    id(action.beatId, 'state actionLog beatId');
    if (action.optionId !== undefined) id(action.optionId, 'state actionLog optionId');
    const result = performNarrativeAction(graph, catalog, replay, action);
    if (result.eventId !== action.beatId) throw new TypeError('state: inconsistent actionLog event');
    replay.actionLog.push(action);
  }
  if (!sameJson(replay, state)) throw new TypeError('state: inconsistent actionLog provenance or position');
  return state;
}

function applyEffects(state, effects) {
  for (const effect of effects) {
    switch (effect.op) {
      case 'relation_delta': {
        const next = Math.max(-100, Math.min(100, (state.relations[effect.id] ?? 0) + effect.value));
        state.relations[effect.id] = next;
        break;
      }
      case 'flag_set': state.flags[effect.id] = effect.value; break;
      case 'memory_add': if (!state.memories.includes(effect.id)) state.memories.push(effect.id); break;
      case 'album_add': if (!state.album.includes(effect.id)) state.album.push(effect.id); break;
      case 'keepsake_add': if (!state.keepsakes.includes(effect.id)) state.keepsakes.push(effect.id); break;
      case 'route_intent': state.routeIntent = effect.id; break;
      case 'route_lock':
        if (state.routeLock !== null && state.routeLock !== effect.id) throw new TypeError('route already locked');
        state.routeLock = effect.id;
        break;
      default: throw new TypeError(`unknown effect ${effect.op}`);
    }
  }
}

function availableMessageVariants(interaction, state) {
  return interaction.variants.filter(v => evaluateNarrativePredicate(v.when, state) &&
    (!v.attachmentId || state.album.includes(v.attachmentId) || state.keepsakes.includes(v.attachmentId)));
}

function positionAtNextBeat(graph, state) {
  // Only skip non-eligible authored echoes; never silently skip real player actions.
  for (let count = 0; count <= graph.scenes.length * 2 + 1000; count++) {
    const scene = sceneById(graph, state.sceneId);
    if (state.beatIndex >= scene.beats.length) {
      if (!scene.nextSceneId) throw new TypeError('scene has no next transition');
      state.sceneId = scene.nextSceneId;
      state.beatIndex = 0;
      if (!state.visitedScenes.includes(state.sceneId)) state.visitedScenes.push(state.sceneId);
      continue;
    }
    const beat = scene.beats[state.beatIndex];
    if (['photo','keepsake','message'].includes(beat.type) && state.completedEvents.includes(beat.id)) {
      state.beatIndex++;
      continue;
    }
    if (beat.type === 'echo' && (!state.completedEvents.includes(beat.sourceEventId) ||
      !evaluateNarrativePredicate(beat.when, state) || state.completedEchoes.includes(beat.id))) {
      state.beatIndex++;
      continue;
    }
    return state;
  }
  throw new TypeError('automatic narrative transition loop');
}

export function resolveNarrativeView(graph, catalog, rawState, locale = 'ru') {
  if (!['ru','en'].includes(locale)) throw new TypeError('unsupported locale');
  const state = validateNarrativeState(graph, catalog, rawState);
  positionAtNextBeat(graph, state);
  const beat = currentBeat(graph, state);
  const view = { sceneId: state.sceneId, beatId: beat.id, type: beat.type };
  if (beat.text) view.text = beat.text[locale];
  if (beat.endingId) view.endingId = beat.endingId;
  if (beat.type === 'choice') {
    view.choices = beat.choices.filter(c => evaluateNarrativePredicate(c.when, state) &&
      (!state.routeLock || ((c.routeId === undefined || c.routeId === state.routeLock) &&
        !(c.effects ?? []).some(e => e.op === 'route_lock' && e.id !== state.routeLock))))
      .map(c => ({ id: c.id, label: c.label[locale] }));
  }
  if (['photo','keepsake','message'].includes(beat.type)) {
    const interaction = interactionById(catalog, beat.interactionId);
    view.label = interaction.label[locale];
    if (beat.type === 'message') view.variants = availableMessageVariants(interaction, state).map(v => ({
      id: v.id, recipient: v.recipient, intent: v.intent, tone: v.tone,
      attachmentId: v.attachmentId ?? null, preview: v.preview[locale], reply: v.reply[locale],
    }));
    else view.options = interaction.options.map(o => ({ id: o.id, label: o.label[locale], assetId: o.assetId ?? null }));
  }
  return view;
}

function performNarrativeAction(graph, catalog, state, action) {
  positionAtNextBeat(graph, state);
  const beat = currentBeat(graph, state);
  if (action.beatId && action.beatId !== beat.id) throw new TypeError('action beat mismatch');
  if (beat.type === 'ending') throw new TypeError('ending cannot advance');
  if (['dialogue','echo'].includes(beat.type)) {
    if (action.type !== 'next' || action.optionId !== undefined) throw new TypeError('expected next');
    if (beat.type === 'echo') state.completedEchoes.push(beat.id);
    state.beatIndex++;
  } else if (beat.type === 'choice') {
    if (action.type !== 'choose') throw new TypeError('expected choice');
    const choice = beat.choices.find(c => c.id === action.optionId && evaluateNarrativePredicate(c.when, state) &&
      (!state.routeLock || ((c.routeId === undefined || c.routeId === state.routeLock) &&
        !(c.effects ?? []).some(e => e.op === 'route_lock' && e.id !== state.routeLock))));
    if (!choice) throw new TypeError('unavailable choice');
    applyEffects(state, choice.effects ?? []);
    state.sceneId = choice.targetSceneId;
    state.beatIndex = 0;
    if (!state.visitedScenes.includes(state.sceneId)) state.visitedScenes.push(state.sceneId);
  } else {
    if (action.type !== 'interact') throw new TypeError('expected interaction option');
    const interaction = interactionById(catalog, beat.interactionId);
    const option = beat.type === 'message' ? availableMessageVariants(interaction, state).find(v => v.id === action.optionId) :
      interaction.options.find(o => o.id === action.optionId);
    if (!option) throw new TypeError('unavailable interaction option or attachment');
    applyEffects(state, option.effects);
    if (beat.type === 'message') {
      state.messages.push({ interactionId: interaction.id, variantId: option.id, recipient: option.recipient,
        intent: option.intent, tone: option.tone, ...(option.attachmentId ? { attachmentId: option.attachmentId } : {}),
        reply: jsonCopy(option.reply) });
    }
    state.completedEvents.push(beat.id);
    state.beatIndex++;
  }
  positionAtNextBeat(graph, state);
  return { eventId: beat.id };
}

export function advanceNarrative(graph, catalog, rawState, rawAction) {
  const state = validateNarrativeState(graph, catalog, rawState);
  const action = jsonCopy(rawAction, 'action');
  fields(action, ['type','beatId','optionId'], ['type'], 'action');
  if (action.beatId !== undefined) id(action.beatId, 'action beatId');
  if (action.optionId !== undefined) id(action.optionId, 'action optionId');
  if (action.type === 'interact' && action.beatId && state.completedEvents.includes(action.beatId)) {
    return { state, receipt: { eventId: action.beatId, duplicate: true } };
  }
  const { eventId } = performNarrativeAction(graph, catalog, state, action);
  state.actionLog.push({ type: action.type, beatId: eventId,
    ...(action.optionId === undefined ? {} : { optionId: action.optionId }) });
  return { state: validateNarrativeState(graph, catalog, state), receipt: { eventId, duplicate: false } };
}

export function buildNarrativeJournal(graph, catalog, rawState, locale = 'ru') {
  if (!['ru','en'].includes(locale)) throw new TypeError('unsupported locale');
  const state = validateNarrativeState(graph, catalog, rawState);
  return {
    memories: [...state.memories], album: [...state.album], keepsakes: [...state.keepsakes],
    messages: state.messages.map(m => ({ recipient: m.recipient, intent: m.intent,
      tone: m.tone, reply: m.reply[locale] })),
  };
}
