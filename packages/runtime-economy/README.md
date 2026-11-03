# @ludory/runtime-economy (E3)

Optional, browser-portable premium Narrative v1 composition and rewards coordinator. **Disabled by default in all Ludory games.** This is an infrastructure layer, **not** a verified payment gateway or a cloud persistence adapter.

## Authoring

Keep the ordinary Narrative Graph v1 untouched. Mark optional choices in an additional sidecar; the price always comes from `defineEconomy()` configuration.

```js
import { defineEconomy } from '@ludory/economy';
import { definePremiumManifest, verifyFreeNarrativePaths, createEconomyRuntime } from '@ludory/runtime-economy';
import { createNarrativeRuntimeUpdate, createNarrativeRenderer } from '@ludory/runtime-narrative';

const economyConfig = defineEconomy(gameEconomyConfig); // author-owned, initially enabled:false
const manifest = definePremiumManifest({ schemaVersion: 1, choices: [
  { beatId: 'fork', choiceId: 'intimate', contentId: 'private_time' },
] }, { graph, economyConfig });

const evidence = verifyFreeNarrativePaths({ graph, catalog, manifest,
  terminals: [{ endingId: 'good', routeId: 'partner' }],
  traces: [{ endingId: 'good', routeId: 'partner', actions: [
    // Complete authored no-premium action trace including next/interact/choose.
  ] }],
});
```

`verifyFreeNarrativePaths` rejects a free-reachable scene with no free ending path, a choice beat with no free option, stale/invalid actions, premium steps in a witness trace, and missing declared terminal witnesses. It proves **only the explicitly declared traces** plus structural reachability (which ignores predicate feasibility). Author-defined good endings need an explicit free trace; there is no automatic subjective good/bad-ending classification.

## Runtime wiring

```js
const wallet = createEconomyRuntime({
  config: economyConfig, manifest, graph, // bind to the *active* authored graph
  storage: economyStorage, // REQUIRED when enabled; game-scoped async {load,save}
});
await wallet.initialize(); // fail closed on corrupt/unavailable state; no silent localStorage fallback

const update = createNarrativeRuntimeUpdate({ graph, catalog,
  authorizeChoice: wallet.authorizeChoice, // mandatory for enabled monetized games
});
const renderer = createNarrativeRenderer({ graph, catalog,
  premiumChoices: wallet, // optional renderer read-only access + explicit unlock UI
});
```

`definePremiumManifest` binds the sidecar to a canonical snapshot of the full graph. With economy enabled, `createEconomyRuntime` requires the active graph and fails closed on an outdated sidecar. Its `authorizeChoice` function carries a compatibility check invoked by `createNarrativeRuntimeUpdate`, and the renderer checks the same binding. If any authored graph content changes, recreate the sidecar and re-run free-path evidence for that graph; otherwise old premium IDs could become unknown/free choices.

The storage port must implement `load()` returning an E1 `EconomyStateV1` or `null` for a first-time wallet and `save(state)` returning the literal `true` **only after a durable write**. A missing state is initialized at zero and saved before access is enabled. Absent, malformed, unacknowledged, or unavailable storage disables premium unlocks. This injected port is only a seam; E4 adds the scoped platform economy storage adapters and recovery.

An unlocked choice is a normal Narrative v1 `choose` action, so its authored `relation_delta`, `flag_set`, `memory_add`, routing, echo and other effects apply normally. **Buying the entitlement applies no story effects.** Back and Replay undo narrative effects with the narrative snapshot, but not the independently persisted entitlement; replay never buys again. Direct forged `narrative:choose` inputs are denied at `createNarrativeRuntimeUpdate`, even if a malicious UI enables a locked button.

The browser-only premium renderer shows prices, a separate confirmation step, pending/errors, an explicit **restore saved wallet** button after unavailable or ambiguous saves, and successful unlocked state. Restore calls `initialize()` to reload the current durable record; it does not automatically repeat a debit or dispatch a story choice. The player confirms any still-locked purchase again. This renderer does **not** buy crystals, play ads or call any platform SDK. E3 provides the rewards coordinator; E5 adds reward/claim UI, catalog purchases/cloud arrive in E4. Tests use an in-memory fake durability port that proves only component behavior, not actual remote persistence. No money-changing game behavior is enabled by merely importing these modules.

