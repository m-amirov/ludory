import { defineEconomy, validateEconomyState } from '@ludory/economy';
import { VkConnectError } from './errors.mjs';

const LIMIT = 3800;
const failed = (code, message, cause) => new VkConnectError(code, { message, cause });

/** One-key VK Bridge monetary wallet; VK native purchases intentionally unsupported. */
export function createVkEconomyStorage({ config: rawConfig, bridge, maxBytes = LIMIT } = {}) {
  const config = defineEconomy(rawConfig);
  if (typeof bridge?.send !== 'function') throw new TypeError('VK Bridge send required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > LIMIT) throw new TypeError('Invalid VK wallet quota');
  // Literal '_' is escaped as '__', while '-' remains literal; distinct game
  // IDs can never alias the same monetary wallet key.
  const name = `ludory_${config.gameId.length}_${config.gameId.replaceAll('_', '__')}_economy_v1`;
  if (name.length > 100) throw new TypeError('VK wallet key too long');
  let tail = Promise.resolve();
  const enqueue = action => {
    const result = tail.then(action, action);
    tail = result.catch(() => {});
    return result;
  };
  async function send(method, args) {
    const response = bridge.send(method, args);
    if (!response || typeof response.then !== 'function') throw new TypeError('VK Bridge operation must return a Promise');
    return response;
  }
  async function fetch() {
    let result;
    try { result = await send('VKWebAppStorageGet', { keys: [name] }); }
    catch (error) { throw failed('STORAGE_LOAD_FAILED', 'VK economy cloud read failed', error); }
    if (!result || !Array.isArray(result.keys) || result.keys.length > 1 ||
        (result.keys.length === 1 && (result.keys[0]?.key !== name || typeof result.keys[0]?.value !== 'string'))) {
      throw new TypeError('Invalid VK wallet response');
    }
    const value = result.keys[0]?.value ?? '';
    if (!value) return null;
    if (new TextEncoder().encode(value).byteLength > maxBytes) throw new RangeError('Truncated VK wallet record');
    return structuredClone(validateEconomyState(config, JSON.parse(value)));
  }
  return Object.freeze({
    purchaseCloud: false,
    load: () => enqueue(async () => {
      try { return await fetch(); }
      catch (error) {
        if (error instanceof VkConnectError && error.code === 'STORAGE_LOAD_FAILED') throw error;
        throw failed('STORAGE_CORRUPT', 'VK economy wallet is unreadable', error);
      }
    }),
    save: value => enqueue(async () => {
      let encoded;
      try {
        encoded = JSON.stringify(validateEconomyState(config, value));
        if (new TextEncoder().encode(encoded).byteLength > maxBytes) throw new RangeError('VK economy wallet capacity exceeded');
      } catch (error) { throw failed('STORAGE_SAVE_FAILED', 'Invalid or oversized VK wallet', error); }
      try {
        const response = await send('VKWebAppStorageSet', { key: name, value: encoded });
        if (response?.result !== true) throw new TypeError('VK write was not acknowledged');
        const observed = await fetch();
        if (JSON.stringify(observed) !== encoded) throw new TypeError('VK wallet readback mismatch');
      } catch (error) { throw failed('STORAGE_SAVE_FAILED', 'VK wallet write unconfirmed', error); }
      return true;
    }),
  });
}
