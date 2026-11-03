# Economy & Monetization — technical design

Date: 2026-11-03  
Status: **PROPOSED — requires owner's design approval before implementation**  
Repository: `m-amirov/ludory`  
Selected approach: **A — no owner-operated backend**, approved by owner on 2026-11-03.

## 1. Intent and decisions

Introduce an opt-in, reusable economy for Ludory games and visual novels: virtual currency, additional premium narrative content, free/rewarded grants, daily bonuses, and consumable currency packs through Yandex Games. The main story, routes and endings must remain available without payments, ads or grinding. Gameplay must stay usable when monetization is disabled.

The first game, **«Поцелуй на краю света»**, remains **economy-disabled** unless the owner separately opts in. The existing story and old game repositories are not to be modified by this project. The framework may be used in future novels.

Owner-approved: no bespoke server, no mandatory second currency, no energy/ticket gating, no pay-to-win choice or premium-only good ending, avoid interruptions during emotional scenes, adapters for required Yandex/VK targets. Builder defaults (not yet approved as product economics): one currency named `crystals` in example, starter 20, episode reward 3, rewarded ad 5, premium scene 8–15; those are non-production demonstration values. Real SKU prices and exchange rates are game-owner configuration.

## 2. Approaches and rationale

1. **A — selected:** platform SDK (Yandex client-mode payments) + Yandex Player cloud persistence, existing Yandex/VK rewarded adapters; no custom backend. Advantages: no server, minimal operating cost. Drawback: client state is manipulable, and cross-device concurrent writes cannot be made strongly transactional.
2. **B — not selected:** signed purchases and authoritative remote backend ledger. Better tamper resistance, purchase correctness and concurrency, but requires hosting, security and operations.

Do not describe Approach A as fraud-proof or fully transactional across devices. Provide a future injection seam for a verified backend, without implementing one now.

## 3. Existing code and boundaries

- `@ludory/core` is platform neutral and stores JSON-compatible Core state; **do not add platform code to Core**.
- `@ludory/narrative` strictly validates graph and replays its `actionLog`; keep graph v1 and old stories valid.
- `@ludory/runtime-narrative` has session-only Back history over narrative state. Economy must be outside undo and must survive Replay.
- `@ludory/connect-yandex` already exposes `createYandexAds().showRewarded()` and Player SDK storage, but no payment adapter.
- `@ludory/connect-vk` already exposes `createVkAds().showRewarded()` and `createVkStorage` (VK Bridge cloud, conservative 3,800-byte-per-key limit). VK IAP is **not in scope** until a separately verified SDK contract exists; unavailable features are explicit, never simulated.
- `@ludory/studio` owns profiles/templates/component updates; integration is opt-in, never automatic rewrite of game specs or authored assets.

## 4. Proposed component topology

| Package | Responsibility |
| --- | --- |
| `@ludory/economy` (new) | Pure versioned configuration/state validation, wallet, idempotent transaction journal, entitlements, rewards, daily claims, errors. No DOM, SDK, wall clock, storage or network. |
| `@ludory/runtime-economy` (new) | Async operation coordinator for explicit user gestures, wallet UI view model, persistence-before-success, read-only balance/entitlement queries, premium-choice authorization. |
| `@ludory/runtime-narrative` | Optional premium gate composition or small injection seam; forged `narrative:choose` inputs cannot cross a locked gate in monetized mode. Existing non-monetized behavior unchanged. |
| `@ludory/connect-yandex` | Add `createYandexPurchases` and scoped economy cloud storage based on Player `getData/setData`; reuse `createYandexAds`. Payment catalog and currency labels/icons come from SDK. |
| `@ludory/connect-vk` | Connect existing rewarded ads through common capability; omit/disable paid products in VK until verified native payment adapter. |
| `@ludory/studio` | Optional economy profile/component/template and examples, not enabled for existing projects. |
| Release/QA | Rules and simulated tests for money-related failure/recovery; evidence is not real platform certification. |

