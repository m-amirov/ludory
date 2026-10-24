import { defineGame } from './definition.mjs';
import { assertOwnDataFields, createStateStore } from './state.mjs';

/** Host-driven, synchronous and platform-neutral game session. */
export function createGameSession({ definition, initialState = {}, onUpdate = () => {} } = {}) {
  const game = defineGame(definition);
  if (typeof onUpdate !== 'function') throw new TypeError('onUpdate must be a function');
  if (Object.prototype.toString.call(onUpdate) === '[object AsyncFunction]') {
    throw new TypeError('onUpdate must be synchronous');
  }
  const store = createStateStore(initialState);
  let status = 'idle';

  function transition(expected, next) {
    if (!expected.includes(status)) {
      throw new Error(`Invalid lifecycle transition: ${status} → ${next}`);
    }
    status = next;
  }

  return Object.freeze({
    getStatus: () => status,
    initialize: () => transition(['idle'], 'ready'),
    start: () => transition(['ready'], 'running'),
    pause: () => transition(['running'], 'paused'),
    resume: () => transition(['paused'], 'running'),
    stop: () => transition(['ready', 'running', 'paused'], 'stopped'),
    tick(deltaMs) {
      if (status !== 'running') throw new Error(`Cannot tick unless running (status: ${status})`);
      if (typeof deltaMs !== 'number' || !Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new TypeError('deltaMs must be a finite non-negative number');
      }
      let activeTick = true;
      const tickSetState = (next) => {
        if (!activeTick || status !== 'running') {
          throw new Error('Cannot update state outside the active tick');
        }
        store.setState(next);
      };
      try {
        const result = onUpdate({ deltaMs, state: store.getState(), setState: tickSetState });
        if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
          // An invalid asynchronous callback may reject after tick returns.
          Promise.resolve(result).catch(() => {});
          throw new TypeError('onUpdate must be synchronous');
        }
      } finally {
        activeTick = false;
      }
    },
    getState: store.getState,
    setState: store.setState,
    snapshot() {
      return {
        schemaVersion: 1,
        gameId: game.id,
        gameVersion: game.version,
        revision: store.getRevision(),
        state: store.getState(),
      };
    },
    restore(snapshot) {
      if (!['idle', 'ready'].includes(status)) {
        throw new Error(`Cannot restore after gameplay starts (status: ${status})`);
      }
      assertOwnDataFields(snapshot, ['schemaVersion', 'gameId', 'gameVersion', 'revision', 'state']);
      if (snapshot.schemaVersion !== 1 || snapshot.gameId !== game.id ||
          snapshot.gameVersion !== game.version) {
        throw new TypeError('snapshot schema, game ID or game version mismatch');
      }
      store.restore({ revision: snapshot.revision, state: snapshot.state });
    },
  });
}
