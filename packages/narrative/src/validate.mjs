export const ID = /^[a-z][a-z0-9_-]{0,63}$/;

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function jsonCopy(value, label = 'value', ancestors = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new TypeError(`${label}: non-JSON value`);
  if (ancestors.has(value)) throw new TypeError(`${label}: cyclic value`);
  if (!Array.isArray(value) && !isObject(value)) throw new TypeError(`${label}: non-plain object`);
  ancestors.add(value);
  const result = Array.isArray(value) ? [] : Object.create(null);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && (keys.length !== value.length + 1 ||
      Array.from({ length: value.length }, (_, i) => String(i)).some(k => !Object.hasOwn(value, k)))) {
    throw new TypeError(`${label}: sparse or unusual array`);
  }
  for (const key of keys) {
    if (key === 'length' && Array.isArray(value)) continue;
    if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new TypeError(`${label}: unsafe key`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label}: accessor or hidden property`);
    }
    result[key] = jsonCopy(descriptor.value, `${label}.${key}`, ancestors);
  }
  ancestors.delete(value);
  return result;
}

export function fields(value, allowed, required, label) {
  if (!isObject(value)) throw new TypeError(`${label}: expected object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError(`${label}: unexpected field ${String(key)}`);
  }
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}: missing ${key}`);
}

export function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${label}: invalid ID`);
}

export function localized(value, label) {
  fields(value, ['ru', 'en'], ['ru', 'en'], label);
  for (const lang of ['ru', 'en']) {
    if (typeof value[lang] !== 'string' || !value[lang].trim()) throw new TypeError(`${label}.${lang}: missing text`);
  }
}

export function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

export function unique(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`${label}: duplicate ID`);
}

export function validateEffects(effects, label) {
  if (!Array.isArray(effects)) throw new TypeError(`${label}: effects must be an array`);
  for (const effect of effects) {
    fields(effect, ['op', 'id', 'value'], ['op', 'id'], `${label} effect`);
    id(effect.id, `${label} effect ID`);
    if (!['relation_delta', 'flag_set', 'memory_add', 'album_add', 'keepsake_add', 'route_intent', 'route_lock'].includes(effect.op)) {
      throw new TypeError(`${label}: unsupported effect ${effect.op}`);
    }
    if (effect.op === 'relation_delta' && (!Number.isSafeInteger(effect.value) || Math.abs(effect.value) > 10)) {
      throw new TypeError(`${label}: invalid relation delta`);
    }
    if (effect.op === 'flag_set' && typeof effect.value !== 'boolean') {
      throw new TypeError(`${label}: invalid flag value`);
    }
    if (!['relation_delta', 'flag_set'].includes(effect.op) && Object.hasOwn(effect, 'value')) {
      throw new TypeError(`${label}: unexpected effect value`);
    }
  }
}
