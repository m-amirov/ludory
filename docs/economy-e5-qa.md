# Opt-in economy QA and release gates (E5)

Status: local E1–E5 engineering evidence only. **Not real-platform approval.** Owner-approved serverless Approach A; no release or moderation submission is authorized.

## Studio integration

- Select `narrative-game` + `narrative-economy` **only for a new game**. Existing `narrative-basic`, `narrative-interactive`, VK and Yandex templates remain separate.
- The generated `config/economy.json` is off (`enabled:false`) and holds **illustrative** balances only. `config/` is user-owned and excluded from Studio managed updates. The game ID comes from `ludory.project.json` at runtime.
- `src/story.js` is author-owned, including the explicit free good-ending witness. `config/premium.json` binds optional authored choice IDs to currency costs. If graph/manifest changes, rerun validation.
- Enable only with actual SDK-backed **economy and narrative** cloud storage and target-aware platform adapters. Local browser narrative saving is for the disabled demo alone. No implicit wallet/ad/purchase calls or local monetary fallback.
- `createEconomyPanel` offers voluntary daily/rewarded buttons, pending reward-save retry, explicit catalog refresh, SDK-sourced portal currency price/icon and purchase restoration on Yandex only. It never automatically charges or plays ads. The host calls `restorePurchases()` at enabled startup if IAP is wired, then renders; the host must also reconcile after foreground return.

## Running simulated moderation

```js
import { assessEconomyReadiness } from '@ludory/release';

const economyQa = assessEconomyReadiness({
  target: 'yandex-games', enabled: true,
  activeSkus: ['actual_registered_sku'],
  simulation: { wallet: true, premium: true, rewards: true, purchases: true },
});
// economyQa.status === 'BLOCKED'; releaseReady and publicationAllowed are false.
```

Local simulation flags are developer assertions **only**. They cannot pass real platform gates. Attach this advisory report alongside (not instead of) the existing `simulateModeration(...)` result. For disabled games, this utility returns `NOT_APPLICABLE` and does not change normal release evaluation. For VK, an active purchase SKU is a concrete `VK_IAP_UNSUPPORTED` failure; VK rewarded remains optional.

The Linux browser workflow runs `npm run smoke:economy-e5` in
`packages/runtime-narrative/test/browser` after building the committed template.
It creates a fresh Studio game, verifies default-off free good-ending gameplay,
save/restore, corrupt-save recovery without overwrite and responsive viewports, then exercises voluntary wallet UI with
a fake adapter. This is **browser-local mock evidence**, not SDK, cloud, ad,
IAP, device-matrix or real moderation evidence. If the Chromium job did not
actually run and pass, the browser gate is **NOT_RUN**, not `PASS`.

## Release gates that must remain BLOCKED without actual portal evidence

| Gate | Evidence required before any real monetized release |
| --- | --- |
| Yandex SDK catalog | Registered active products, real account SDK catalog results and amount mapping |
| SDK portal currency | Real SDK-sourced numeric price, correct portal currency name and icon, no hardcoded pricing |
| Purchase fulfillment | Actual consumable purchase, durable cloud credit before `consumePurchase`, recovery after reload, no double credit |
| Cloud progress | Authorized-player persistence, restore after reload, cross-device and concurrent session observation; limitations documented |
| Rewarded ads | Real `onRewarded` terminal callback, cancel/error/timeout behavior, retry after uncertain save |
| Content/rights/policy | Intended good endings free without ads or purchases; valid claims/rights; verified platform policy and real moderation |

These gates require owner authorization to execute real paid tests and submit to moderation. Do not infer their success from mocked SDK callbacks. Approach A has no authoritative backend: exact cross-device wallet transactionality and antifraud guarantees **cannot** be certified. The product must not claim them.

Official sources checked 2026-11-04: [Yandex purchases](https://yandex.ru/dev/games/doc/ru/sdk/sdk-purchases), [requirement 1.13](https://yandex.ru/dev/games/doc/ru/requirements/1/13), [requirement 1.9](https://yandex.ru/dev/games/doc/ru/requirements/1/9). Ludory's existing `policy:watch` monitors official platform changes; reviewing the report remains necessary for a money-enabled release.
