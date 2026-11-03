import { applyEconomyOperation, createEconomyState, defineEconomy,
  getEconomyView, validateEconomyState } from '@ludory/economy';
import { assertPremiumManifest, assertPremiumManifestGraph } from './manifest.mjs';

/** Inject an explicit durable record port; this is not a platform storage implementation. */
export function createEconomyRuntime({ config: rawConfig, manifest: rawManifest, graph, storage } = {}) {
  const config = defineEconomy(rawConfig);
  const manifest = assertPremiumManifest(rawManifest);
  // A runtime must not treat renamed premium choices as unknown/free. This is
  // enforced at composition time and again by the Narrative update adapter.
  if (config.enabled) assertPremiumManifestGraph(manifest, graph);
  const premium = new Map();
  for (const entry of manifest.choices) {
    if (!Object.hasOwn(config.premium, entry.contentId) ||
        config.premium[entry.contentId].cost !== entry.cost) {
      throw new TypeError('premium manifest does not match economy config');
    }
    premium.set(`${entry.beatId}:${entry.choiceId}`, entry);
  }

  let state = null;
  let ready = false;
  let initialized = false;
  let needsReload = false;
  let disposed = false;
  let revision = 0;
  let tail = Promise.resolve();

  function assertLive() { if (disposed) throw new TypeError('economy runtime disposed'); }
  function enqueue(action) {
    const result = tail.then(action, action);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  function activeStorage() {
    if (!storage || typeof storage.load !== 'function' || typeof storage.save !== 'function') {
      throw new TypeError('durable economy storage adapter required');
    }
  }
  async function store(value) {
    assertLive();
    if (await storage.save(value) !== true) throw new TypeError('economy save did not acknowledge durability');
    assertLive();
  }
  async function load() {
    assertLive(); activeStorage();
    // An absent record is brand-new, not a corrupt paid wallet. Do not auto-grant currency here.
    const raw = await storage.load();
    assertLive();
    let restored;
    if (raw === null) {
      restored = createEconomyState(config);
      await store(restored);
    } else restored = validateEconomyState(config, raw);
    assertLive();
    state = restored;
    ready = true;
    needsReload = false;
    revision++;
  }

  const authorizeChoice = ({ beatId, optionId } = {}) => api.getChoiceAccess(beatId, optionId).unlocked;
  Object.defineProperty(authorizeChoice, 'assertGraphCompatibility', {
    value: currentGraph => { if (config.enabled) assertPremiumManifestGraph(manifest, currentGraph); },
  });

  const api = {
    initialize() {
      return enqueue(async () => {
        assertLive();
        initialized = true;
        if (!config.enabled) return api.getView();
        if (ready && !needsReload) return api.getView();
        ready = false;
        revision++;
        try { await load(); }
        catch (error) { ready = false; needsReload = true; revision++; throw error; }
        return api.getView();
      });
    },
    getRevision() { return revision; },
    getChoiceAccess(beatId, choiceId) {
      const entry = premium.get(`${beatId}:${choiceId}`);
      if (!config.enabled || !entry) return Object.freeze({ premium: false, unlocked: true, cost: 0, status: 'free' });
      if (!ready || !state) return Object.freeze({ premium: true, unlocked: false, cost: entry.cost, status: 'unavailable' });
      const unlocked = state.entitlements.includes(entry.contentId);
      return Object.freeze({ premium: true, unlocked, cost: entry.cost, status: unlocked ? 'unlocked' : 'locked' });
    },
    authorizeChoice,
    assertGraphCompatibility(currentGraph) {
      if (config.enabled) assertPremiumManifestGraph(manifest, currentGraph);
    },
    getView() {
      if (!config.enabled) return Object.freeze({ enabled: false, ready: true, balance: null,
        currency: config.currency, entitlements: Object.freeze([]) });
      if (!ready || !state) return Object.freeze({ enabled: true, ready: false, balance: null,
        currency: config.currency, entitlements: Object.freeze([]) });
      return Object.freeze({ ...getEconomyView(config, state), ready: true });
    },
    unlockChoice(beatId, choiceId) {
      return enqueue(async () => {
        assertLive();
        if (!config.enabled) throw new TypeError('economy disabled');
        if (!initialized) throw new TypeError('economy is not initialized');
        const entry = premium.get(`${beatId}:${choiceId}`);
        if (!entry) throw new TypeError('not an authored premium choice');
        if (!ready || needsReload) {
          try { await load(); }
          catch (error) { ready = false; needsReload = true; revision++; throw error; }
        }
        if (state.entitlements.includes(entry.contentId)) {
          return Object.freeze({ applied: false, contentId: entry.contentId, balance: state.balance });
        }
        // The spending operation determines cost; no amount comes from a renderer event.
        const result = applyEconomyOperation(config, state, { type: 'UNLOCK_PREMIUM', contentId: entry.contentId });
        ready = false;
        revision++;
        try { await store(result.state); }
        catch (error) { ready = false; needsReload = true; revision++; throw error; }
        assertLive();
        state = result.state;
        ready = true;
        needsReload = false;
        revision++;
        return Object.freeze({ applied: result.receipt.applied, contentId: entry.contentId, balance: state.balance });
      });
    },
    dispose() { disposed = true; ready = false; revision++; },
  };
  return Object.freeze(api);
}
