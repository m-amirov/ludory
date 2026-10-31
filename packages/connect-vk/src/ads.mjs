import { VkConnectError } from './errors.mjs';

function problem(code, message, cause) {
  return new VkConnectError(code, {
    message, ...(cause === undefined ? {} : { cause }),
  });
}

function formatFor(kind) {
  if (kind === 'fullscreen') return 'interstitial';
  if (kind === 'rewarded') return 'reward';
  throw new TypeError('VK ad kind must be fullscreen or rewarded');
}

/** Promise-bound VK Bridge ads; a result true is SDK confirmation, not signed watch proof. */
export function createVkAds({ bridge, lifecycle, timeoutMs = 120_000 } = {}) {
  if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge)) {
    throw new TypeError('VK Bridge must be an injected object');
  }
  if (!lifecycle || ['getStatus', 'getAttachmentToken', 'acquireAdPause', 'subscribeDetach']
    .some(name => typeof lifecycle[name] !== 'function')) {
    throw new TypeError('VK lifecycle must support scoped ad pauses and detach notifications');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new TypeError('VK ad timeoutMs must be an integer between 1 and 300000');
  }

  let destroyed = false;
  let active = null;
  const attached = token => !destroyed && token !== null &&
    lifecycle.getStatus() === 'ATTACHED' && lifecycle.getAttachmentToken() === token;

  function show(kind) {
    if (destroyed) return Promise.reject(problem('ADS_FAILED', 'VK ads adapter is destroyed'));
    if (active) return Promise.reject(problem('ADS_FAILED', 'Another VK ad is already active'));
    const token = lifecycle.getAttachmentToken();
    if (!attached(token)) {
      return Promise.reject(problem('ADS_FAILED', 'VK lifecycle is not attached'));
    }
    if (typeof bridge.send !== 'function') {
      return Promise.reject(problem('CAPABILITY_UNAVAILABLE', 'VK ad display method is unavailable'));
    }

    return new Promise((resolve, reject) => {
      const attempt = { settled: false, release: null, timer: null };
      active = attempt;
      const settle = (value, failure) => {
        if (active !== attempt || attempt.settled) return;
        attempt.settled = true;
        active = null;
        clearTimeout(attempt.timer);
        try { attempt.release?.(); }
        catch (cause) { failure ??= problem('ADS_FAILED', 'Failed to release VK ad pause', cause); }
        if (failure) reject(failure);
        else resolve(value);
      };
      attempt.cancel = () => settle(null, problem('ADS_FAILED', 'VK advertisement cancelled'));

      try {
        const release = lifecycle.acquireAdPause();
        if (attempt.settled || destroyed || active !== attempt) { release(); return; }
        attempt.release = release;
        if (!attached(token)) {
          attempt.cancel();
          return;
        }
        attempt.timer = setTimeout(() => {
          settle(null, problem('ADS_FAILED', 'VK advertisement response timed out'));
        }, timeoutMs);
        const response = bridge.send('VKWebAppShowNativeAds', { ad_format: formatFor(kind) });
        if (!response || typeof response.then !== 'function') {
          settle(null, problem('ADS_FAILED', 'VK Bridge ad call did not return a Promise'));
          return;
        }
        Promise.resolve(response).then(data => {
          if (attempt.settled) return;
          if (!attached(token)) { attempt.cancel(); return; }
          if (data?.result !== true) {
            settle(null, problem('ADS_NOT_SHOWN', 'VK Bridge did not confirm ad display'));
            return;
          }
          settle(kind === 'rewarded' ? { shown: true, rewarded: true } : { shown: true });
        }, cause => settle(null, problem('ADS_FAILED', 'VK ad display failed', cause)));
      } catch (cause) {
        settle(null, problem('ADS_FAILED', 'VK advertisement could not start', cause));
      }
    });
  }

  async function checkAvailability(kind) {
    const adFormat = formatFor(kind);
    if (destroyed) throw problem('ADS_FAILED', 'VK ads adapter is destroyed');
    const token = lifecycle.getAttachmentToken();
    if (!attached(token)) throw problem('ADS_FAILED', 'VK lifecycle is not attached');
    if (typeof bridge.send !== 'function') {
      throw problem('CAPABILITY_UNAVAILABLE', 'VK ad availability method is unavailable');
    }
    let response;
    try { response = bridge.send('VKWebAppCheckNativeAds', { ad_format: adFormat }); }
    catch (cause) { throw problem('ADS_FAILED', 'VK ad availability check failed', cause); }
    if (!response || typeof response.then !== 'function') {
      throw problem('ADS_FAILED', 'VK availability check did not return a Promise');
    }
    let data;
    try { data = await response; }
    catch (cause) { throw problem('ADS_FAILED', 'VK ad availability check failed', cause); }
    if (!attached(token)) throw problem('ADS_FAILED', 'VK ad availability response is stale');
    if (typeof data?.result !== 'boolean') {
      throw problem('ADS_FAILED', 'VK ad availability response is invalid');
    }
    return { available: data.result };
  }

  const unsubscribe = lifecycle.subscribeDetach(() => active?.cancel());
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    unsubscribe();
    active?.cancel();
  }

  return Object.freeze({
    showFullscreen: () => show('fullscreen'),
    showRewarded: () => show('rewarded'),
    checkAvailability, destroy,
  });
}