The economy snapshot has an **independent persistence key and version**. Do not insert a writable currency balance into narrative `actionLog`, or derive it by replaying story actions. Do not assume the existing `RuntimeStorage` can write arbitrary records: it validates Core persisted envelopes, so the economy adapter needs its own storage contract. No broad change to Core snapshot or existing storage contract is needed.

## 5. Public contracts (v1 sketch)

`EconomyConfigV1`: `{schemaVersion:1, enabled:boolean, gameId, currency:{id, displayName, icon}, maxBalance, rewards:{starter, episode, daily, rewarded}, premium:Record<contentId,{cost, type}>, products:Record<sku,{currencyAmount}>}`. Strict validation, safe integer values, unique IDs, bounded values and explicit schema migrations. No prices for portal currency in this file.

`EconomyStateV1`: `{schemaVersion:1, gameId, configVersion, balance, entitlements, completedGrants, purchaseTokens, journal, lastDailyClaim, revision}`. IDs, positive deltas, spend reasons, causation IDs and journal retention must be validated. Never accept arbitrary amount from a UI event; amounts come from trusted game configuration or validated SDK product mapping. Returned state is copied and immutable to callers.

Pure operations (API shape may be refined in the implementation plan):

- `defineEconomy(config)`, `createEconomyState(config)`, `validateEconomyState(config, state)`;
- `applyEconomyOperation(config, state, operation)` → `{state, receipt}` with stable idempotency key; duplicate → same outcome, no repeat balance change;
- `getPremiumAccess(config, state, contentId)`, `getEconomyView(config, state)`.

Operation types: `GRANT_STARTER`, `GRANT_EPISODE`, `GRANT_DAILY`, `GRANT_REWARDED`, `GRANT_PURCHASE`, `UNLOCK_PREMIUM`. Every operation uses a deterministic logical ID: e.g., `starter:<gameId>`, `episode:<episodeId>`, `daily:<YYYY-MM-DD>`, `rewarded:<attemptId>`, `purchase:<tokenDigest>`, `premium:<contentId>`. The coordinator, not UI input, constructs and checks these. For daily reward use an injected UTC date and reject time going backwards relative to the last claim. This is an anti-accidental-replay rule, **not** tamper-proof timekeeping.

Safeguards: safe-integer overflow/underflow checks; reject unknown SKUs, malformed state and invalid entitlement; idempotent grants/charges; serialize operations within one session; bounded record size and explicit `STORAGE_CAPACITY_BLOCKED`, never silent pruning of purchase-token evidence; audit log redacts raw purchase tokens. A storage hash detects accidental corruption only, **not intentional tampering**.

## 6. Premium story integration

Premium metadata is a separate opt-in **sidecar manifest** mapping `(beatId, choiceId)` to `contentId` and cost. This keeps existing Narrative Graph v1 and author's `src/story.js` unchanged and avoids forcing payment metadata into every narrative node. Validate every manifest reference against the graph and verify that at least one free path through the story and all intended routes/endings remains viable. No premium choices may gate required story truth, routing or the only positive ending.

**Free-path validation contract:** statically remove premium edges and reject any scene with only premium outgoing choices; check remaining graph reachability to at least one ending, conservatively ignoring conditional predicate feasibility. For named routes/endings, the author provides an explicit manifest of intended free terminals plus one deterministic, testable action trace per intended route; validator replays each against the real narrative predicate/effect engine with premium actions disallowed. This documents what is proven rather than claiming full symbolic exploration of all relation/flag states. Future route changes invalidate stale traces.

Monetized runtime flow:

1. Renderer labels additional choices with price and read-only access state. It does not dispatch a payable choice as an untrusted ordinary action.
2. If not unlocked, user explicitly requests unlock. Controller checks config and current persisted economy balance, applies one `UNLOCK_PREMIUM` debit+entitlement in the **same economy record**, and awaits a successful durable save.
3. After durable save, the player can select the choice through the normal narrative action. If the narrative action fails, entitlement persists and may be retried; no second charge.
4. At every monetized `narrative:choose` entry point (including crafted input), deny premium content absent entitlement. The older direct public narrative engine remains purely narrative; the published monetized game must use the guarded composition.
5. Back/Replay rewinds story state only. It never refunds, recharges or removes purchased entitlements. Replay of the unlocked scene is free. No retroactive mutation of relationships or ending scores from a purchase itself.

