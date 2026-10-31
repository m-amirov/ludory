# Connect Yandex C4 Ads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, fail-closed fullscreen and rewarded ad operations to new Ludory games without breaking Runtime manual/platform pause ownership or granting unobserved rewards.

**Architecture:** Keep all ad SDK calls in `@ludory/connect-yandex`. The existing C2 lifecycle acquires and releases a scoped ad pause reason only after `onOpen`; the new C4 adapter owns an individual attempt, its callbacks, result and teardown. Never change Core, Runtime, frozen games, CEOS or Starter Kit.

**Tech Stack:** Node.js >=22, ESM, `node:test`, existing `@ludory/connect-yandex` and real C2 lifecycle with injected fake Yandex SDK.

**Spec:** `docs/superpowers/specs/2026-10-29-connect-yandex-design.md` §7; `docs/superpowers/specs/2026-10-30-ludory-v1-completion-design.md` F2. Official SDK: https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv (checked 2026-10-31).

## Global Constraints

- `ysdk.adv.showFullscreenAdv({ callbacks })` and `showRewardedVideo({ callbacks })` are **callback-based, synchronous-void** SDK calls; `onClose(wasShown: boolean)` confirms show/no-show, `onRewarded()` confirms eligibility for a reward. A returned SDK Promise, if present, is not proof of display.
- No automatic ad trigger, reward grant, app-level cooldown, account prompt or implicit consent handling; platform ad policy/availability remains external.
- Stable Connect error codes: `ADS_FAILED` for actual error/invalid lifecycle/concurrency, `ADS_NOT_SHOWN` for a completed attempt with `wasShown: false`, `CAPABILITY_UNAVAILABLE` when an API is missing.
- No player-visible success or rewards from mocked SDK, absent `onRewarded`, duplicate/late callbacks, or a fake `onClose(true)` without a finished SDK attempt. Fake-SDK tests establish only `SDK_CONTRACT_PASS`, not live ad inventory or Release PASS.
- Each change in isolated `.worktrees/connect-yandex-c4` based on merged `main`; separate PR/review/CI and owner approval before merge.

## Review Focus

1. **Manual pause during an open ad:** onClose must not resume the player's intentionally paused game — Task 1 lease + Task 2 integration test.
2. **Overlapping platform/visibility pause:** releasing ad reason cannot resume while other platform reasons remain — Task 1 multi-reason test.
3. **Duplicate/late callbacks:** one attempt must settle exactly once, with no reward or resume after teardown — Task 2 callback-race test.
4. **Contradictory SDK evidence:** `onRewarded` before open or `onClose(false)` must not grant reward — Task 2 anti-fraud test.
5. **SDK call returns without callback / fails synchronously:** don't fabricate success; throw/rejection must remain visible — Task 2 SDK failure test.

---

### Task 1: Scoped ad pause lease in C2 lifecycle

**Files:** Modify `packages/connect-yandex/src/lifecycle.mjs`; test `packages/connect-yandex/test/lifecycle.test.mjs`.

**Interfaces:** Add `lifecycle.acquireAdPause(): () => void`. Only valid while attached; internally uses a unique pause-reason token, calls existing `onPause(token)`, and returns one idempotent release closing that token with existing `onResume(token)`. Never clear/change the manual pause flag or other pause reasons; if detached, fail closed as `LIFECYCLE_FAILED`.

- [ ] **Step 1 — RED:** Add focused lifecycle tests: acquiring while RUNNING pauses once; duplicate release is harmless; manual paused during lease does not auto-resume; SDK `game_api_pause` / hidden document retains pause after ad release; detached acquisition fails; release after detach doesn't resume.
- [ ] **Step 2 — Check RED:** `node packages/connect-yandex/test/lifecycle.test.mjs` must fail only on missing scoped method/behavior.
- [ ] **Step 3 — GREEN:** Implement `acquireAdPause` using current pause-reason ownership and status transitions, no new global state.
- [ ] **Step 4 — Verify:** Targeted C2 tests pass; no change to `setManualPaused` semantics.
- [ ] **Step 5 — Commit:** `feat(connect-yandex): expose scoped ad pause lease`.

### Task 2: Explicit fullscreen/rewarded adapter

