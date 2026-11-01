# Connect VK V3 Ads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VK interstitial and rewarded ads with SDK-confirmed results, scoped lifecycle pause, and fail-closed rewards.

**Architecture:** Extend the existing VK lifecycle with a generation-scoped ad pause lease and detach subscription. Build a separate Promise-oriented VK ads adapter with one active show request and optional availability probe. Preserve Yandex and Core boundaries.

**Tech Stack:** Node.js >=22, ESM, `node:test`, injected VK Bridge and Runtime host doubles.

**Spec:** `docs/superpowers/specs/2026-10-31-connect-vk-v3-ads-design.md`

## Global Constraints

- `@ludory/core` stays platform-neutral; no game, CEOS, Starter Kit, Yandex or third-party SDK edits.
- No SDK fabrication, real-device PASS, Release PASS, publication, or automatic merge.
- Use `.worktrees/connect-vk-v3-ads` and TDD with observed red and green tests.

## Review Focus

- Synchronous Runtime `pause()` callback detaches lifecycle: reject, do not call Bridge, do not revive stale pause.
- VK Bridge never settles a show: bounded timeout releases pause and prevents late reward.
- Synchronous `bridge.send` callback destroys adapter: reject once and observe any returned Promise rejection.
- Manual pause and overlapping VK hide reason: ad completion never resumes until all reasons clear.
- Availability result malformed or returned after detach/destroy: no misleading availability proof.
- Old ad response following detach and reattach: never reward or release new-generation pause.

---

### Task 1: Lifecycle-scoped ad pause

**Files:** Modify `packages/connect-vk/src/lifecycle.mjs`; test `packages/connect-vk/test/lifecycle.test.mjs`.

**Interfaces:** Produce `getAttachmentToken(): number | null`, `acquireAdPause(): () => void`, `subscribeDetach(fn: () => void): () => void` for Task 2.

- [ ] Add tests: attached lease pauses/resumes exactly once; preserves manual and VK hide; detach notifications and token invalidation; reentrant detach during `host.pause` rejects a lease.
- [ ] Run `node --test packages/connect-vk/test/lifecycle.test.mjs`; expect failures for missing lease/token/subscription.
- [ ] Implement generation-scoped unique pause reasons; fail if host cannot pause. Notify detach subscribers after detaching, catching subscriber errors.
- [ ] Rerun the focused test; expect 0 FAIL.
- [ ] Commit `feat(connect-vk): add scoped lifecycle ad pause leases`.

### Task 2: VK ads adapter and exports

**Files:** Create `packages/connect-vk/src/ads.mjs` and `packages/connect-vk/test/ads.test.mjs`; modify `packages/connect-vk/src/errors.mjs`, `packages/connect-vk/src/index.mjs`.

**Interfaces:** Produce `createVkAds({ bridge, lifecycle, timeoutMs?: number })` with `showFullscreen(): Promise<{shown:true}>`, `showRewarded(): Promise<{shown:true,rewarded:true}>`, `checkAvailability(kind: 'fullscreen'|'rewarded'): Promise<{available:boolean}>`, `destroy(): void`.

- [ ] Write tests for the exact SDK methods/parameters, true/false/malformed responses, missing/throwing SDK, single-flight, independent availability, detach/reattach, destroy, and reentrant pause/send cancellation.
- [ ] Run `node --test packages/connect-vk/test/ads.test.mjs`; expect missing-export failure.
- [ ] Implement minimal Promise-bound adapter; guard active request and attachment token before sending and resolving; ignore late results; release leases exactly once.
- [ ] Rerun focused ads and lifecycle tests; expect 0 FAIL.
- [ ] Commit `feat(connect-vk): add fail-closed fullscreen and rewarded ads`.

### Task 3: Public contract, syntax and whole-repo verification

**Files:** Modify `package.json` check script; if necessary `packages/connect-vk/README.md` or add `docs/superpowers/specs/2026-10-31-connect-vk-v3-ads-design.md` integration notes.

**Interfaces:** Runtime and consumers can import `createVkAds` directly; `npm run check` covers `ads.mjs` syntax.

- [ ] Add `ads.mjs` to the check list and use a public-export test to catch a missing export.
- [ ] Verify `npm run check` and focused VK suite, then complete `npm test` (unrestricted if the sandbox blocks known Git fixture behavior); expect 0 failures.
- [ ] Inspect `git diff --check`, protected paths, package/SDK changes and test outputs; commit `test(connect-vk): gate V3 ads public contract` if changes remain.
- [ ] Prepare a PR for review and CI; do not merge or assert live platform verification.
