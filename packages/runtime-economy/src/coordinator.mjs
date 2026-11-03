import { applyEconomyOperation, createEconomyState, defineEconomy,
  getEconomyView, validateEconomyState } from '@ludory/economy';
import { assertPremiumManifest, assertPremiumManifestGraph } from './manifest.mjs';

/** Inject an explicit durable record port; this is not a platform storage implementation. */
export function createEconomyRuntime({ config: rawConfig, manifest: rawManifest, graph, storage, episodeIds: rawEpisodeIds,
  ads, purchases, activeSkus: rawActiveSkus = [], utcNow = () => new Date(), newAttemptId = () => {
    if (typeof globalThis.crypto?.randomUUID !== 'function') throw new TypeError('secure rewarded attempt ID unavailable');
    return `ad_${globalThis.crypto.randomUUID()}`;
  } } = {}) {
  const config = defineEconomy(rawConfig);
  if (!Array.isArray(rawActiveSkus) || rawActiveSkus.length > 1024) throw new TypeError('activeSkus must be a bounded array');
  const activeSkus = new Set();
  for (const sku of rawActiveSkus) {
    if (typeof sku !== 'string' || !Object.hasOwn(config.products, sku) || activeSkus.has(sku)) {
      throw new TypeError('activeSkus must be unique known product identifiers');
    }
    activeSkus.add(sku);
  }
  if (config.enabled && purchases) {
    if (storage?.purchaseCloud !== true) throw new TypeError('Yandex purchases require acknowledged cloud economy storage');
    if (['getCatalog', 'purchase', 'getPurchases', 'consumePurchase', 'runExclusive']
      .some(name => typeof purchases[name] !== 'function')) throw new TypeError('Incomplete payments adapter');
  }
  const hasPremium = Object.keys(config.premium).length > 0;
  if (hasPremium && rawManifest === undefined) throw new TypeError('premium manifest required for configured premium content');
  const manifest = rawManifest === undefined ? { choices: [] } : assertPremiumManifest(rawManifest);
  if (rawEpisodeIds !== undefined && (!Array.isArray(rawEpisodeIds) || rawEpisodeIds.length > 1024)) {
    throw new TypeError('authored episodeIds must be a bounded array');
  }
  const episodeIds = new Set();
  for (const episodeId of rawEpisodeIds ?? []) {
    if (typeof episodeId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(episodeId) ||
        episodeIds.has(episodeId)) throw new TypeError('authored episodeIds contain an invalid or duplicate episode');
    episodeIds.add(episodeId);
  }
  // A runtime must not treat renamed premium choices as unknown/free. This is
  // enforced at composition time and again by the Narrative update adapter.
  if (config.enabled && rawManifest !== undefined) assertPremiumManifestGraph(manifest, graph);
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
  let pendingRewardId = null;
  let rewardedFlight = null;
  let virginLoadAllowed = true;
  let purchasesReconciled = !config.enabled || !purchases;

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
      // Null is safe only for the first-ever read of this runtime. Once an
      // acknowledged or attempted wallet exists, a missing record must never
      // overwrite potentially paid entitlements with an empty snapshot.
      if (!virginLoadAllowed) throw new TypeError('economy wallet record missing after prior load');
      virginLoadAllowed = false;
      restored = createEconomyState(config);
      await store(restored);
    } else {
      virginLoadAllowed = false;
      restored = validateEconomyState(config, raw);
    }
    assertLive();
    state = restored;
    ready = true;
    needsReload = false;
    revision++;
  }

  async function ensureReady() {
    assertLive();
    if (!config.enabled) throw new TypeError('economy disabled');
    if (!initialized) throw new TypeError('economy is not initialized');
    if (!ready || needsReload) {
      try { await load(); }
      catch (error) { ready = false; needsReload = true; revision++; throw error; }
    }
  }
  function assertNoPendingReward() {
    if (pendingRewardId !== null) throw new TypeError('rewarded grant pending; retryPendingReward required');
  }
  async function commit(candidate) {
    if (!candidate.receipt.applied) return Object.freeze({ ...candidate.receipt });
    ready = false;
    revision++;
    try { await store(candidate.state); }
    catch (error) { ready = false; needsReload = true; revision++; throw error; }
    assertLive();
    state = candidate.state;
    ready = true;
    needsReload = false;
    revision++;
    return Object.freeze({ ...candidate.receipt });
  }
  async function grant(operation) {
    await ensureReady();
    assertNoPendingReward();
    return mutateUnderPurchaseLock(() => commit(applyEconomyOperation(config, state, operation)));
  }
  async function mutateUnderPurchaseLock(action, { forceReload = false } = {}) {
    if (!purchases) {
      if (forceReload) await load();
      return action();
    }
    // Any wallet mutation, not just IAP, can overwrite a committed token if
    // it uses a stale in-memory snapshot from another tab.
    return purchases.runExclusive(async () => {
      await load();
      return action();
    });
  }
  function currentUtcDay() {
    if (typeof utcNow !== 'function') throw new TypeError('utcNow must be a clock function');
    const date = utcNow();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('utcNow must return a valid Date');
    return date.toISOString().slice(0, 10);
  }
  function rewardedOperation(attemptId) {
    if (typeof attemptId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(attemptId)) {
      throw new TypeError('rewarded attemptId must be a lowercase safe ID');
    }
    return { type: 'GRANT_REWARDED', attemptId };
  }

  function requirePurchases() {
    if (!purchases) throw new TypeError('Yandex purchases are not configured');
    if (storage?.purchaseCloud !== true) throw new TypeError('Yandex purchases require cloud storage');
  }
  async function digestToken(token) {
    if (typeof token !== 'string' || !token || token.length > 4096) throw new TypeError('Invalid SDK purchase token');
    if (typeof globalThis.crypto?.subtle?.digest !== 'function') throw new TypeError('Secure SHA-256 unavailable');
    const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  async function fulfillPurchase(item, expectedSku) {
    if (!item || typeof item !== 'object' || typeof item.productID !== 'string' ||
        !Object.hasOwn(config.products, item.productID) ||
        (expectedSku !== undefined && item.productID !== expectedSku)) {
      throw new TypeError('Unknown or mismatched SDK purchase product');
    }
    const tokenDigest = await digestToken(item.purchaseToken);
    // Re-read under the payment lock: an ambiguous previous cloud write may
    // have persisted the idempotency evidence even though its ack was lost.
    await load();
    assertNoPendingReward();
    const receipt = await commit(applyEconomyOperation(config, state,
      { type: 'GRANT_PURCHASE', sku: item.productID, tokenDigest }));
    // Never consume until the wallet and token digest are durably acknowledged.
    await purchases.consumePurchase(item.purchaseToken);
    assertLive();
    return receipt;
  }
  async function catalog() {
    const raw = await purchases.getCatalog();
    if (!Array.isArray(raw)) throw new TypeError('SDK catalog must be an array');
    return Object.freeze(raw.filter(item => item && activeSkus.has(item.id)).map(item => Object.freeze({
      id: item.id, currencyAmount: config.products[item.id].currencyAmount, title: item.title,
      price: item.price, priceValue: item.priceValue,
      priceCurrencyCode: item.priceCurrencyCode, priceCurrencyImage: item.priceCurrencyImage,
    })));
  }
  async function reconcileOutstanding() {
    const outstanding = await purchases.getPurchases();
    if (!Array.isArray(outstanding)) throw new TypeError('Invalid outstanding purchase inventory');
    let processed = 0, credited = 0, unknownSkus = 0;
    for (const item of outstanding) {
      if (typeof item?.productID !== 'string' || !Object.hasOwn(config.products, item.productID)) {
        unknownSkus++;
        continue; // Unknown old SKU remains outstanding for support resolution.
      }
      const receipt = await fulfillPurchase(item);
      processed++;
      if (receipt.applied) credited++;
    }
    purchasesReconciled = true;
    return Object.freeze({ processed, credited, unknownSkus });
  }

  const authorizeChoice = ({ beatId, optionId } = {}) => api.getChoiceAccess(beatId, optionId).unlocked;
  Object.defineProperty(authorizeChoice, 'assertGraphCompatibility', {
    value: currentGraph => { if (config.enabled && rawManifest !== undefined) assertPremiumManifestGraph(manifest, currentGraph); },
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
        try {
          // First-ever null records are written as zero snapshots. Guard that
          // read+create+save sequence against same-origin payment mutations.
          if (purchases) await purchases.runExclusive(() => load());
          else await load();
        }
        catch (error) { ready = false; needsReload = true; revision++; throw error; }
        return api.getView();
      });
    },
    getRevision() { return revision; },
    getChoiceAccess(beatId, choiceId) {
      const entry = premium.get(`${beatId}:${choiceId}`);
      if (!config.enabled || !entry) return Object.freeze({ premium: false, unlocked: true, cost: 0, status: 'free' });
      if (!ready || !state || pendingRewardId !== null || !purchasesReconciled) return Object.freeze({ premium: true, unlocked: false, cost: entry.cost, status: 'unavailable' });
      const unlocked = state.entitlements.includes(entry.contentId);
      return Object.freeze({ premium: true, unlocked, cost: entry.cost, status: unlocked ? 'unlocked' : 'locked' });
    },
    authorizeChoice,
    assertGraphCompatibility(currentGraph) {
      if (config.enabled && rawManifest !== undefined) assertPremiumManifestGraph(manifest, currentGraph);
    },
    getView() {
      if (!config.enabled) return Object.freeze({ enabled: false, ready: true, balance: null,
        currency: config.currency, entitlements: Object.freeze([]), pendingReward: false });
      if (!ready || !state || pendingRewardId !== null) return Object.freeze({ enabled: true, ready: false, balance: null,
        currency: config.currency, entitlements: Object.freeze([]), pendingReward: pendingRewardId !== null });
      return Object.freeze({ ...getEconomyView(config, state), ready: true, pendingReward: false });
    },
    getRewardsView() {
      const usable = config.enabled && ready && state !== null && pendingRewardId === null;
      const day = usable ? currentUtcDay() : null;
      const lastClaim = usable ? state.lastDailyClaim : null;
      return Object.freeze({
        enabled: config.enabled,
        ready: !config.enabled || Boolean(usable),
        amounts: Object.freeze({ ...config.rewards }),
        pendingReward: pendingRewardId !== null,
        daily: Object.freeze({ utcDate: day, lastClaim,
          eligible: day !== null && (lastClaim === null || day > lastClaim) }),
      });
    },
    getStoreCatalog() {
      return enqueue(async () => {
        if (!config.enabled) return Object.freeze([]);
        await ensureReady();
        requirePurchases();
        assertNoPendingReward();
        return purchases.runExclusive(() => catalog());
      });
    },
    purchaseProduct(sku) {
      return enqueue(async () => {
        await ensureReady();
        requirePurchases();
        assertNoPendingReward();
        if (!activeSkus.has(sku)) throw new TypeError('Inactive or unknown purchase SKU');
        purchasesReconciled = false;
        try {
          return await purchases.runExclusive(async () => {
            await load();
            // Reconcile pre-existing unconsumed purchases before initiating a new charge.
            await reconcileOutstanding();
            const offered = await catalog();
            if (!offered.some(item => item.id === sku)) throw new TypeError('Product absent from SDK catalog');
            const purchased = await purchases.purchase(sku);
            return fulfillPurchase(purchased, sku);
          });
        } catch (error) { purchasesReconciled = false; throw error; }
      });
    },
    restorePurchases() {
      return enqueue(async () => {
        await ensureReady();
        requirePurchases();
        assertNoPendingReward();
        purchasesReconciled = false;
        return purchases.runExclusive(async () => {
          await load();
          return reconcileOutstanding();
        });
      });
    },
    grantStarter() { return enqueue(() => grant({ type: 'GRANT_STARTER' })); },
    grantEpisode(episodeId) {
      return enqueue(() => {
        if (!episodeIds.has(episodeId)) throw new TypeError('episodeId is not an authored episode');
        return grant({ type: 'GRANT_EPISODE', episodeId });
      });
    },
    claimDaily() { return enqueue(() => grant({ type: 'GRANT_DAILY', date: currentUtcDay() })); },
    claimRewarded() {
      if (rewardedFlight) return rewardedFlight;
      const flight = enqueue(async () => {
        await ensureReady();
        assertNoPendingReward();
        if (!ads || typeof ads.showRewarded !== 'function') throw new TypeError('rewarded ads adapter unavailable');
        if (typeof newAttemptId !== 'function') throw new TypeError('newAttemptId must be a function');
        const attemptId = newAttemptId();
        const operation = rewardedOperation(attemptId);
        // Preflight invalid/duplicate IDs and balance capacity before showing an ad.
        const candidate = applyEconomyOperation(config, state, operation);
        if (!candidate.receipt.applied) throw new TypeError('rewarded attempt ID already used');
        const result = await ads.showRewarded();
        assertLive();
        if (result?.shown !== true || result?.rewarded !== true) {
          throw new TypeError('rewarded ad was not verified as completed');
        }
        pendingRewardId = attemptId;
        revision++;
        const receipt = await mutateUnderPurchaseLock(() => commit(applyEconomyOperation(config, state, operation)));
        pendingRewardId = null;
        revision++;
        return receipt;
      });
      rewardedFlight = flight;
      void flight.then(() => { if (rewardedFlight === flight) rewardedFlight = null; },
        () => { if (rewardedFlight === flight) rewardedFlight = null; });
      return flight;
    },
    retryPendingReward() {
      return enqueue(async () => {
        assertLive();
        if (!initialized) throw new TypeError('economy is not initialized');
        if (pendingRewardId === null) throw new TypeError('no pending rewarded grant to retry');
        // Always consult durable storage: the previous write may have committed but lost its ack.
        let receipt;
        try {
          receipt = await mutateUnderPurchaseLock(() => commit(
            applyEconomyOperation(config, state, rewardedOperation(pendingRewardId))), { forceReload: true });
        } catch (error) { ready = false; needsReload = true; revision++; throw error; }
        assertLive();
        pendingRewardId = null;
        revision++;
        return receipt;
      });
    },
    unlockChoice(beatId, choiceId) {
      return enqueue(async () => {
        await ensureReady();
        assertNoPendingReward();
        if (!purchasesReconciled) throw new TypeError('Restore outstanding purchases before premium spending');
        return mutateUnderPurchaseLock(async () => {
          const entry = premium.get(`${beatId}:${choiceId}`);
          if (!entry) throw new TypeError('not an authored premium choice');
          if (state.entitlements.includes(entry.contentId)) {
            return Object.freeze({ applied: false, contentId: entry.contentId, balance: state.balance });
          }
          // The spending operation determines cost; no amount comes from a renderer event.
          const result = applyEconomyOperation(config, state, { type: 'UNLOCK_PREMIUM', contentId: entry.contentId });
          const receipt = await commit(result);
          return Object.freeze({ applied: receipt.applied, contentId: entry.contentId, balance: receipt.balance });
        });
      });
    },
    dispose() { disposed = true; ready = false; revision++; },
  };
  return Object.freeze(api);
}
