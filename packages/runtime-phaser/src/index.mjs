import { validateRuntimeInputEvent, validateViewport } from '@ludory/runtime/contracts';

const isObject = value => value !== null && typeof value === 'object';

function copySnapshot(snapshot) {
  // A scene can mutate a view model; it must never mutate Core-owned state.
  return structuredClone(snapshot);
}

function destroyListenersIndividually(game, eventName) {
  // Phaser 3 uses EventEmitter3 records with {fn,context}. A partially
  // initialized TextureManager may throw from its destroy listener; one
  // broken subsystem must not skip the remaining listeners (input, scale…).
  const registry = game.events?._events;
  const registered = registry?.[eventName] ?? registry?.[`~${eventName}`];
  if (!registered) {
    game.events?.emit?.(eventName);
    return;
  }
  let failure;
  for (const listener of Array.isArray(registered) ? [...registered] : [registered]) {
    try { listener.fn.call(listener.context); } catch (error) { failure ??= error; }
  }
  // Partial-startup failures are recovered by explicit cleanup below; do
  // not surface one broken TextureManager as a failed unmount once its
  // callbacks and resources have been safely neutralized.
  return failure;
}

function releaseIncompleteTextures(game, Phaser) {
  const manager = game.textures;
  if (!manager || !manager.game) return;
  // addBase64() installs asynchronous Image.onload handlers which capture
  // the TextureManager. Make their eventual create() a no-op before removing
  // manager.game and renderer: otherwise they access game.renderer after
  // cancellation and crash the page with an uncaught error.
  manager.create = () => null;
  manager.removeAllListeners?.();
  // TextureManager.destroy assumes `stamp` exists; pre-boot texture failure
  // can leave it undefined. Release each initialized texture independently.
  for (const texture of Object.values(manager.list ?? {})) {
    try { texture?.destroy?.(); } catch { /* may be only partly initialized */ }
  }
  manager.list = {};
  try { manager.stamp?.destroy?.(); } catch { /* not yet initialized */ }
  manager.stamp = null;
  if (manager._tempCanvas) Phaser.Display?.Canvas?.CanvasPool?.remove?.(manager._tempCanvas);
  manager._tempCanvas = null;
  manager.game = null;
}

