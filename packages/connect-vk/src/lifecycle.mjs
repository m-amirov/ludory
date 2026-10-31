import { VkConnectError } from './errors.mjs';

const failure = (message, cause) => new VkConnectError('LIFECYCLE_FAILED', { message, cause });

/** VK ViewHide/ViewRestore / browser pause ownership. No platform globals on import. */
export function createVkLifecycle({ bridge, host, audio, canResume,
  windowObject = globalThis.window, documentObject = globalThis.document } = {}) {
  if (!bridge || typeof bridge.subscribe !== 'function' || typeof bridge.unsubscribe !== 'function')
    throw new TypeError('VK Bridge must expose subscribe/unsubscribe');
  if (!host || ['getStatus', 'pause', 'resume', 'subscribe'].some(key => typeof host[key] !== 'function'))
    throw new TypeError('Runtime host must expose getStatus/pause/resume');
  if (audio !== undefined && ['pauseAll', 'resumeAll'].some(key => typeof audio?.[key] !== 'function'))
    throw new TypeError('Audio must expose pauseAll/resumeAll');
  if (canResume !== undefined && typeof canResume !== 'function')
    throw new TypeError('canResume must be a function');

  let attached = false, generation = 0, ownsPause = false, manualPaused = false, lastError = null;
  let onBridge;
  let unlistenHost;
  let listeners = [];
  const reasons = new Set();
  const record = (message, cause) => { lastError = failure(message, cause); };
  const audioCall = (fn, message) => {
    try { const result = fn?.(); if (result?.then) Promise.resolve(result).catch(error => record(message, error)); }
    catch (error) { record(message, error); }
  };

  function enforcePause() {
    if (!attached || reasons.size === 0 || host.getStatus() !== 'RUNNING') return;
    const token = generation;
    try {
      host.pause();
      if (!attached || generation !== token) return;
      if (host.getStatus() !== 'PAUSED') throw new Error('Runtime did not pause');
      ownsPause = true;
      audioCall(() => audio?.pauseAll(), 'VK audio pause failed');
    } catch (error) { record('VK hide failed to pause Runtime', error); }
  }
  function attemptResume() {
    if (!attached || reasons.size > 0 || !ownsPause || manualPaused) return;
    if (host.getStatus() !== 'PAUSED') { ownsPause = false; return; }
    try {
      const allowed = canResume?.();
      if (allowed === false) return;
      if (allowed?.then) {
        Promise.resolve(allowed).catch(error => record('Async canResume rejected', error));
        throw new TypeError('canResume must be synchronous');
      }
      const token = generation;
      host.resume();
      if (!attached || generation !== token) return;
      if (host.getStatus() !== 'RUNNING') throw new Error('Runtime did not resume');
      ownsPause = false;
      audioCall(() => audio?.resumeAll(), 'VK audio resume failed');
    } catch (error) { record('VK restore failed to resume Runtime', error); }
  }
  const hide = reason => { if (attached) { reasons.add(reason); enforcePause(); } };
  const restore = reason => { if (attached) { reasons.delete(reason); attemptResume(); } };

  function attach() {
    if (attached) return;
    const token = ++generation;
    onBridge = event => {
      if (!attached || generation !== token) return;
      try {
        if (event?.detail?.type === 'VKWebAppViewHide') hide('vk');
        if (event?.detail?.type === 'VKWebAppViewRestore') restore('vk');
      } catch (error) { record('VK Bridge event handling failed', error); }
    };
    try { bridge.subscribe(onBridge); }
    catch (error) { onBridge = undefined; record('VK Bridge subscription failed', error); return false; }
    attached = true;
    try {
      unlistenHost = host.subscribe(event => {
        if (attached && generation === token && event?.type === 'status') enforcePause();
      });
      if (typeof unlistenHost !== 'function') throw new TypeError('Runtime subscribe must return unsubscribe');
    } catch (error) {
      attached = false;
      generation++;
      try { bridge.unsubscribe(onBridge); } catch { /* preserve original error */ }
      onBridge = undefined;
      unlistenHost = undefined;
      record('Runtime status subscription failed', error);
      return false;
    }
    const add = (target, type, fn) => {
      if (!target || typeof target.addEventListener !== 'function' ||
          typeof target.removeEventListener !== 'function') return;
      try { target.addEventListener(type, fn); listeners.push([target, type, fn]); }
      catch (error) { record('Browser lifecycle subscription failed', error); }
    };
    add(windowObject, 'pagehide', () => hide('page'));
    add(windowObject, 'pageshow', event => { if (event?.persisted) restore('page'); });
    add(documentObject, 'visibilitychange', () => {
      if (documentObject.visibilityState === 'hidden') hide('visibility');
      if (documentObject.visibilityState === 'visible') restore('visibility');
    });
    if (documentObject?.visibilityState === 'hidden') hide('visibility');
    return true;
  }
  function detach() {
    if (!attached) return;
    attached = false;
    generation++;
    try { unlistenHost?.(); } catch (error) { record('Runtime unsubscribe failed', error); }
    unlistenHost = undefined;
    try { bridge.unsubscribe(onBridge); }
    catch (error) { record('VK Bridge unsubscribe failed', error); }
    for (const [target, type, fn] of listeners) {
      try { target.removeEventListener(type, fn); }
      catch (error) { record('Browser lifecycle cleanup failed', error); }
    }
    listeners = [];
    onBridge = undefined;
    reasons.clear();
    ownsPause = false;
  }
  function setManualPaused(value) {
    if (typeof value !== 'boolean') throw new TypeError('Manual pause must be boolean');
    manualPaused = value;
    if (!value) attemptResume();
  }
  return Object.freeze({ attach, detach, setManualPaused,
    getStatus: () => attached ? 'ATTACHED' : 'DETACHED', getLastError: () => lastError });
}
