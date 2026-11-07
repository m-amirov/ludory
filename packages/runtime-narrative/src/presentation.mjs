import { evaluateNarrativePredicate, validatePredicate } from '@ludory/narrative';

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const ART_PATH = /^assets\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.(?:png|webp|jpg|jpeg)$/;
const MEDIA_KINDS = ['background', 'portrait', 'cg'];
const SLOTS = ['left', 'center', 'right'];
const CG_MODES = ['replace-stage', 'overlay'];
const validated = new WeakSet();

// Authored input must be JSON-like. Never invoke accessors, custom prototypes or toJSON.
function safeCopy(value, label = 'presentation', ancestors = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') throw new TypeError(`${label}: non-JSON value`);
  if (ancestors.has(value)) throw new TypeError(`${label}: cyclic object`);
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError(`${label}: non-plain object`);
  }
  ancestors.add(value);
  const result = array ? [] : Object.create(null);
  const keys = Reflect.ownKeys(value);
  if (array && (keys.length !== value.length + 1 ||
    Array.from({ length: value.length }, (_, i) => String(i)).some(key => !Object.hasOwn(value, key)))) {
    throw new TypeError(`${label}: sparse or unusual array`);
  }
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new TypeError(`${label}: unsafe key`);
    }
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc?.enumerable || !Object.hasOwn(desc, 'value')) throw new TypeError(`${label}: accessor or hidden property`);
    result[key] = safeCopy(desc.value, `${label}.${key}`, ancestors);
  }
  ancestors.delete(value);
  return result;
}

function exactFields(value, allowed, required, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label}: expected object`);
  }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`${label}: unexpected ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}: missing ${key}`);
}

function checkId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${label}: invalid ID`);
}

function localized(value, label) {
  exactFields(value, ['ru', 'en'], ['ru', 'en'], label);
  for (const locale of ['ru', 'en']) {
    if (typeof value[locale] !== 'string' || !value[locale].trim()) throw new TypeError(`${label}: empty ${locale}`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Validate an optional, artwork-only mapping separate from graph/state v1. */
export function defineNarrativePresentation(graph, raw) {
  const source = safeCopy(raw);
  exactFields(source, ['schemaVersion', 'media', 'beats'], ['schemaVersion', 'media', 'beats'], 'presentation');
  if (source.schemaVersion !== 1) throw new TypeError('presentation: unsupported schemaVersion');
  exactFields(source.media, Object.keys(source.media), [], 'presentation media');
  exactFields(source.beats, Object.keys(source.beats), [], 'presentation beats');
  const validBeats = new Set(graph.scenes.flatMap(scene => scene.beats.map(beat => beat.id)));

  for (const [mediaId, media] of Object.entries(source.media)) {
    checkId(mediaId, 'media ID');
    exactFields(media, ['kind', 'src', 'alt'], ['kind', 'src'], `media ${mediaId}`);
    if (!MEDIA_KINDS.includes(media.kind)) throw new TypeError(`media ${mediaId}: invalid kind`);
    if (typeof media.src !== 'string' || !ART_PATH.test(media.src)) throw new TypeError(`media ${mediaId}: unsafe src`);
    if (media.alt !== undefined) localized(media.alt, `media ${mediaId} alt`);
  }

  function requireMedia(mediaId, kind, label) {
    checkId(mediaId, `${label} media ID`);
    if (!Object.hasOwn(source.media, mediaId) || source.media[mediaId].kind !== kind) {
      throw new TypeError(`${label}: unknown or wrong-kind media ${mediaId}`);
    }
  }

  for (const [beatId, variants] of Object.entries(source.beats)) {
    checkId(beatId, 'presentation beat ID');
    if (!validBeats.has(beatId)) throw new TypeError(`presentation: unknown beat ${beatId}`);
    if (!Array.isArray(variants) || variants.length === 0) throw new TypeError(`beat ${beatId}: variants required`);
    const seenIds = new Set();
    for (const variant of variants) {
      exactFields(variant, ['id', 'when', 'background', 'portraits', 'cg', 'speaker', 'neutral'], ['id'], `beat ${beatId} variant`);
      checkId(variant.id, 'presentation variant ID');
      if (seenIds.has(variant.id)) throw new TypeError(`beat ${beatId}: duplicate variant ID`);
      seenIds.add(variant.id);
      if (variant.when !== undefined) validatePredicate(variant.when);
      if (variant.neutral !== undefined) {
        exactFields(variant.neutral, ['reason'], ['reason'], 'neutral');
        if (typeof variant.neutral.reason !== 'string' || !variant.neutral.reason.trim()) {
          throw new TypeError('neutral: nonempty reason required');
        }
        if (variant.background !== undefined || variant.portraits !== undefined || variant.cg !== undefined) {
          throw new TypeError('neutral: visual layers are forbidden');
        }
      }
      if (variant.neutral === undefined && variant.background === undefined &&
          (!variant.portraits || variant.portraits.length === 0) && variant.cg === undefined) {
        throw new TypeError(`beat ${beatId} variant ${variant.id}: visual layers or explicit neutral reason required`);
      }
      if (variant.background !== undefined) requireMedia(variant.background, 'background', 'background');
      if (variant.portraits !== undefined) {
        if (!Array.isArray(variant.portraits) || variant.portraits.length > 3) {
          throw new TypeError('portraits: expected up to three portraits');
        }
        const usedSlots = new Set();
        for (const portrait of variant.portraits) {
          exactFields(portrait, ['characterId', 'mediaId', 'slot'], ['characterId', 'mediaId', 'slot'], 'portrait');
          checkId(portrait.characterId, 'portrait characterId');
          requireMedia(portrait.mediaId, 'portrait', 'portrait');
          if (!SLOTS.includes(portrait.slot) || usedSlots.has(portrait.slot)) throw new TypeError('portrait: invalid or duplicate slot');
          usedSlots.add(portrait.slot);
        }
      }
      if (variant.cg !== undefined) {
        exactFields(variant.cg, ['mediaId', 'mode'], ['mediaId', 'mode'], 'cg');
        requireMedia(variant.cg.mediaId, 'cg', 'cg');
        if (!CG_MODES.includes(variant.cg.mode)) throw new TypeError('cg: invalid mode');
      }
      if (variant.speaker !== undefined) localized(variant.speaker, 'speaker');
    }
  }
  deepFreeze(source);
  validated.add(source);
  return source;
}

/** A pure lookup: no DOM, no playback state, no fallback to the previous beat. */
export function resolveNarrativePresentation(graph, presentation, narrativeState) {
  if (presentation == null) return null;
  if (!validated.has(presentation)) throw new TypeError('presentation: validate with defineNarrativePresentation first');
  const scene = graph.scenes.find(item => item.id === narrativeState?.sceneId);
  const beat = scene?.beats[narrativeState?.beatIndex];
  if (!beat) throw new TypeError('presentation: invalid narrative position');
  const variants = presentation.beats[beat.id] ?? [];
  const matches = variants.filter(variant => evaluateNarrativePredicate(variant.when, narrativeState));
  if (matches.length > 1) throw new TypeError(`presentation: ambiguous variants for ${beat.id}`);
  return matches[0] ?? null;
}
