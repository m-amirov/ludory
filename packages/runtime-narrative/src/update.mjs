import { advanceNarrative, validateNarrativeState } from '@ludory/narrative';

const TOKEN = '[a-z][a-z0-9_-]{0,63}';
const ACTION_PATTERN = new RegExp(`^narrative:(next|choose|interact):(${TOKEN})(?::(${TOKEN}))?$`);

/** Encode a finite narrative command without user text or executable payloads. */
export function narrativeAction(type, beatId, optionId) {
  if (!['next', 'choose', 'interact'].includes(type) ||
      typeof beatId !== 'string' || !new RegExp(`^${TOKEN}$`).test(beatId) ||
      (type === 'next' ? optionId !== undefined : typeof optionId !== 'string' || !new RegExp(`^${TOKEN}$`).test(optionId))) {
    throw new TypeError('invalid narrative action');
  }
  return `narrative:${type}:${beatId}${optionId === undefined ? '' : `:${optionId}`}`;
}

function parseAction(value) {
  if (value === 'narrative:back') return { type: 'back' };
  if (typeof value !== 'string') return null;
  const match = ACTION_PATTERN.exec(value);
  if (!match || (match[1] === 'next' ? match[3] !== undefined : match[3] === undefined)) return null;
  return { type: match[1], beatId: match[2], ...(match[3] ? { optionId: match[3] } : {}) };
}

/**
 * Runtime update adapter. Core state.narrative is the only persisted game state.
 * Back snapshots are intentionally session-local and disappear on reload.
 */
export function createNarrativeRuntimeUpdate({ graph, catalog, historyLimit = 64 } = {}) {
  if (!graph || !catalog) throw new TypeError('graph and catalog required');
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > 256) {
    throw new TypeError('historyLimit must be between 0 and 256');
  }
  let history = [];
  let lastCanonical = null;

  function narrativeUpdate({ inputs, state, setState }) {
    if (!Array.isArray(inputs) || !inputs.length) return;
    if (!state || typeof state !== 'object' || typeof setState !== 'function') throw new TypeError('Runtime state required');
    let current = state.narrative;
    // A changed initial/externally restored snapshot starts a new undo session.
    const currentJson = JSON.stringify(current);
    if (lastCanonical !== null && lastCanonical !== currentJson) history = [];
    lastCanonical = currentJson;

    for (const event of inputs) {
      if (!event || !['pointer', 'keyboard', 'touch'].includes(event.type) ||
          event.phase !== 'up' || !['renderer', 'input'].includes(event.source)) continue;
      const action = parseAction(event.action);
      if (!action) continue;
      // Reject bad/corrupt restored state before processing an input.
      validateNarrativeState(graph, catalog, current);
      if (action.type === 'back') {
        if (!history.length) continue;
        current = history.pop();
      } else {
        let next;
        try { next = advanceNarrative(graph, catalog, current, action); }
        catch (error) {
          if (error instanceof TypeError) continue; // stale, unavailable or forged UI command
          throw error;
        }
        if (next.receipt.duplicate) continue;
        if (historyLimit > 0) {
          history.push(current);
          if (history.length > historyLimit) history.shift();
        }
        current = next.state;
      }
      // Core's setter owns the full immutable snapshot; no second persisted journal.
      state = { ...state, narrative: current };
      setState(state);
      lastCanonical = JSON.stringify(current);
    }
  }
  // Query only: UI visibility is tied to transient history, never to the persisted action log.
  Object.defineProperty(narrativeUpdate, 'canGoBack', { value: () => history.length > 0 });
  return narrativeUpdate;
}
