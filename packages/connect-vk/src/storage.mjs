import { validatePersistedRecordShape } from '@ludory/runtime/contracts';
import { VkConnectError } from './errors.mjs';

const MAX_VALUE_BYTES = 3800; // conservative bound below VK's 4096-byte value truncation
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const keyPattern = /^[A-Za-z0-9_-]+$/;
const failure = (code, message, cause) => new VkConnectError(code, {
  message, ...(cause === undefined ? {} : { cause }),
});

/** One-key VK Bridge storage adapter for Runtime persisted envelopes; no local fallback. */
export function createVkStorage({ bridge, namespace } = {}) {
  if (!bridge || typeof bridge.send !== 'function') throw new TypeError('bridge.send is required');
  if (typeof namespace !== 'string' || namespace.length > 36 || !slug.test(namespace))
    throw new TypeError('namespace must be a lowercase game slug up to 36 chars');
  const scoped = key => {
    if (typeof key !== 'string' || key.length > 40 || !keyPattern.test(key))
      throw new TypeError('storage key must be safe ASCII up to 40 chars');
    const name = 'ludory_' + namespace.length + '_' + namespace.replaceAll('-', '_') + '_v1_' + key;
    if (name.length > 100) throw new TypeError('VK key exceeds 100 characters');
    return name;
  };
  let tail = Promise.resolve();
  const enqueue = task => {
    const pending = tail.then(task);
    tail = pending.catch(() => {}); // a failed operation cannot poison later explicit actions
    return pending;
  };
  const send = (method, params) => {
    let result;
    try { result = bridge.send(method, params); }
    catch (error) { return Promise.reject(error); }
    if (!result || typeof result.then !== 'function')
      return Promise.reject(new TypeError('VK Bridge send must return a Promise'));
    return result;
  };
  return Object.freeze({
    async load(key) {
      const name = scoped(key);
      return enqueue(async () => {
        let data;
        try { data = await send('VKWebAppStorageGet', { keys: [name] }); }
        catch (error) { throw failure('STORAGE_LOAD_FAILED', 'VK cloud read failed', error); }
        if (!data || !Array.isArray(data.keys) || data.keys.length > 1 ||
            (data.keys.length === 1 &&
              (data.keys[0]?.key !== name || typeof data.keys[0]?.value !== 'string'))) {
          throw failure('STORAGE_LOAD_FAILED', 'Invalid VK storage read response');
        }
        const raw = data.keys.length === 0 ? '' : data.keys[0].value;
        if (raw === '') return null;
        if (new TextEncoder().encode(raw).byteLength > MAX_VALUE_BYTES)
          throw failure('STORAGE_CORRUPT', 'VK storage response exceeds safe byte limit');
        try { return JSON.parse(raw); }
        catch (error) { throw failure('STORAGE_CORRUPT', 'VK storage JSON is corrupt or truncated', error); }
      });
    },
    async save(key, record) {
      const name = scoped(key);
      let value;
      try {
        value = JSON.stringify(validatePersistedRecordShape(record));
        if (new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES)
          throw new RangeError('VK storage value exceeds conservative byte quota');
      } catch (error) {
        throw failure('STORAGE_SAVE_FAILED', 'Invalid or oversized VK persisted record', error);
      }
      return enqueue(async () => {
        let response;
        try { response = await send('VKWebAppStorageSet', { key: name, value }); }
        catch (error) { throw failure('STORAGE_SAVE_FAILED', 'VK cloud write failed', error); }
        if (response?.result !== true) throw failure('STORAGE_SAVE_FAILED', 'VK write not acknowledged');
      });
    },
    async clear(key) {
      const name = scoped(key);
      return enqueue(async () => {
        let response;
        try { response = await send('VKWebAppStorageSet', { key: name, value: '' }); }
        catch (error) { throw failure('STORAGE_CLEAR_FAILED', 'VK cloud clear failed', error); }
        if (response?.result !== true) throw failure('STORAGE_CLEAR_FAILED', 'VK clear not acknowledged');
      });
    },
  });
}
