import { validatePersistedRecordShape } from '@ludory/runtime/contracts';
import { YandexConnectError } from './errors.mjs';

// The SDK quota is shared with the game's other Player data, not reserved per key.
// Conservative decimal interpretation of the SDK's documented 200 KB quota.
const PLAYER_DATA_LIMIT_BYTES = 200_000;
const namespacePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const saveKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/;

function cloudError(code, message, cause) {
  return new YandexConnectError(code, { message, ...(cause === undefined ? {} : { cause }) });
}

function expectKey(key) {
  if (typeof key !== 'string' || key.length > 128 || !saveKeyPattern.test(key)) {
    throw new TypeError('Player storage key must be a non-empty, safe ASCII key up to 128 characters');
  }
  return key;
}

function requireSdkPromise(value, method) {
  if (!value || typeof value.then !== 'function') {
    throw new TypeError(`Player.${method} did not return a Promise`);
  }
  return value;
}

/**
 * Game-scoped, versioned Player SDK adapter for RuntimeStorage.
 * Cloud errors are intentionally not converted to localStorage operations.
 */
export function createYandexPlayerStorage({ getPlayer, namespace } = {}) {
  if (typeof getPlayer !== 'function') throw new TypeError('getPlayer must be an async provider function');
  if (typeof namespace !== 'string' || namespace.length > 64 || !namespacePattern.test(namespace)) {
    throw new TypeError('namespace must be a game-specific lowercase slug up to 64 characters');
  }

  const scoped = key => `ludory:${namespace}:v1:${expectKey(key)}`;
  let player;
  let acquiring;
  let tail = Promise.resolve();

  function acquirePlayer() {
    if (player) return Promise.resolve(player);
    if (acquiring) return acquiring;
    acquiring = Promise.resolve().then(() => getPlayer()).then(candidate => {
      if (!candidate || typeof candidate.getData !== 'function' || typeof candidate.setData !== 'function') {
        throw new TypeError('Yandex Player getData/setData capability is unavailable');
      }
      player = candidate;
      return candidate;
    }).catch(error => {
      throw cloudError('PLAYER_UNAVAILABLE', 'Yandex Player is unavailable', error);
    }).finally(() => { acquiring = undefined; });
    return acquiring;
  }

  function enqueue(playerPromise, execute) {
    const operation = tail.then(async () => execute(await playerPromise));
    // An unsuccessful cloud request does not poison later explicitly attempted operations.
    tail = operation.catch(() => {});
    return operation;
  }

  return Object.freeze({
    async load(key) {
      const name = scoped(key);
      const ready = acquirePlayer();
      return enqueue(ready, async sdkPlayer => {
        try {
          const result = await requireSdkPromise(sdkPlayer.getData([name]), 'getData');
          if (!result || typeof result !== 'object' || Array.isArray(result)) {
            throw new TypeError('Player.getData did not return a key-value object');
          }
          const value = Object.hasOwn(result, name) ? result[name] : null;
          // Keep the caller's mutable object detached from SDK-owned caches.
          // Do not validate here: Runtime must classify corrupt/incompatible records.
          return value == null ? null : structuredClone(value);
        } catch (error) {
          throw cloudError('CLOUD_LOAD_FAILED', 'Yandex Player cloud load failed', error);
        }
      });
    },
    async save(key, record) {
      const name = scoped(key);
      let detached;
      try {
        detached = validatePersistedRecordShape(record);
        const bytes = new TextEncoder().encode(JSON.stringify({ [name]: detached })).byteLength;
        if (bytes > PLAYER_DATA_LIMIT_BYTES) {
          throw new RangeError('Player save record exceeds the 200 KB SDK total-data limit');
        }
      } catch (error) {
        return Promise.reject(cloudError('CLOUD_SAVE_FAILED', 'Invalid or oversized Player save record', error));
      }
      const ready = acquirePlayer();
      return enqueue(ready, async sdkPlayer => {
        try {
          await requireSdkPromise(sdkPlayer.setData({ [name]: detached }, true), 'setData');
        } catch (error) {
          throw cloudError('CLOUD_SAVE_FAILED', 'Yandex Player cloud save failed', error);
        }
      });
    },
    async clear(key) {
      const name = scoped(key);
      const ready = acquirePlayer();
      return enqueue(ready, async sdkPlayer => {
        try {
          // SDK has no key-level delete method; preserve unrelated Player data.
          await requireSdkPromise(sdkPlayer.setData({ [name]: null }, true), 'setData');
        } catch (error) {
          throw cloudError('CLOUD_CLEAR_FAILED', 'Yandex Player cloud clear failed', error);
        }
      });
    },
  });
}
