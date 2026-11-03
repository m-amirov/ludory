# F6a Yandex ad deadline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound all Yandex ad requests so missing SDK callbacks cannot leave the Runtime paused forever.

**Architecture:** Add an attempt-scoped, cleanup-safe timeout to `createYandexAds` without changing SDK display proof or scoped pause ownership. Follow the existing VK adapter's timeout contract and Yandex adapter's reentry protections.

**Tech Stack:** Node.js 22+, ESM, `node:test`, Runtime/Yandex injected host and SDK fixtures.

**Spec:** [F6a design](../specs/2026-11-03-f6a-yandex-ad-deadline-design.md)

## Global Constraints

- No SDK invocation, imported legacy state or platform publication outside the test double.
- Keep error codes (`ADS_FAILED`, `ADS_NOT_SHOWN`) and reward rules unchanged.
- Default `timeoutMs=120_000` and integer bounds 1…300000, consistent with VK.
- Only Yandex Connect tests/source and phase documentation may change.

## Review Focus

1. SDK never calls any callback: no pending request after timeout.
2. SDK calls `onOpen` without close: owned pause released, no reward.
3. Timeout while manual/platform pause active: independent pause preserved.
4. Stale callbacks or rejected thenables after timeout: no effect on next attempt.
5. Destroy or synchronous close before deadline: timer cleared; cannot trigger a late outcome.

---

### Task 1: Reproduce and fix Yandex missing-callback behavior

**Files:**
- Modify: `packages/connect-yandex/test/ads.test.mjs`
- Modify: `packages/connect-yandex/src/ads.mjs`

**Interfaces:**
- Consumes: `createYandexAds({ sdk, host, lifecycle })` and the existing scoped pause lease.
- Produces: optional `timeoutMs` constructor argument with the bounded validation and terminal handling from the spec.

- [x] **Step 1: Write failing regression tests.** Cover both silent SDK (before open/after open), rewarded no-close, stale callbacks, independent pause, reentry, success/destroy timer cleanup, and invalid timeout values. Add watchdogs so old code fails instead of hanging the suite.
- [x] **Step 2: Run** `node --test packages/connect-yandex/test/ads.test.mjs`; require an observed assertion failure on the old implementation.
- [x] **Step 3: Implement the minimal deadline.** Validate the constructor option; install timer before invoking the SDK; clear the timer at the top of the existing settlement path; reject timeout with `ADS_FAILED` through that path.
- [x] **Step 4: Run** `node --test packages/connect-yandex/test/ads.test.mjs`; require 0 failures. Verify the original silent SDK case now settles and releases the pause.
- [x] **Step 5: Run** `npm test`, `npm run check` and `git diff --check`; inspect the exact diff and ensure no unrelated edits.
- [x] **Step 6: Commit** only the agreed files and prepare the implementation for independent review before PR.

### Observed evidence (2026-11-03)

- RED before source fix: `node --test packages/connect-yandex/test/ads.test.mjs`
  produced four expected failures (no config validation, three missing-deadline cases).
- GREEN after source fix: 24/24 ad tests.
- `npm test`: 1,028 passed, 16 skipped, zero failed; 18/18 Quality tests.
- `npm run check`, `npm run check:yandex-template`,
  `npm run check:narrative-template`, and `git diff --check`: exit 0.
- The Yandex browser template bundle was rebuilt with the pinned generator;
  no Yandex SDK binary is vendored or contacted by this fix.
