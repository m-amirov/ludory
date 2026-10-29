import { validatePersistedRecordShape } from './contracts.mjs';
import { RuntimeError } from './errors.mjs';

function requireKey(key) {
  if (typeof key !== 'string' || !key.trim()) throw new TypeError('storage key must be non-empty');
  return key;
}

/** Browser localStorage adapter; errors remain observable to the Runtime host. */
export function createBrowserStorage({ storage, namespace = 'ludory' } = {}) {
  if (typeof namespace !== 'string' || !namespace.trim()) throw new TypeError('namespace must be non-empty');
  let provider;
  try {
    provider = storage ?? globalThis.localStorage;
    if (!provider || ['getItem', 'setItem', 'removeItem'].some(name => typeof provider[name] !== 'function')) {
      throw new TypeError('Browser localStorage capability is unavailable');
    }
  } catch (error) {
    throw new RuntimeError('STORAGE_UNAVAILABLE', { message: 'Browser storage is unavailable', cause: error });
  }
  const scoped = key => `${namespace}:${requireKey(key)}`;
  return Object.freeze({
    async load(key) {
      const raw = provider.getItem(scoped(key));
      if (raw === null) return null;
      try { return JSON.parse(raw); }
      catch (error) { throw new RuntimeError('RESTORE_CORRUPT', { message: 'Stored JSON is invalid', cause: error }); }
    },
    async save(key, record) {
      const detached = validatePersistedRecordShape(record);
      provider.setItem(scoped(key), JSON.stringify(detached));
    },
    async clear(key) { provider.removeItem(scoped(key)); },
  });
}
