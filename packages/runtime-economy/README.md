# @ludory/runtime-economy (E2)

Optional, browser-portable premium Narrative v1 composition. **Disabled by default in all Ludory games.** This is an SDK-free infrastructure layer, **not** a verified payment gateway or a cloud persistence adapter.

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

The storage port must implement `load()` returning an E1 `EconomyStateV1` or `null` for a first-time wallet and `save(state)` returning the literal `true` **only after a durable write**. A missing state is initialized at zero and saved before access is enabled. Absent, malformed, unacknowledged, or unavailable storage disables premium unlocks. This injected port is only a seam; E3/E4 provide actual platform adapters and recovery.

An unlocked choice is a normal Narrative v1 `choose` action, so its authored `relation_delta`, `flag_set`, `memory_add`, routing, echo and other effects apply normally. **Buying the entitlement applies no story effects.** Back and Replay undo narrative effects with the narrative snapshot, but not the independently persisted entitlement; replay never buys again. Direct forged `narrative:choose` inputs are denied at `createNarrativeRuntimeUpdate`, even if a malicious UI enables a locked button.

The browser-only renderer shows prices, a separate confirmation step, pending/errors, an explicit **restore saved wallet** button after unavailable or ambiguous saves, and successful unlocked state. Restore calls `initialize()` to reload the current durable record; it does not automatically repeat a debit or dispatch a story choice. The player confirms any still-locked purchase again. The UI does **not** buy crystals, play ads or call any platform SDK. In E2 the caller provides the saved balance as test/demo data; starter/daily/episode/rewarded handlers come in E3, catalog purchases/cloud in E4. Tests use an in-memory fake durability port that proves only component behavior, not actual remote persistence. No money-changing game behavior is enabled by merely importing these modules.

Approach A remains client-trust-limited: without an owner-operated backend, the browser cannot prove wallet authenticity or ensure atomic cross-device writes. Do not claim real Yandex/VK payment compliance, purchase delivery, release readiness or real-platform testing on the basis of this package.
