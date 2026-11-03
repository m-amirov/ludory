import { defineEconomy } from '@ludory/economy';
import { defineNarrativeGraph } from '@ludory/narrative';

const TOKEN = /^[a-z][a-z0-9_-]{0,63}$/;
const issuedManifests = new WeakSet();
const manifestGraphs = new WeakMap();

export function assertPremiumManifest(value) {
  if (!value || typeof value !== 'object' || !issuedManifests.has(value)) {
    throw new TypeError('premium manifest must be defined with definePremiumManifest');
  }
  return value;
}

/** A sidecar is valid only for the exact authored graph it was reviewed against. */
export function assertPremiumManifestGraph(manifest, rawGraph) {
  assertPremiumManifest(manifest);
  const graph = defineNarrativeGraph(rawGraph);
  if (manifestGraphs.get(manifest) !== JSON.stringify(graph)) {
    throw new TypeError('premium manifest does not match the active narrative graph');
  }
  return graph;
}

function dataObject(value, fields, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${name} must be a plain object`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
    throw new TypeError(`${name} has missing or unexpected fields`);
  }
  const result = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} must be a data value`);
    result[key] = descriptor.value;
  }
  return result;
}

function validId(value, name) {
  if (typeof value !== 'string' || !TOKEN.test(value)) throw new TypeError(`${name} must be a safe ID`);
  return value;
}

export function definePremiumManifest(raw, { graph: rawGraph, economyConfig: rawConfig } = {}) {
  const config = defineEconomy(rawConfig);
  const graph = defineNarrativeGraph(rawGraph);
  const input = dataObject(raw, ['schemaVersion', 'choices'], 'premium manifest');
  if (input.schemaVersion !== 1) throw new TypeError('unsupported premium manifest version');
  if (!Array.isArray(input.choices) || input.choices.length > 1024) throw new TypeError('premium choices must be a bounded array');
  const authored = new Map();
  for (const scene of graph.scenes) for (const beat of scene.beats) if (beat.type === 'choice') {
    authored.set(beat.id, new Set(beat.choices.map(choice => choice.id)));
  }
  const seen = new Set();
  const choices = input.choices.map(rawChoice => {
    const choice = dataObject(rawChoice, ['beatId','choiceId','contentId'], 'premium choice');
    const beatId = validId(choice.beatId, 'premium beatId');
    const choiceId = validId(choice.choiceId, 'premium choiceId');
    const contentId = validId(choice.contentId, 'premium contentId');
    if (!authored.get(beatId)?.has(choiceId)) throw new TypeError(`unknown authored premium choice ${beatId}:${choiceId}`);
    const key = `${beatId}:${choiceId}`;
    if (seen.has(key)) throw new TypeError(`duplicate premium choice ${key}`);
    seen.add(key);
    if (!Object.hasOwn(config.premium, contentId)) throw new TypeError(`unknown premium content ${contentId}`);
    return Object.freeze({ beatId, choiceId, contentId, cost: config.premium[contentId].cost });
  });
  for (const [beatId, options] of authored) {
    if ([...options].every(choiceId => seen.has(`${beatId}:${choiceId}`))) {
      throw new TypeError(`choice beat ${beatId} has no free choice`);
    }
  }
  const manifest = Object.freeze({ schemaVersion: 1, choices: Object.freeze(choices) });
  issuedManifests.add(manifest);
  manifestGraphs.set(manifest, JSON.stringify(graph));
  return manifest;
}