## 7. Rewards and advertisements

Starter/episode grants use stable IDs and commit once. Daily claim displays eligibility based on UTC date but grants only after persistent write. All reward amounts live in the per-game config, with optional daily/rewarded caps. No timed energy, paywall or daily mandatory login.

Rewarded flow: explicit button → SDK `showRewarded()` → verify terminal `{shown:true,rewarded:true}` from the existing adapter → idempotent `GRANT_REWARDED` → persist → acknowledge. No credit for `shown:false`, missing `onRewarded`, ad cancel/error/timeout or stale lifecycle. Repeated SDK callbacks and retries with the same attempt ID never double credit. If save fails, keep the reward pending in memory for retry and show an honest pending/error state; no false success. A hard browser crash before durable save cannot be guaranteed recoverable without server-side proof. Do not show interstitial within choices/emotional scenes.

## 8. Yandex consumable purchases — no custom server

Use the **documented client-side SDK mode** (`signed:false`) and platform-hosted Player cloud, not payment signatures pretending to be verified. UI renders current `payments.getCatalog()` items, numeric price, and portal currency label/icon from SDK; only configured active SKUs are offered. No hardcoded representation of real-money/yan prices. Disable IAP if catalog/payment API, player identity or required cloud storage cannot be acquired. Never fall back to localStorage for monetary balances or purchased entitlements.

Purchase transaction/reconciliation flow:

1. On start and relevant foreground return, call `payments.getPurchases()` and reconcile unconsumed known SKUs; also handle a newly returned `payments.purchase({id})` token.
2. For a known unconsumed token, use a stable digest as the idempotency key; load the latest platform cloud state; serialize locally and check prior token evidence. SKU-to-currency-amount mappings are **immutable once published**. Changing amount requires a new SKU; historical inactive SKUs remain in the fulfillment registry so an old outstanding purchase can be delivered, but they are not offered in the current store.
3. If new, credit `GRANT_PURCHASE` and write the **balance and token evidence together** to Yandex Player cloud; require save success.
4. Only then call `payments.consumePurchase(token)`. If consumption fails, retain token evidence and retry on restart. If token evidence already exists, skip credit and retry consumption.
5. If cloud save is unavailable, **do not consume** and **do not claim purchase delivery**. Show recoverable pending state; retry at next safe opportunity. Unknown SKUs are not credited or consumed.

The game must not provide contradictory success messages when platform and cloud state diverge. Do not place purchases in unscoped local files. Serialize within the instance; best-effort same-origin tab exclusion (e.g. Web Locks where supported, otherwise clear unsupported notice/fail closed for IAP). **Do not claim that a second device is locked out**: simultaneous different-device sessions can overwrite Player data because SDK Player storage has no compare-and-swap / cross-device transactional guarantee. Document this limitation and block claims of strong exactly-once purchase guarantees. Security hardening requiring an authoritative ledger is explicitly beyond Approach A.

Current official Yandex requirements (checked 2026-11-03):

- `https://yandex.ru/dev/games/doc/ru/sdk/sdk-purchases` — grants before consume; recover unprocessed purchases; optional signed server variant;
- `https://yandex.ru/dev/games/doc/ru/requirements/1/13` — consumption, SDK-defined portal currency, numeric display price, matched catalog, cross-device cloud progress;
- `https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv` — rewarded `onRewarded` callback;
- `https://yandex.ru/dev/games/doc/ru/requirements/1/9` — cloud required when IAP is used.

For VK, rewarded is opt-in through existing connector. Use the existing VK Bridge cloud storage **only** when the complete economy envelope fits its conservative 3,800-byte-per-key limit and can be persisted/read back. Introduce a scoped versioned economy record contract, not `RuntimeStorage`'s Core-snapshot envelope. If it exceeds capacity or VK cloud fails, fail closed for spending/grants; do not silently fall back to device-local data or attempt multi-key non-atomic ledger shards. **Do not expose purchase buttons** or call unsupported VK payment APIs in v1. Platform-specific IAP integration requires a separate verified specification and authorization, not guessed parity with Yandex.