function destroyStalledGame(game, Phaser) {
  // Phaser 3's next-frame destroy cannot execute before its loop starts.
  // runDestroy() is the normal internal disposal path, but the SceneManager
  // can itself be incompletely booted (systemScene.sys is still undefined).
  // In that case release initialized subsystems individually and detach DOM.
  try {
    if (typeof game.runDestroy === 'function') game.runDestroy();
    else return;
  } catch {
    const cleanup = [
      () => destroyListenersIndividually(game, Phaser.Core?.Events?.DESTROY ?? 'destroy'),
      () => releaseIncompleteTextures(game, Phaser),
      () => game.events?.removeAllListeners?.(),
      () => game.renderer?.destroy?.(),
      () => Phaser.Display?.Canvas?.CanvasPool?.remove?.(game.canvas),
      () => game.canvas?.parentNode?.removeChild(game.canvas),
      () => game.domContainer?.parentNode?.removeChild(game.domContainer),
      () => game.loop?.destroy?.(),
    ];
    let failure;
    for (const action of cleanup) {
      try { action(); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }
}

async function destroyOwnedGame(game, Phaser) {
  game.destroy(true, false);
  // Game.isRunning is not reset by TimeStep.stop(). A stopped loop has no
  // future step to execute Phaser's queued runDestroy(). But Game.start()
  // sets isRunning=true and invokes postBoot BEFORE calling loop.start().
  // Defer the decision one microtask so a reentrant postBoot unmount cannot
  // destroy the loop while Phaser is about to start it in the same stack.
  if (game.isRunning === true && game.loop?.running === false) await Promise.resolve();
  if (game.isRunning === false || game.loop?.running === false) {
    destroyStalledGame(game, Phaser);
  }
}

/**
 * Create a RuntimeRenderer backed by an explicitly injected Phaser 3 constructor.
 * Phaser is deliberately not imported here: Core, Runtime and Node callers remain
 * usable without a browser or the optional Phaser package installed.
 *
 * sceneFactory({ Phaser, root, viewport, snapshot, dispatchInput }) returns:
 * { scene, renderSnapshot(snapshot), onResize?(viewport), dispose?() }.
 * `scene` is a Phaser scene configuration/instance, not created by this package.
 *
 * `game.destroy(true, false)` requests Phaser canvas removal; Phaser performs
 * the actual disposal on its next game step, not synchronously in unmount().
 */
export function createPhaserRenderer({ Phaser, sceneFactory, gameConfig = {}, readyTimeoutMs = 10_000 } = {}) {
  if (!isObject(Phaser) || typeof Phaser.Game !== 'function') {
    throw new TypeError('Phaser.Game constructor must be injected');
  }
  if (typeof sceneFactory !== 'function') throw new TypeError('sceneFactory must be a function');
  if (!isObject(gameConfig) || Array.isArray(gameConfig)) throw new TypeError('gameConfig must be an object');
  if (!Number.isSafeInteger(readyTimeoutMs) || readyTimeoutMs <= 0) {
    throw new TypeError('readyTimeoutMs must be a positive safe integer');
  }

  let active = null;
  let generation = 0;
  let pendingRelease = null;

  function release(state) {
    if (state.releasePromise) return state.releasePromise;
    if (state.released) return pendingRelease ?? Promise.resolve();
    state.released = true;
    generation++;
    if (active === state) active = null;

    state.cancelBoot?.();
    // An async stopped-loop fallback may outlive the initial unmount call.
    // Share exactly one completion Promise across concurrent unmounts,
    // interrupted mounts, and any remount waiting for prior teardown.
    const cleanup = (async () => {
      let firstError;
      try {
        if (state.game) await destroyOwnedGame(state.game, Phaser);
      } catch (error) { firstError = error; }
      try { state.scene?.dispose?.(); } catch (error) { firstError ??= error; }
      if (firstError) throw firstError;
    })();
    state.releasePromise = cleanup;
    pendingRelease = cleanup;
    void cleanup.then(
      () => { if (pendingRelease === cleanup) pendingRelease = null; },
      () => { if (pendingRelease === cleanup) pendingRelease = null; },
    );
    return cleanup;
  }

  function requireActive() {
    if (!active || active.released || !active.ready) throw new Error('Phaser renderer is not mounted');
    return active;
  }

  return {
    async mount({ root, viewport, snapshot, dispatchInput }) {
      // Do not queue an invisible mount while another game is being torn
      // down: a later unmount could only observe the old release and would
      // be unable to cancel that queued game. Callers may retry after they
      // have awaited the first unmount.
      if (pendingRelease) throw new Error('Phaser renderer is still unmounting');
      if (active) throw new Error('Phaser renderer is already mounted');
      if (!root) throw new TypeError('root is required');
      if (typeof dispatchInput !== 'function') throw new TypeError('dispatchInput must be a function');
      const initialViewport = validateViewport(viewport);
      const token = ++generation;
      const state = { released: false, ready: false, game: null, scene: null, token };
      active = state;
      try {
        const guardedInput = event => {
          if (active !== state || state.released || !state.ready || token !== generation) return false;
          try {
            const normalized = validateRuntimeInputEvent(event);
            if (normalized.source !== 'renderer') return false;
            dispatchInput(normalized);
            return true;
          } catch {
            return false;
          }
        };
        const scene = sceneFactory({ Phaser, root, viewport: initialViewport,
          snapshot: copySnapshot(snapshot), dispatchInput: guardedInput });
        // A factory may synchronously unmount before returning its scene.
        // Release could not dispose a scene it did not yet own.
        if (state.released || active !== state) {
          try { scene?.dispose?.(); } catch (error) {
            throw new Error('Phaser mount was interrupted', { cause: error });
          }
          throw new Error('Phaser mount was interrupted');
        }
        if (!isObject(scene) || !scene.scene || typeof scene.renderSnapshot !== 'function') {
          throw new TypeError('sceneFactory must return { scene, renderSnapshot }');
        }
        state.scene = scene;
        // Observe scene readiness before awaiting Phaser boot. A scene can
        // reject while Phaser is still loading textures; never leave that
        // rejection unhandled until the engine's own timeout expires.
        let sceneReady = null;
        if (scene.ready !== undefined) {
          if (!scene.ready || typeof scene.ready.then !== 'function') {
            throw new TypeError('sceneFactory ready must be a Promise');
          }
          sceneReady = Promise.resolve(scene.ready);
          sceneReady.catch(reason => {
            const error = reason instanceof Error ? reason : new Error('Phaser scene ready rejected');
            state.cancelBoot?.(error);
          });
        }
        // Phaser.Game binds its boot method to DOMContentLoaded inside its
        // constructor. That bound callback cannot be cancelled afterward.
        // Do not construct the game until the root document is ready; this
        // wait *is* cancellable if Runtime unmounts during HTML parsing.
        const ownerDocument = root.ownerDocument;
        if (ownerDocument?.readyState === 'loading') {
          await new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              ownerDocument.removeEventListener('DOMContentLoaded', onReady);
              state.cancelBoot = null;
              if (error) reject(error);
              else resolve();
            };
            const onReady = () => finish();
            const timer = setTimeout(() => finish(new Error('Phaser DOM ready timed out')), readyTimeoutMs);
            state.cancelBoot = reason => finish(reason ?? new Error('Phaser mount was interrupted'));
            ownerDocument.addEventListener('DOMContentLoaded', onReady);
            if (ownerDocument.readyState !== 'loading') onReady();
          });
        }
        if (active !== state || state.released) throw new Error('Phaser mount was interrupted');
        const game = new Phaser.Game({
          ...gameConfig,
          type: gameConfig.type ?? Phaser.AUTO,
          scale: { ...(gameConfig.scale ?? {}), mode: Phaser.Scale?.NONE ?? 0,
            parent: root, width: initialViewport.width, height: initialViewport.height },
          parent: root,
          width: initialViewport.width,
          height: initialViewport.height,
          scene: scene.scene,
        });
        state.game = game;
        // Phaser may synchronously invoke preBoot callbacks in its Game
        // constructor. If one unmounts, release saw no game yet, so dispose
        // this newly returned instance without touching any newer mount.
        if (state.released || active !== state) {
          try { await destroyOwnedGame(game, Phaser); } catch (error) {
            throw new Error('Phaser mount was interrupted', { cause: error });
          }
          throw new Error('Phaser mount was interrupted');
        }

        // Phaser 3 sets isBooted before its asynchronous texture ready event;
        // isRunning is the stronger signal that the engine finished startup.
        if (state.game.isRunning === false ||
            (state.game.isRunning === undefined && state.game.isBooted === false)) {
          await new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              state.game?.events?.off?.('ready', onReady);
              state.cancelBoot = null;
              if (error) reject(error);
              else resolve();
            };
            const onReady = () => finish();
            const onTimeout = () => finish(new Error('Phaser boot timed out'));
            const timer = setTimeout(onTimeout, readyTimeoutMs);
            state.cancelBoot = reason => finish(reason ?? new Error('Phaser mount was interrupted'));
            try {
              state.game.events.on('ready', onReady);
              if (state.game.isRunning === true) onReady();
            } catch (error) {
              finish(error);
            }
          });
        }
        if (sceneReady) {
          await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (failed, error) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              state.cancelBoot = null;
              if (failed) reject(error);
              else resolve();
            };
            const timer = setTimeout(() => finish(true, new Error('Phaser scene ready timed out')), readyTimeoutMs);
            state.cancelBoot = reason => finish(true, reason ?? new Error('Phaser mount was interrupted'));
            sceneReady.then(() => finish(false), reason => {
              finish(true, reason instanceof Error ? reason : new Error('Phaser scene ready rejected'));
            });
          });
        }
        if (active !== state || state.released) throw new Error('Phaser mount was interrupted');
        state.ready = true;
      } catch (error) {
        try { await release(state); } catch (cleanupError) { error.cause = cleanupError; }
        throw error;
      }
    },
    resize(viewport) {
      const state = requireActive();
      const resized = validateViewport(viewport);
      state.game.scale.resize(resized.width, resized.height);
      state.scene.onResize?.(resized);
    },
    render(snapshot) {
      requireActive().scene.renderSnapshot(copySnapshot(snapshot));
    },
    async unmount() {
      if (active) await release(active);
      else if (pendingRelease) await pendingRelease;
    },
  };
}
