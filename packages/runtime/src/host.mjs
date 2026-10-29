import { createGameSession } from '@ludory/core';
import { validateRuntimeInputEvent } from './contracts.mjs';
import { RuntimeError } from './errors.mjs';
import { createInputQueue } from './input.mjs';
import { createFrameScheduler } from './scheduler.mjs';
import { createViewportTracker } from './viewport.mjs';
import { encodePersistedRecord, decodePersistedRecord } from './persistence.mjs';

const ACTIVE = new Set(['READY', 'RUNNING', 'PAUSED', 'STOPPED']);

function runtimeError(code, message, cause) {
  return new RuntimeError(code, { message, ...(cause === undefined ? {} : { cause }) });
}

function requiredMethod(value, method, name) {
  if (value === null || typeof value !== 'object' || typeof value[method] !== 'function') {
    throw new TypeError(`${name}.${method} must be a function`);
  }
}

/**
 * Engine-neutral Core host with bounded input and explicit persistence.
 */
export function createRuntimeHost(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Runtime host options must be an object');
  }
  const { game, initialState, update, renderer, input, environment, audio, storage, saveKey } = config;
  let status = 'IDLE';
  let lastError = null;
  let session = null;
  let scheduler = null;
  let operation = null;
  let mounted = false;
  let detachInput = null;
  let detachViewport = null;
  let inputGeneration = 0;
  let inputSince = null;
  let pendingSaves = 0;
  let saveTail = Promise.resolve();
  const subscribers = new Set();
  const subscriberErrors = [];
  const eventQueue = [];
  let dispatchingEvents = false;
  const inputQueue = createInputQueue({
    onOverflow(error) {
      emit({ schemaVersion: 1, type: 'error', status, errorCode: error.code });
    },
  });

  function emit(event) {
    eventQueue.push(event);
    if (dispatchingEvents) return;
    dispatchingEvents = true;
    try {
      while (eventQueue.length) {
        const next = eventQueue.shift();
        for (const listener of [...subscribers]) {
          try { listener({ ...next }); }
          catch (error) {
            subscriberErrors.push(error);
            if (subscriberErrors.length > 64) subscriberErrors.shift();
          }
        }
      }
    } finally {
      dispatchingEvents = false;
    }
  }

  function setStatus(next) {
    status = next;
    emit({ schemaVersion: 1, type: 'status', status });
  }

  function checkOperation() {
    if (operation !== null) {
      throw runtimeError('RUNTIME_OPERATION_IN_PROGRESS', `Runtime ${operation} is still in progress`);
    }
  }

  function requireStatus(accepted, action) {
    checkOperation();
    if (!accepted.includes(status)) {
      throw runtimeError('INVALID_RUNTIME_TRANSITION', `Cannot ${action} from ${status}`);
    }
  }

  function gameplayActive() {
    return status === 'RUNNING' && operation === null && session?.getStatus() === 'running';
  }

  function ingestInput(event, source) {
    if (!gameplayActive()) return false;
    try {
      const normalized = validateRuntimeInputEvent(event);
      if (normalized.source !== source) return false;
      if (inputSince === null || normalized.timestamp < inputSince) return false;
      return inputQueue.push(normalized);
    } catch (error) {
      // Invalid input is untrusted adapter data; ignore it without taking
      // down the running game or admitting malformed events to Core.
      if (error instanceof TypeError) return false;
      throw error;
    }
  }

  function safeDisable() {
    try { input?.disable(); } catch { /* disabled best-effort during fault/cleanup */ }
  }

  function safePauseAudio() {
    try { audio?.pauseAll?.(); } catch { /* optional audio must not stop gameplay */ }
  }

  function detachAdapters() {
    const listeners = [detachInput, detachViewport];
    detachInput = null;
    detachViewport = null;
    let firstError;
    for (const unsubscribe of listeners) {
      try { unsubscribe?.(); } catch (error) { firstError ??= error; }
    }
    return firstError;
  }

  function fail(error) {
    if (['FAULTED', 'DESTROYED'].includes(status)) return lastError;
    try { scheduler?.stop(); } catch { /* never leave gameplay scheduled */ }
    inputQueue.clear();
    inputSince = null;
    safeDisable();
    safePauseAudio();
    if (session && !['stopped', 'idle'].includes(session.getStatus())) {
      try { session.stop(); } catch { /* terminal fault remains the host boundary */ }
    }
    // R1 has no general FRAME_FAILED code; preserve the original cause and
    // do not introduce an unreviewed public error code in R2.
    const fault = runtimeError('INVALID_RUNTIME_TRANSITION', 'Runtime frame failed', error);
    lastError = fault;
    status = 'FAULTED';
    emit({ schemaVersion: 1, type: 'error', status, errorCode: fault.code });
    emit({ schemaVersion: 1, type: 'status', status });
    return fault;
  }

  function validateDependencies() {
    if (typeof update !== 'function' || Object.prototype.toString.call(update) === '[object AsyncFunction]') {
      throw new TypeError('Runtime update must be a synchronous function');
    }
    for (const method of ['mount', 'resize', 'render', 'unmount']) requiredMethod(renderer, method, 'renderer');
    for (const method of ['subscribe', 'enable', 'disable']) requiredMethod(input, method, 'input');
    for (const method of ['now', 'requestFrame', 'cancelFrame', 'observeViewport', 'getViewport']) {
      requiredMethod(environment, method, 'environment');
    }
    if (!('root' in environment)) throw new TypeError('environment.root is required');
    if (audio !== undefined) {
      for (const method of ['pauseAll', 'resumeAll']) requiredMethod(audio, method, 'audio');
    }
    if (storage !== undefined) {
      for (const method of ['load', 'save', 'clear']) requiredMethod(storage, method, 'storage');
      if (typeof saveKey !== 'string' || !saveKey.trim() ||
          typeof game?.id !== 'string' ||
          !(saveKey === game.id || saveKey.startsWith(`${game.id}:`) || saveKey.startsWith(`${game.id}/`))) {
        throw new TypeError('saveKey must be a non-empty game-namespaced storage key');
      }
    }
  }

  async function initialize() {
    requireStatus(['IDLE'], 'initialize');
    operation = 'initialize';
    const generation = ++inputGeneration;
    try {
      validateDependencies();
      inputQueue.clear();
      const viewportTracker = createViewportTracker({
        getViewport: () => environment.getViewport(),
        observeViewport: listener => environment.observeViewport(listener),
        onResize: viewport => renderer.resize(viewport),
        onError: fail,
        isActive: () => status !== 'FAULTED' &&
          (operation === 'initialize' || (operation === null && ['READY', 'RUNNING', 'PAUSED'].includes(status))),
      });
      const viewport = viewportTracker.initial();
      session = createGameSession({
        definition: game,
        initialState,
        onUpdate({ deltaMs, state, setState }) {
          return update({ deltaMs, inputs: inputQueue.drain(), state, setState });
        },
      });
      scheduler = createFrameScheduler({
        now: () => environment.now(),
        requestFrame: callback => environment.requestFrame(callback),
        cancelFrame: handle => environment.cancelFrame(handle),
        onFrame(deltaMs) {
          session.tick(deltaMs);
          // A synchronous update may pause/stop or begin async destruction.
          // Such a tick must not render against a suspended/unmounting adapter.
          if (status === 'RUNNING' && operation === null && session.getStatus() === 'running') {
            renderer.render(session.snapshot());
          }
        },
        onError: fail,
      });
      mounted = true; // mount may partially succeed before rejecting
      await renderer.mount({
        root: environment.root,
        viewport,
        snapshot: session.snapshot(),
        dispatchInput(event) {
          if (generation === inputGeneration) ingestInput(event, 'renderer');
        },
      });
      session.initialize();
      detachInput = input.subscribe(event => {
        if (generation === inputGeneration) ingestInput(event, 'input');
      });
      if (typeof detachInput !== 'function') throw new TypeError('input.subscribe must return unsubscribe');
      detachViewport = () => viewportTracker.detach();
      viewportTracker.attach();
      input.disable();
      if (status === 'FAULTED') throw lastError;
      lastError = null;
      setStatus('READY');
    } catch (error) {
      inputGeneration++;
      inputSince = null;
      try { scheduler?.stop(); } catch { /* best effort */ }
      inputQueue.clear();
      detachAdapters();
      safeDisable();
      if (mounted) {
        try { await renderer.unmount(); } catch { /* preserve mount failure as cause */ }
      }
      mounted = false;
      session = null;
      scheduler = null;
      status = 'IDLE';
      lastError = runtimeError('INITIALIZE_FAILED', 'Runtime initialization failed', error);
      throw lastError;
    } finally {
      operation = null;
    }
  }

  function start() {
    requireStatus(['READY'], 'start');
    try {
      const since = environment.now();
      if (typeof since !== 'number' || !Number.isFinite(since) || since < 0) {
        throw new TypeError('Runtime input clock must provide finite non-negative milliseconds');
      }
      session.start();
      inputSince = since;
      setStatus('RUNNING');
      if (gameplayActive()) input.enable();
      if (gameplayActive()) scheduler.start();
    } catch (error) {
      throw fail(error);
    }
  }

  function pause() {
    requireStatus(['RUNNING', 'PAUSED'], 'pause');
    if (status === 'PAUSED') return;
    try {
      scheduler.stop();
      input.disable();
      session.pause();
      inputQueue.clear();
      inputSince = null;
      safePauseAudio();
      setStatus('PAUSED');
    } catch (error) { throw fail(error); }
  }

  function resume() {
    requireStatus(['RUNNING', 'PAUSED'], 'resume');
    if (status === 'RUNNING') return;
    try {
      inputQueue.clear();
      const since = environment.now();
      if (typeof since !== 'number' || !Number.isFinite(since) || since < 0) {
        throw new TypeError('Runtime input clock must provide finite non-negative milliseconds');
      }
      session.resume();
      inputSince = since;
      setStatus('RUNNING');
      if (gameplayActive()) input.enable();
      if (gameplayActive()) {
        try { audio?.resumeAll?.(); } catch { /* audio is optional */ }
      }
      if (gameplayActive()) scheduler.start();
    } catch (error) { throw fail(error); }
  }

  function stop() {
    requireStatus(['READY', 'RUNNING', 'PAUSED', 'STOPPED'], 'stop');
    if (status === 'STOPPED') return;
    try {
      scheduler.stop();
      input.disable();
      inputQueue.clear();
      inputSince = null;
      session.stop();
      safePauseAudio();
      setStatus('STOPPED');
    } catch (error) { throw fail(error); }
  }

  async function destroy() {
    checkOperation();
    if (pendingSaves > 0) {
      throw runtimeError('RUNTIME_OPERATION_IN_PROGRESS', 'Runtime saves are still in progress');
    }
    if (status === 'DESTROYED') return;
    operation = 'destroy';
    inputGeneration++;
    inputSince = null;
    let cleanupError;
    try {
      try { scheduler?.stop(); } catch (error) { cleanupError ??= error; }
      inputQueue.clear();
      try { input?.disable(); } catch (error) { cleanupError ??= error; }
      if (session && !['stopped', 'idle'].includes(session.getStatus())) {
        try { session.stop(); } catch (error) { cleanupError ??= error; }
      }
      const detachError = detachAdapters();
      cleanupError ??= detachError;
      if (mounted) {
        try { await renderer.unmount(); } catch (error) { cleanupError ??= error; }
      }
      mounted = false;
      setStatus('DESTROYED');
      if (cleanupError) {
        lastError = runtimeError('INVALID_RUNTIME_TRANSITION', 'Runtime cleanup failed', cleanupError);
        throw lastError;
      }
    } finally {
      operation = null;
    }
  }

  function getSnapshot() {
    requireStatus(['READY', 'RUNNING', 'PAUSED', 'STOPPED', 'FAULTED'], 'getSnapshot');
    return session.snapshot();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Runtime subscriber must be a function');
    requireStatus(['IDLE', ...ACTIVE, 'FAULTED'], 'subscribe');
    subscribers.add(listener);
    return () => { subscribers.delete(listener); };
  }

  async function save() {
    requireStatus(['READY', 'RUNNING', 'PAUSED', 'STOPPED', 'FAULTED'], 'save');
    if (!storage) throw runtimeError('STORAGE_UNAVAILABLE', 'Runtime storage is not configured');
    const snapshot = session.snapshot();
    pendingSaves++;
    const run = async () => {
      try {
        const record = await encodePersistedRecord(snapshot, {
          savedAt: environment.utcNow?.(),
          digestSha256: typeof environment.digestSha256 === 'function'
            ? bytes => environment.digestSha256(bytes) : undefined,
        });
        try {
          const completed = storage.save(saveKey, record);
          if (!completed || typeof completed.then !== 'function') {
            throw new TypeError('RuntimeStorage.save must return a completion promise');
          }
          await completed;
        }
        catch (error) { throw runtimeError('SAVE_FAILED', 'Runtime save write failed', error); }
      } catch (error) {
        if (error instanceof RuntimeError && ['DIGEST_UNAVAILABLE', 'SAVE_FAILED'].includes(error.code)) throw error;
        throw runtimeError('SAVE_FAILED', 'Runtime save failed', error);
      } finally {
        pendingSaves--;
      }
    };
    const result = saveTail.then(run, run);
    saveTail = result.catch(() => {});
    return result;
  }

  async function restore() {
    requireStatus(['READY'], 'restore');
    if (pendingSaves > 0) {
      throw runtimeError('RUNTIME_OPERATION_IN_PROGRESS', 'Runtime saves are still in progress');
    }
    if (!storage) throw runtimeError('STORAGE_UNAVAILABLE', 'Runtime storage is not configured');
    if (typeof environment.digestSha256 !== 'function') {
      throw runtimeError('DIGEST_UNAVAILABLE', 'Runtime SHA-256 provider is unavailable');
    }
    operation = 'restore';
    try {
      let record;
      try { record = await storage.load(saveKey); }
      catch (error) {
        if (error instanceof RuntimeError && error.code === 'RESTORE_CORRUPT') throw error;
        throw runtimeError('RESTORE_FAILED', 'Runtime storage read failed', error);
      }
      if (record === null) throw runtimeError('RESTORE_FAILED', 'No saved record exists');
      const snapshot = await decodePersistedRecord(record, {
        game, digestSha256: bytes => environment.digestSha256(bytes),
      });
      try { session.restore(snapshot); }
      catch (error) { throw runtimeError('RESTORE_CORRUPT', 'Core rejected persisted state', error); }
      // Present the restored state before the first gameplay tick.
      try { renderer.render(session.snapshot()); }
      catch (error) { throw fail(error); }
    } finally {
      operation = null;
    }
  }

  return Object.freeze({
    initialize, start, pause, resume, save, restore, stop, destroy,
    getStatus: () => status, getSnapshot, getLastError: () => lastError, subscribe,
  });
}
