import { VkConnectError } from './errors.mjs';
import { probeVkCapabilities } from './capabilities.mjs';

const problem = (code, message, cause) => new VkConnectError(code, {
  message, ...(cause === undefined ? {} : { cause }),
});

const unavailable = async () => { throw problem('BRIDGE_UNAVAILABLE',
  'No VK Bridge was injected. This adapter never fabricates a host SDK.'); };

/**
 * V1 contract: explicit VK Bridge injection. Integrate the official bridge at
 * the VK entrypoint in a later phase. Does not import browser globals on load.
 */
export function createVkConnector({ bridgeLoader = unavailable, timeoutMs = 10_000 } = {}) {
  if (typeof bridgeLoader !== 'function') throw new TypeError('bridgeLoader must be a function');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new TypeError('timeoutMs must be an integer between 1 and 120000');
  }
  let state = 'IDLE';
  let pending;
  let connection;
  let controller;
  let cancelPending;

  function initialize() {
    if (state === 'READY') return Promise.resolve(connection);
    if (state === 'INITIALIZING') return pending;
    if (state !== 'IDLE') return Promise.reject(problem('SDK_INIT_FAILED',
      `VK connector cannot initialize in state ${state}`));

    state = 'INITIALIZING';
    controller = new AbortController();
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => reject(problem('SDK_TIMEOUT', 'VK Bridge init timed out')), timeoutMs);
    });
    const destroyed = new Promise((_, reject) => {
      cancelPending = () => reject(problem('SDK_CANCELLED', 'VK connector destroyed'));
    });

    const run = async () => {
      let bridge;
      try { bridge = await bridgeLoader({ signal: controller.signal }); }
      catch (cause) {
        if (cause instanceof VkConnectError) throw cause;
        throw problem('BRIDGE_LOAD_FAILED', 'VK Bridge loader failed', cause);
      }
      if (state !== 'INITIALIZING' || controller.signal.aborted) {
        throw problem('SDK_CANCELLED', 'VK Bridge load was cancelled');
      }
      let send, subscribe, unsubscribe;
      try {
        send = bridge?.send; subscribe = bridge?.subscribe; unsubscribe = bridge?.unsubscribe;
      } catch (cause) { throw problem('BRIDGE_INVALID', 'Cannot inspect VK Bridge interface', cause); }
      if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge) ||
          typeof send !== 'function' || typeof subscribe !== 'function' ||
          typeof unsubscribe !== 'function') {
        throw problem('BRIDGE_INVALID', 'VK Bridge requires send, subscribe and unsubscribe');
      }
      try { await send.call(bridge, 'VKWebAppInit'); }
      catch (cause) { throw problem('SDK_INIT_FAILED', 'VKWebAppInit failed', cause); }
      if (state !== 'INITIALIZING' || controller.signal.aborted) {
        throw problem('SDK_CANCELLED', 'VK Bridge initialization was cancelled');
      }
      return Object.freeze({ bridge, origin: 'INJECTED_BRIDGE', livePlatformVerified: false });
    };

    pending = Promise.race([run(), timedOut, destroyed])
      .then(value => {
        if (state !== 'INITIALIZING' || controller.signal.aborted) {
          throw problem('SDK_CANCELLED', 'VK initialization completed too late');
        }
        connection = value;
        state = 'READY';
        return value;
      }, failure => {
        if (state !== 'DESTROYED') state = 'FAILED';
        throw failure;
      }).finally(() => {
        clearTimeout(timer);
        if (state !== 'READY') controller.abort();
        cancelPending = undefined;
      });
    return pending;
  }

  async function probeCapabilities(options) {
    if (state !== 'READY') throw problem('SDK_INIT_FAILED', 'Initialize VK Bridge before probing capabilities');
    return probeVkCapabilities(connection.bridge, options);
  }

  async function destroy() {
    if (state === 'DESTROYED') return;
    state = 'DESTROYED';
    controller?.abort();
    cancelPending?.();
    connection = undefined;
  }

  return Object.freeze({ initialize, probeCapabilities, destroy, getStatus: () => state });
}