## Optional rewards (E3)

Rewards work in a non-narrative or reward-only game without any premium manifest **only if** `config.premium` is empty. If premium content is configured, the validated manifest and exact active narrative graph remain mandatory. Inject an ad port created by the existing Yandex or VK Connect adapter:

```js
const wallet = createEconomyRuntime({
  config: economyConfig, storage: economyStorage,
  episodeIds: ['episode_01'], // explicit game-authored allowlist; omitted => no episode grants
  ads: createYandexAds({ sdk, host, lifecycle }), // or createVkAds({ bridge, lifecycle })
  // In tests only: utcNow: () => fixedUtcDate, newAttemptId: () => 'ad_test_1'
});
await wallet.initialize();

await wallet.grantStarter();               // idempotent across all reloads
await wallet.grantEpisode('episode_01');   // idempotent by authored episode ID
await wallet.claimDaily();                 // one grant per UTC day
const status = wallet.getRewardsView();    // { amounts, pendingReward, daily: {utcDate,lastClaim,eligible} }

// Call only on a voluntary user gesture (e.g. an explicit ad-for-crystals button):
await wallet.claimRewarded();
```

Reward amounts come **only** from the game-owned frozen EconomyConfigV1. `grantEpisode()` rejects IDs absent from the explicit author-provided `episodeIds` allowlist; callers must also invoke it from an author-controlled completion event. Without an authoritative server it cannot prove that a player truly finished an allowed episode. These operations execute in the same serialized, save-before-publish queue as `unlockChoice()`. A duplicate deterministic grant returns a receipt with `applied:false` and does not save again. The injected UTC clock is an availability/rollback check, **not** cryptographically trustworthy time.

`claimRewarded()` preflights the unique lowercase-safe attempt ID and balance capacity, calls the injected `ads.showRewarded()` exactly once, and grants only on terminal `{shown:true,rewarded:true}`. A rejected SDK promise, cancellation, missing reward callback, timeout, or detached lifecycle yields **no grant**. Concurrent taps coalesce to one promise. The standard default attempt ID uses secure `crypto.randomUUID()`; if unavailable, it fails before showing an ad. Neither `showFullscreen()` nor interstitials are called from the wallet.

If a **verified** rewarded view cannot be durably committed, `getView().ready === false`, `getView().pendingReward === true`, and all new wallet mutations and premium authorization remain unavailable. Offer an explicit "Retry reward saving" action calling `await wallet.retryPendingReward()`: it reloads storage to detect an ambiguous acknowledged write, then retries the **same** reward ID without replaying the ad. After the runtime has already observed/attempted a wallet write, an unexpected later `storage.load() === null` fails closed rather than overwriting it with zero. However a **new** runtime cannot infer an older lost cloud record from `null` alone; the E4 storage port must distinguish absence from unavailable/missing data. A hard browser crash or a discarded runtime instance before that save is acknowledged can lose this in-memory recovery evidence. Do not promise crash-proof rewarded fulfillment without authoritative server-side evidence. SDK-side completion is accepted only to the extent that the Yandex/VK adapter verifies its callbacks or Bridge response; it is not cryptographic watch proof.

`getRewardsView()` exposes read-only configured amounts, UTC daily eligibility and pending status, including a fail-closed `ready:false` state. Reward buttons are **not** part of the E2 renderer; the game UI must provide an explicit voluntary opt-in. The E3 tests call actual Connect adapter implementations with simulated SDK/Bridge responses; they are **not real portal tests**.

Approach A remains client-trust-limited: without an owner-operated backend, the browser cannot prove wallet authenticity or ensure atomic cross-device writes. Do not claim real Yandex/VK payment compliance, purchase delivery, release readiness or real-platform testing on the basis of this package.
