import { YandexConnectError } from './errors.mjs';

const READY_STATUSES = new Set(['READY', 'RUNNING', 'PAUSED']);

function errorFor(code, message, cause) {
  return new YandexConnectError(code, {
    message,
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Binds actual Runtime status to optional Yandex gameplay markers. */
export function createYandexLifecycle({
  sdk, host, audio, canResume,
  windowObject = globalThis.window,
  documentObject = globalThis.document,
} = {}) {
  if (!sdk || typeof sdk !== 'object' || Array.isArray(sdk)) throw new TypeError('sdk must be an initialized Yandex SDK object');
  if (!host || typeof host.getStatus !== 'function' || typeof host.subscribe !== 'function' ||
      typeof host.pause !== 'function' || typeof host.resume !== 'function') {
    throw new TypeError('host must implement the Runtime lifecycle interface');
  }
  if (canResume !== undefined && typeof canResume !== 'function') throw new TypeError('canResume must be a function');
  if (audio !== undefined && (typeof audio?.pauseAll !== 'function' || typeof audio?.resumeAll !== 'function')) {
    throw new TypeError('audio must provide pauseAll and resumeAll');
  }
  // Browser objects are optional injections; neither is read on import.

  let attached = false;
  let unsubscribe;
  let reportedGameplay = false;
  let markerPending = null;
  let ready = false;
  let readyPending;
  let lastError = null;
  let manualPaused = false;
  let platformOwnsPause = false;
  const pauseReasons = new Set();
  let sdkSubscriptions = [];
  let browserSubscriptions = [];
  let generation = 0;

  function recordError(code, message, cause) {
    lastError = errorFor(code, message, cause);
    return false;
  }

  function observeOptionalResult(result, message) {
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(error => recordError('LIFECYCLE_FAILED', message, error));
    }
  }

  function trackCleanupStop(result) {
    if (!result || typeof result.then !== 'function') return;
    const cleanup = { shouldPlay: false, generation };
    markerPending = cleanup;
    Promise.resolve(result).then(() => {
      if (markerPending !== cleanup) return;
      markerPending = null;
      reconcileGameplay();
    }, error => {
      if (markerPending === cleanup) markerPending = null;
      recordError('LIFECYCLE_FAILED', 'Yandex gameplay cleanup stop failed', error);
    });
  }

  function reconcileGameplay() {
    if (!attached || markerPending) return;
    const shouldPlay = host.getStatus() === 'RUNNING';
    if (shouldPlay === reportedGameplay) return;
    const operation = { shouldPlay, generation };
    markerPending = operation;
    try {
      const api = sdk.features?.GameplayAPI;
      const method = shouldPlay ? api?.start : api?.stop;
      if (typeof method !== 'function' || (shouldPlay && typeof api?.stop !== 'function')) {
        markerPending = null;
        return recordError('CAPABILITY_UNAVAILABLE', 'Yandex GameplayAPI marker unavailable');
      }
      const result = method.call(api);
      if (result && typeof result.then === 'function') {
        // The SDK documents synchronous markers, but promises must also be
        // ordered: a delayed start cannot land after a newer paused status.
        Promise.resolve(result).then(() => {
          if (markerPending !== operation) return;
          markerPending = null;
          if (attached && generation === operation.generation) {
            reportedGameplay = shouldPlay;
            reconcileGameplay();
          } else {
            reportedGameplay = false;
            if (shouldPlay) {
              try { trackCleanupStop(sdk.features?.GameplayAPI?.stop?.()); }
              catch (error) { recordError('LIFECYCLE_FAILED', 'Late gameplay stop failed', error); }
            }
            reconcileGameplay();
          }
        }, error => {
          if (markerPending === operation) markerPending = null;
          recordError('LIFECYCLE_FAILED', 'Yandex gameplay marker failed', error);
        });
      } else {
        markerPending = null;
        reportedGameplay = shouldPlay;
        if (attached && (host.getStatus() === 'RUNNING') !== shouldPlay) reconcileGameplay();
      }
    } catch (error) {
      if (markerPending === operation) markerPending = null;
      recordError('LIFECYCLE_FAILED', 'Yandex gameplay marker failed', error);
    }
  }

  function enforcePause() {
    if (!attached || pauseReasons.size === 0 || host.getStatus() !== 'RUNNING') return;
    try {
      host.pause();
      if (host.getStatus() !== 'PAUSED') {
        recordError('LIFECYCLE_FAILED', 'Runtime did not pause after a platform pause request');
        return;
      }
      platformOwnsPause = true;
      try { observeOptionalResult(audio?.pauseAll(), 'Yandex audio pause failed'); }
      catch (error) { recordError('LIFECYCLE_FAILED', 'Yandex audio pause failed', error); }
    } catch (error) {
      recordError('LIFECYCLE_FAILED', 'Runtime pause failed', error);
    }
  }

  function onPause(reason) {
    if (!attached) return;
    pauseReasons.add(reason);
    enforcePause();
  }

  function onResume(reason) {
    if (!attached) return;
    pauseReasons.delete(reason);
    if (pauseReasons.size > 0 || !platformOwnsPause) return;
    if (manualPaused || host.getStatus() !== 'PAUSED') {
      platformOwnsPause = false;
      return;
    }
    try {
      const permission = canResume?.();
      if (permission === false) return;
      if (permission && typeof permission.then === 'function') {
        observeOptionalResult(permission, 'Async canResume rejected');
        recordError('LIFECYCLE_FAILED', 'canResume must return synchronously');
        return;
      }
      host.resume();
      if (host.getStatus() !== 'RUNNING') {
        recordError('LIFECYCLE_FAILED', 'Runtime did not resume after a platform resume request');
        return;
      }
      platformOwnsPause = false;
      try { observeOptionalResult(audio?.resumeAll(), 'Yandex audio resume failed'); }
      catch (error) { recordError('LIFECYCLE_FAILED', 'Yandex audio resume failed', error); }
    } catch (error) {
      recordError('LIFECYCLE_FAILED', 'Runtime resume failed', error);
    }
  }

  function detachSdkSubscriptions() {
    const previous = sdkSubscriptions;
    sdkSubscriptions = [];
    for (const [name, callback] of previous) {
      try { sdk.off(name, callback); }
      catch (error) { recordError('LIFECYCLE_FAILED', 'Yandex SDK event unsubscription failed', error); }
    }
  }

  function subscribeSdk() {
    if (typeof sdk.on !== 'function' || typeof sdk.off !== 'function') {
      recordError('CAPABILITY_UNAVAILABLE', 'Yandex SDK pause/resume events unavailable');
      return;
    }
    const token = generation;
    for (const [name, callback] of [
      ['game_api_pause', () => { if (attached && token === generation) onPause('sdk'); }],
      ['game_api_resume', () => { if (attached && token === generation) onResume('sdk'); }],
    ]) {
      try {
        sdk.on(name, callback);
        sdkSubscriptions.push([name, callback]);
      } catch (error) {
        recordError('LIFECYCLE_FAILED', 'Yandex SDK event subscription failed', error);
        detachSdkSubscriptions();
        break;
      }
    }
  }

  function detachBrowserSubscriptions() {
    const previous = browserSubscriptions;
    browserSubscriptions = [];
    for (const [target, name, callback] of previous) {
      try { target.removeEventListener(name, callback); }
      catch (error) { recordError('LIFECYCLE_FAILED', 'Browser lifecycle unsubscription failed', error); }
    }
  }

  function subscribeBrowser() {
    const token = generation;
    if (windowObject && typeof windowObject.addEventListener === 'function' &&
        typeof windowObject.removeEventListener === 'function') {
      try {
        for (const [name, callback] of [
          ['pagehide', () => { if (attached && token === generation) onPause('page'); }],
          ['pageshow', event => {
            if (attached && token === generation && event?.persisted === true) onResume('page');
          }],
        ]) {
          windowObject.addEventListener(name, callback);
          browserSubscriptions.push([windowObject, name, callback]);
        }
      } catch (error) {
        recordError('LIFECYCLE_FAILED', 'Browser page lifecycle subscription failed', error);
        detachBrowserSubscriptions();
      }
    }
    if (documentObject && typeof documentObject.addEventListener === 'function' &&
        typeof documentObject.removeEventListener === 'function') {
      const onVisibility = () => {
        if (!attached || token !== generation) return;
        try {
          if (documentObject.visibilityState === 'hidden') onPause('visibility');
          else if (documentObject.visibilityState === 'visible') onResume('visibility');
        } catch (error) {
          recordError('LIFECYCLE_FAILED', 'Document visibility inspection failed', error);
        }
      };
      try {
        documentObject.addEventListener('visibilitychange', onVisibility);
        browserSubscriptions.push([documentObject, 'visibilitychange', onVisibility]);
        onVisibility();
      } catch (error) {
        recordError('LIFECYCLE_FAILED', 'Browser visibility subscription failed', error);
        // Visibility is optional and independent of functioning page handlers.
        try { documentObject.removeEventListener('visibilitychange', onVisibility); }
        catch (cleanupError) { recordError('LIFECYCLE_FAILED', 'Browser visibility cleanup failed', cleanupError); }
        browserSubscriptions = browserSubscriptions.filter(([target, name]) =>
          target !== documentObject || name !== 'visibilitychange');
      }
    }
  }

  function attach() {
    if (attached) return;
    attached = true;
    generation++;
    try {
      unsubscribe = host.subscribe(event => {
        if (attached && event?.type === 'status') {
          enforcePause();
          reconcileGameplay();
        }
      });
      if (typeof unsubscribe !== 'function') throw new TypeError('host.subscribe must return unsubscribe');
      subscribeSdk();
      subscribeBrowser();
      enforcePause();
      reconcileGameplay();
    } catch (error) {
      attached = false;
      generation++;
      detachSdkSubscriptions();
      detachBrowserSubscriptions();
      unsubscribe?.();
      unsubscribe = undefined;
      recordError('LIFECYCLE_FAILED', 'Yandex lifecycle attach failed', error);
    }
  }

  function detach() {
    if (!attached) return;
    attached = false;
    generation++;
    detachSdkSubscriptions();
    detachBrowserSubscriptions();
    pauseReasons.clear();
    platformOwnsPause = false;
    try { unsubscribe?.(); }
    catch (error) { recordError('LIFECYCLE_FAILED', 'Yandex lifecycle detach failed', error); }
    unsubscribe = undefined;
    if (reportedGameplay && !markerPending) {
      try { trackCleanupStop(sdk.features?.GameplayAPI?.stop?.()); }
      catch (error) { recordError('LIFECYCLE_FAILED', 'Yandex gameplay stop failed on detach', error); }
    }
    reportedGameplay = false;
  }

  function markReady() {
    if (!attached || !READY_STATUSES.has(host.getStatus())) {
      return Promise.resolve(recordError('LIFECYCLE_FAILED', 'Runtime is not initialized and ready for interaction'));
    }
    if (ready) return Promise.resolve(true);
    if (readyPending) return readyPending;
    let result;
    try {
      const api = sdk.features?.LoadingAPI;
      if (typeof api?.ready !== 'function') {
        return Promise.resolve(recordError('CAPABILITY_UNAVAILABLE', 'Yandex LoadingAPI.ready is unavailable'));
      }
      result = api.ready();
    } catch (error) {
      return Promise.resolve(recordError('LIFECYCLE_FAILED', 'Yandex LoadingAPI.ready failed', error));
    }
    const token = generation;
    readyPending = Promise.resolve(result).then(() => {
      // Successful SDK notification is irreversible even if the observer's
      // attachment expired before the asynchronous SDK response arrived.
      ready = true;
      if (!attached || generation !== token || !READY_STATUSES.has(host.getStatus())) {
        return recordError('LIFECYCLE_FAILED', 'Yandex LoadingAPI.ready finished after lifecycle was unavailable');
      }
      return true;
    }, error => recordError('LIFECYCLE_FAILED', 'Yandex LoadingAPI.ready failed', error))
      .finally(() => { readyPending = undefined; });
    return readyPending;
  }

  function setManualPaused(value) {
    if (typeof value !== 'boolean') throw new TypeError('Manual pause flag must be boolean');
    manualPaused = value;
  }

  return Object.freeze({
    attach, detach, markReady, setManualPaused,
    getStatus: () => attached ? 'ATTACHED' : 'DETACHED',
    getLastError: () => lastError,
  });
}
