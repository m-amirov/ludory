import { validateViewport } from './contracts.mjs';

function sameViewport(a, b) {
  return a?.width === b.width && a.height === b.height && a.dpr === b.dpr && a.orientation === b.orientation;
}

/**
 * Tracks CSS pixel dimensions / DPR with a catch-up read after mount.
 * A detached observer ignores callbacks already queued by the environment.
 * No device-class or user-agent guessing is performed.
 */
export function createViewportTracker({ getViewport, observeViewport, onResize, onError, isActive = () => true }) {
  for (const [name, method] of Object.entries({ getViewport, observeViewport, onResize, onError, isActive })) {
    if (typeof method !== 'function') throw new TypeError(`Viewport tracker ${name} must be a function`);
  }
  let last = null;
  let unsubscribe = null;
  let generation = 0;

  function initial() {
    last = validateViewport(getViewport());
    return { ...last };
  }

  function apply(next) {
    const normalized = validateViewport(next);
    if (sameViewport(last, normalized)) return;
    last = normalized;
    onResize({ ...normalized });
  }

  function attach() {
    if (unsubscribe !== null) throw new TypeError('Viewport observer is already attached');
    const epoch = ++generation;
    const listener = next => {
      if (epoch !== generation || !isActive()) return;
      try { apply(next); } catch (error) { onError(error); }
    };
    const detached = observeViewport(listener);
    if (typeof detached !== 'function') throw new TypeError('Viewport observer must return unsubscribe');
    unsubscribe = detached;
    // A resize during an asynchronous renderer.mount happened before subscribe.
    // Reading again after subscribe closes that gap without losing newer events.
    if (isActive()) apply(getViewport());
  }

  function detach() {
    generation++;
    const detached = unsubscribe;
    unsubscribe = null;
    detached?.();
  }

  return Object.freeze({ initial, attach, detach });
}
