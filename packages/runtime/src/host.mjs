import { createGameSession } from '@ludory/core';
import { validateViewport } from './contracts.mjs';
import { RuntimeError } from './errors.mjs';
import { createFrameScheduler } from './scheduler.mjs';

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
 * R2 engine-neutral host. Persistence and game input ingestion are introduced
 * in R4 and R3 respectively; neither is reported as successful by R2.
 */
export function createRuntimeHost(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Runtime host options must be an object');
  }
  const { game, initialState, update, renderer, input, environment, audio } = config;
  let status = 'IDLE';
  let lastError = null;
  let session = null;
  let scheduler = null;
  let operation = null;
  let mounted = false;
  let detachInput = null;
  let detachViewport = null;
  const subscribers = new Set();
  const subscriberErrors = [];
  const eventQueue = [];
  let dispatchingEvents = false;

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
  }

  async function initialize() {
    requireStatus(['IDLE'], 'initialize');
    operation = 'initialize';
    try {
      validateDependencies();
      const viewport = validateViewport(environment.getViewport());
      session = createGameSession({
        definition: game,
        initialState,
        onUpdate({ deltaMs, state, setState }) {
          return update({ deltaMs, inputs: [], state, setState });
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
        dispatchInput() { throw runtimeError('INVALID_RUNTIME_TRANSITION', 'Runtime input is not available until R3'); },
      });
      session.initialize();
      // In R2 events are intentionally not fed to Core. R3 adds the shared
      // validator and 256-event queue to this subscription.
      detachInput = input.subscribe(() => {});
      if (typeof detachInput !== 'function') throw new TypeError('input.subscribe must return unsubscribe');
      detachViewport = environment.observeViewport(next => {
        if (operation !== null || !['READY', 'RUNNING', 'PAUSED'].includes(status)) return;
        try { renderer.resize(validateViewport(next)); }
        catch (error) { fail(error); }
      });
      if (typeof detachViewport !== 'function') throw new TypeError('environment.observeViewport must return unsubscribe');
      input.disable();
      lastError = null;
      setStatus('READY');
    } catch (error) {
      try { scheduler?.stop(); } catch { /* best effort */ }
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
      session.start();
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
      safePauseAudio();
      setStatus('PAUSED');
    } catch (error) { throw fail(error); }
  }

  function resume() {
    requireStatus(['RUNNING', 'PAUSED'], 'resume');
    if (status === 'RUNNING') return;
    try {
      session.resume();
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
      session.stop();
      safePauseAudio();
      setStatus('STOPPED');
    } catch (error) { throw fail(error); }
  }

  async function destroy() {
    checkOperation();
    if (status === 'DESTROYED') return;
    operation = 'destroy';
    let cleanupError;
    try {
      try { scheduler?.stop(); } catch (error) { cleanupError ??= error; }
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
    throw runtimeError('STORAGE_UNAVAILABLE', 'Runtime persistence is not implemented until R4');
  }

  async function restore() {
    requireStatus(['READY'], 'restore');
    throw runtimeError('STORAGE_UNAVAILABLE', 'Runtime persistence is not implemented until R4');
  }

  return Object.freeze({
    initialize, start, pause, resume, save, restore, stop, destroy,
    getStatus: () => status, getSnapshot, getLastError: () => lastError, subscribe,
  });
}
