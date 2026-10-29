import { detectYandexCapabilities } from './capabilities.mjs';
import { YandexConnectError } from './errors.mjs';
import { loadYandexSdkScript } from './sdk-loader.mjs';

function connectError(code, message, cause) {
  return new YandexConnectError(code, {
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

/** An instance-scoped SDK initialization boundary with bounded async work. */
export function createYandexConnector({
  sdkLoader = loadYandexSdkScript,
  initOptions,
  timeoutMs = 10_000,
} = {}) {
  if (typeof sdkLoader !== 'function') throw new TypeError('sdkLoader must be a function');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a finite positive number');
  }

  let status = 'IDLE';
  let pending;
  let connection;
  let abortController;
  let cancelPending;

  function initialize() {
    if (status === 'READY') return Promise.resolve(connection);
    if (status === 'LOADING') return pending;
    if (status !== 'IDLE') {
      return Promise.reject(connectError('SDK_INIT_FAILED', `Cannot initialize Yandex connector from ${status}`));
    }

    status = 'LOADING';
    abortController = new AbortController();
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(connectError('SDK_TIMEOUT', 'Yandex SDK initialization timed out')), timeoutMs);
    });
    const destroyed = new Promise((_, reject) => {
      cancelPending = () => reject(connectError('SDK_LOAD_FAILED', 'Yandex connector was destroyed during initialization'));
    });

    async function run() {
      let factory;
      try { factory = await sdkLoader({ signal: abortController.signal }); }
      catch (error) {
        if (error instanceof YandexConnectError) throw error;
        throw connectError('SDK_LOAD_FAILED', 'Yandex SDK loading failed', error);
      }
      // Promise.race settles the caller, but cannot stop an uncooperative
      // loader. Never start the next SDK stage after cancellation or timeout.
      if (status !== 'LOADING' || abortController.signal.aborted) {
        throw connectError('SDK_LOAD_FAILED', 'Yandex SDK loading was cancelled');
      }
      let init;
      try { init = factory?.init; }
      catch (error) { throw connectError('SDK_INIT_FAILED', 'Cannot inspect YaGames.init', error); }
      if (typeof init !== 'function') {
        throw connectError('SDK_INIT_FAILED', 'Yandex SDK loader returned no usable YaGames.init');
      }
      let sdk;
      try { sdk = await (initOptions === undefined ? init.call(factory) : init.call(factory, initOptions)); }
      catch (error) { throw connectError('SDK_INIT_FAILED', 'YaGames.init failed', error); }
      if (status !== 'LOADING' || abortController.signal.aborted) {
        throw connectError('SDK_LOAD_FAILED', 'Yandex SDK initialization was cancelled');
      }
      if (!sdk || typeof sdk !== 'object' || Array.isArray(sdk)) {
        throw connectError('SDK_INIT_FAILED', 'YaGames.init did not return an SDK object');
      }
      try { return Object.freeze({ sdk, capabilities: detectYandexCapabilities(sdk) }); }
      catch (error) { throw connectError('SDK_INIT_FAILED', 'Yandex SDK capabilities cannot be inspected', error); }
    }

    pending = Promise.race([run(), timeout, destroyed])
      .then(value => {
        if (status === 'DESTROYED') {
          throw connectError('SDK_LOAD_FAILED', 'Yandex connector was destroyed during initialization');
        }
        connection = value;
        status = 'READY';
        return value;
      }, error => {
        if (status !== 'DESTROYED') status = 'FAILED';
        throw error;
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (status !== 'READY') abortController.abort();
        cancelPending = null;
      });
    return pending;
  }

  async function destroy() {
    if (status === 'DESTROYED') return;
    status = 'DESTROYED';
    abortController?.abort();
    cancelPending?.();
    connection = undefined;
  }

  return Object.freeze({ initialize, destroy, getStatus: () => status });
}