**Files:** Create `packages/connect-yandex/src/ads.mjs`, `packages/connect-yandex/test/ads.test.mjs`; modify `packages/connect-yandex/src/errors.mjs`.

**Interfaces:** `createYandexAds({ sdk, host, lifecycle })` returns frozen `{ showFullscreen(): Promise<{shown:true}>, showRewarded(): Promise<{shown:true,rewarded:boolean}>, destroy(): void }`. Validate injected SDK/host/lifecycle. One active attempt per adapter; never call SDK if missing API or destroyed. `showFullscreenAdv({ callbacks })` and `showRewardedVideo({ callbacks })` are invoked only by explicit method call. A terminal `onError` rejects `ADS_FAILED`; `onClose(false)` rejects `ADS_NOT_SHOWN`; `onClose(true)` resolves, and reward is true only if the same attempt observed `onOpen` then `onRewarded`. Acquire lease only on `onOpen`, release on any terminal event. Once settled/destroyed, ignore all later callbacks; concurrent method call fails visibly, without stealing the existing attempt's lease.

- [ ] **Step 1 — RED:** Unit tests with fake SDK callbacks and real C2 lifecycle/host: fullscreen shown/not shown/error; reward earned/not earned; invalid reward sequence; duplicate callbacks; early terminal callback and later SDK events; missing API, thrown SDK method, optional rejected thenable; concurrent invocation; destroy while pending; platform/manual pause ownership.
- [ ] **Step 2 — Check RED:** `node packages/connect-yandex/test/ads.test.mjs` fails for missing export/adapter.
- [ ] **Step 3 — GREEN:** Implement per-attempt state (`opened`, `rewardObserved`, `settled`, pause release), one Promise resolver/rejector, cancellation generation on destroy. Guard all callbacks and SDK errors; never resolve solely because SDK method returned.
- [ ] **Step 4 — Verify:** All C4 tests pass, and existing C1–C3 tests remain green.
- [ ] **Step 5 — Commit:** `feat(connect-yandex): add explicit fullscreen and rewarded ads`.

### Task 3: Public contract and full gates

**Files:** Modify `packages/connect-yandex/src/index.mjs`, `packages/connect-yandex/test/public-api.test.mjs`, `packages/connect-yandex/README.md`, root `package.json` `check` script; no changes outside Connect/docs/tooling.

**Interfaces:** Export only `createYandexAds` and new error codes. Document opt-in usage, `onClose(wasShown)`/`onRewarded` semantics, owner-managed consent/cooldown, and live Yandex requirements.

- [ ] **Step 1 — RED:** Update public package API test to require `createYandexAds` on SSR import with zero SDK calls.
- [ ] **Step 2 — Check RED:** `node packages/connect-yandex/test/public-api.test.mjs` fails for new export.
- [ ] **Step 3 — GREEN:** Add export, docs, `node --check packages/connect-yandex/src/ads.mjs` to root check.
- [ ] **Step 4 — Verify:** `node --test packages/connect-yandex/test/*.test.mjs`, `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`; inspect status and unrelated files.
- [ ] **Step 5 — Commit and review:** Commit, request independent read-only review, fix Important defects with RED/GREEN, re-run gates, publish Draft C4 PR on separate GitHub branch and wait exact-HEAD CI. Never merge without fresh owner approval.

## Deferred / blocked

- A real Yandex Console draft and actual ad inventory, browser/device-specific ad playback and consent validation remain owner-authorized C5/live gates.
- The SDK may leave callbacks pending indefinitely; C4 will not fabricate `ADS_NOT_SHOWN` from elapsed time or add unsafe speculative retry. A bounded timeout/cancellation policy requires separate design because late SDK callbacks can still open an ad.

## Self-review

- Spec coverage: explicit ads, pause on `onOpen`, cleanup, reward provenance, no-show, errors, double trigger, late callbacks, manual pause, no hidden fallback all assigned to tasks.
- Interface consistency: Task 1 `acquireAdPause`, Task 2 `createYandexAds`, Task 3 public export; error codes are shared with existing Connect errors.
- All five Review Focus risks have tests in Task 1 or 2. No Core/Runtime changes or live ad claims.
