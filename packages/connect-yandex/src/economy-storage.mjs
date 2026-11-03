import { defineEconomy, validateEconomyState } from '@ludory/economy';
import { YandexConnectError } from './errors.mjs';

const MAX_BYTES = 200_000; // Shared Player quota, not a per-wallet allowance.
const failed = (code, message, cause) => new YandexConnectError(code, { message, cause });
const promised = (value, method) => {
  if (!value || typeof value.then !== 'function') throw new TypeError(`Player.${method} requires a Promise`);
  return value;
};

/** Economy records are distinct from Runtime's Core-snapshot storage envelopes. */
export function createYandexEconomyStorage({ config: rawConfig, getPlayer, maxBytes = MAX_BYTES } = {}) {
  const config = defineEconomy(rawConfig);
  if (typeof getPlayer !== 'function') throw new TypeError('getPlayer is required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) {
    throw new TypeError('maxBytes must fit the Yandex Player shared cloud quota');
  }
  const key = `ludory:${config.gameId}:economy:v1`;
  let player, acquisition, tail = Promise.resolve();
  const enqueue = action => {
    const result = tail.then(action, action);
    tail = result.catch(() => {});
    return result;
  };
  async function acquire() {
    if (player) {
      try { if (player.isAuthorized() !== true) throw new TypeError('Player signed out'); }
      catch (error) { player = null; throw failed('PLAYER_UNAVAILABLE', 'Authorized Player unavailable', error); }
      return player;
    }
    if (!acquisition) acquisition = Promise.resolve().then(() => getPlayer()).then(candidate => {
      if (typeof candidate?.isAuthorized !== 'function' || candidate.isAuthorized() !== true ||
          typeof candidate.getData !== 'function' || typeof candidate.setData !== 'function') {
        throw new TypeError('Authorized Yandex Player cloud APIs are required for monetary storage');
      }
      player = candidate;
      return player;
    }).catch(error => { throw failed('PLAYER_UNAVAILABLE', 'Authorized Player unavailable', error); })
      .finally(() => { acquisition = null; });
    return acquisition;
  }
  async function fetch(sdkPlayer) {
    const payload = await promised(sdkPlayer.getData([key]), 'getData');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Invalid Player data response');
    if (!Object.hasOwn(payload, key)) return null;
    // Explicit null is not an absent record; never reset a possibly paid wallet.
    return structuredClone(validateEconomyState(config, payload[key]));
  }
  return Object.freeze({
    purchaseCloud: true,
    load: () => enqueue(async () => {
      const sdkPlayer = await acquire();
      try { return await fetch(sdkPlayer); }
      catch (error) { throw failed('CLOUD_LOAD_FAILED', 'Economy cloud read failed', error); }
    }),
    save: value => enqueue(async () => {
      let snapshot;
      try {
        snapshot = structuredClone(validateEconomyState(config, value));
        const bytes = new TextEncoder().encode(JSON.stringify({ [key]: snapshot })).byteLength;
        if (bytes > maxBytes) throw new RangeError('Economy record exceeds shared cloud byte budget');
      } catch (error) { throw failed('CLOUD_SAVE_FAILED', 'Invalid or oversized economy record', error); }
      const sdkPlayer = await acquire();
      try {
        await promised(sdkPlayer.setData({ [key]: snapshot }, true), 'setData');
        const observed = await fetch(sdkPlayer);
        if (JSON.stringify(observed) !== JSON.stringify(snapshot)) throw new TypeError('Cloud wallet readback mismatch');
      } catch (error) { throw failed('CLOUD_SAVE_FAILED', 'Economy cloud write not confirmed', error); }
      return true;
    }),
  });
}
