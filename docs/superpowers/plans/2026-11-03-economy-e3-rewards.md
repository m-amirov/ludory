# E3 — deterministic rewards and rewarded ads implementation plan

**Goal:** Add optional, durable starter/episode/daily grants and explicit rewarded-ad grants to the existing Economy Runtime, without a server, store, or changes to game repositories.

**Architecture:** The `@ludory/economy` E1 reducer remains the only authority for amounts and logical idempotency. The E2 coordinator serializes all wallet operations and writes each candidate state before publishing it. Adapters are injected via the already existing `{showRewarded()}` interface; no invented platform API or UI-triggered currency quantity is trusted. In-memory pending rewarded attempts survive ambiguous save acknowledgments within the same runtime instance but do not claim durability across tab crashes.

**Constraints:** Node 22+ ESM, no Docker/custom backend, opt-in config only, narrative graph sidecar strict for premium games, no real SDK/purchases/release. Default-off `Поцелуй на краю света` untouched. The provided daily clock is not an anti-tamper mechanism.

## Task 1 — safe generic reward operation plumbing

1. Add failing `node:test` cases for starter and episode grants, replay and concurrent calls, daily UTC deduplication and clock rollback, disabled/uninitialized behavior, missing storage, and reward-only wallets with no premium manifest.
2. Implement `grantStarter()`, `grantEpisode(episodeId)`, `claimDaily()` as serialized calls to E1 `applyEconomyOperation`; defer observable balance changes until `storage.save()` returns literal `true`. Continue E2 strict premium graph checks if premium is configured.
3. Run focused tests RED then GREEN and commit.

## Task 2 — rewarded ad receipt and recovery

1. Add failing cases for true completed Yandex/VK-style rewarded result, cancel/false/throw/timeout, duplicate clicks, dispose during pending SDK, save rejection and ambiguous ack/retry, no replay of the ad, no credit without success, and independent attempt IDs.
2. Add `claimRewarded()` using injected ads and attempt-ID factory; require exact terminal `{shown:true,rewarded:true}`; persist a verified pending attempt ID only in memory until durable storage acknowledgment. Add `retryPendingReward()` and expose pending state. Serialize operations to guard double taps; reload before retry to dedupe persisted ambiguous commit. Ensure subsequent calls cannot show ads while one pending reward needs reconciliation.
3. Run targeted RED→GREEN, then commit.

## Task 3 — E3 acceptance and documentation

1. Update package README, usage examples and limits; add focused adapter integration regression tests where practical. Include explicit evidence limitations about actual portal ads and cross-tab/crash guarantees.
2. Run `node --test packages/runtime-economy/test/*.test.mjs`, `npm test`, `npm run check`, `node examples/core-session.mjs`, and check any relevant browser/package gates. Inspect branch diff for unrelated changes.
3. Request independent whole-branch review; resolve actionable Critical/Important items with regression tests; rerun gates. Publish a separate E3 PR to remote `main` and merge only after successful required checks.

**Acceptance:** No unacknowledged credit; no double-grant for deterministic IDs, same ad attempt or retry; no ad grant on failure; no SDK call when reward is pending; every grant amount comes from frozen config; premium narrative guards unaffected; disabled economy behavior unchanged; opt-in reward-only wallet works; test results and limitations recorded.