## 9. Save, recovery, lifecycle and migration

- Use separate game-scoped, versioned cloud economy key; entitlement and balance are an atomic logical record under one `setData` call, with explicit size guard respecting shared 200 KB Player quota. Existing narrative save/Back remains untouched.
- On startup load, validate and reconcile before enabling premium spend or Yandex purchases. Fail closed on cloud errors, corrupt records, schema mismatch or config migration gaps; do not reset a paid wallet to zero silently.
- Queue economy operations and SDK purchase processing within a session; cleanly destroy pending callbacks and avoid crediting a different attachment/session.
- Document and test failure windows: after SDK purchase-before-save, save-before-consume, consume failure, reload, transient network loss, duplicate callbacks, repeated purchases, and restoration after game-version upgrade.
- Future version upgrades must explicitly migrate state/config. A game must never silently replace user-owned configs or retroactively charge free scenes.
- Disabled-by-default means zero payment SDK calls, no advertisement changes, no economy state mutation, and byte-for-byte equivalent ordinary narrative behavior.

## 10. Developer and player experience

Studio provides an example config and demo choices, with all monetary product configuration **off** until the author enables it and registers actual Yandex SKUs. Expose: balance, unlock dialog with cost, optional rewarded button, daily claim, store listing populated from SDK, error/pending/retry notices, and a restore-purchases action. Accessible keyboard/touch/mobile portrait presentation. Never imply an ad view is compulsory or an absent purchase succeeded.

An illustrative demo economy may use 20 starting crystals, +3 per completed episode, +5 rewarded and optional premium scenes at 8–15 crystals. These numbers are **not production defaults** and can be changed without code edits. The source story's choices and endings remain authored separately.

## 11. Incremental implementation and acceptance

Proposed sequence, each a separate reviewable PR and testable deliverable:

1. **E1 pure economy contracts** — package, validation, deterministic grants/debits/entitlements/journal and idempotency tests.
2. **E2 runtime/narrative composition** — guarded choice sidecar, Back/Replay semantics, authoring validator, UI demonstration and forged-input tests.
3. **E3 rewards** — daily/episode/starter, integration with Yandex/VK rewarded adapters and error/timeout/retry tests.
4. **E4 Yandex purchases + cloud** — catalog, platform currency, purchase+unconsumed recovery, persistence-before-consume, failure window tests, explicit no-cloud/no-IAP policy.
5. **E5 Studio template + QA** — opt-in configuration, docs, policy-watch references, demo, moderation simulation and release readiness checklist. No changes to frozen games.

Build/tests: Node 22+ ESM, no Docker or OpenAI API; TDD for each behavior. Run targeted tests plus full `npm test`, `npm run check`, `node examples/core-session.mjs`, relevant template checks and browser/device smoke tests with mocks where applicable. Assertions must verify state transitions, no duplicates, no phantom credits, and no unguarded premium actions. No claims of real-platform payment/reward compliance from mocked evidence.

Real publication, catalog activation, production charging, real purchase/ad testing on platform and moderation submission are **not authorized** here. The feature stays behind a default-off flag. Release gate for any future monetized game requires actual Yandex SDK catalog, purchase/recovery, cloud cross-device, portal currency mock, rewarded lifecycle, and platform policy checks; unavailable evidence is `BLOCKED`, never `PASS`.

## 12. Open questions and builder discretion

Builder check resolved four details without changing owner-approved product behavior: VK uses bounded Bridge cloud with fail-closed quota; SKU fulfillment mappings are immutable and historical; only same-origin tab exclusion is best-effort, not cross-device; free routes are tested with explicit author traces in addition to static reachability. The implementer may choose exact internal error names, deterministic IDs and file names as long as public contracts and invariants above hold. Do not silently change the selected serverless tradeoff, add a second currency, or enable monetization in any game. Any request for stronger cross-device or antifraud guarantees requires a new owner decision and probably a server-backed phase.
