# F5 Disposable End-to-End Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce independently checkable F5 evidence from new, disposable Studio games with a real narrative browser journey, native AI handoff and two platform-specific dry-run ZIPs, while explicitly recording unsupported cross-template packaging and external gates.

**Architecture:** A Node fixture runner creates a narrative Studio game and two separate, single-target SDK template games under a fresh temporary root, then writes a hash-linked evidence receipt and candidate archives to a fresh output directory. A Playwright adapter runs the narrative game in wide/portrait contexts and supplies real screenshots and observations. There is no platform publication, paid AI request, or change to existing games.

**Tech Stack:** Node 22+, Node test, Studio scaffold/preview/CLI, fflate, Playwright Chromium, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-30-ludory-v1-completion-design.md` (F5), with P1/P2/P3 acceptance in `docs/superpowers/specs/2026-11-01-ludory-pre-f5-qa-lan-portrait-design.md`.

## Global Constraints

- Only throwaway Studio-created projects under process-owned temporary directories; no frozen games or CEOS mutation.
- `yandex-runtime` and `vk-runtime` provenance are single-target and cannot be disguised as packaged `narrative-interactive` game artifacts.
- No real Yandex/VK publication, actual moderation, authenticated Web agent, physical-device or live SDK claim.
- Receipt must capture actual local Git HEAD, run ID, fixture and ZIP SHA-256 hashes, screenshot SHA-256 hashes, honest blockers, and non-destructive assertions.
- Existing CI browser setup and native trust test environment must remain intact; no extra npm dependencies.

## Review Focus

1. Existing evidence output: reject overwrite before writing or creating a game (Task 1 test).
2. Forged successful AI or dual-target story packaging claim: status must remain blocked and live capabilities `NOT_RUN` (Task 1 test).
3. ZIP receipt content mismatch: compare archived entries to per-file hashes, without trusting only builder return values (Task 1 test).
4. Browser errors/external requests: record failed observations, do not mark narrative flow passed (Task 2 browser smoke).
5. Missing browser binary or unexpectedly interrupted run: retain failure receipt when output directory is admitted and fail CI (Task 2 browser smoke).

---

### Task 1: Disposable Studio fixtures, ZIPs and immutable evidence receipt

**Files:**
- Create: `scripts/f5-fixture-evidence.mjs`
- Create: `packages/studio/test/f5-fixture-evidence.test.mjs`

**Interfaces:**
- Export `runF5Fixture({ outputDir, observeNarrative, sourceHead } = {})` returning an evidence object. `observeNarrative({ projectDir, outputDir })` receives only the disposable narrative project and returns browser observations; it cannot certify external gates.
- Output `f5-evidence.json`, `yandex-candidate.zip`, `vk-candidate.zip` and browser screenshots, all named deterministically within one exclusive new output directory.

- [ ] **Step 1:** Write failing unit tests: reject pre-existing output and preserved sentinel; record different Studio provenance and explicit `STORY_TARGET_PACKAGING_BLOCKED`; assert actual hash of ZIP bytes and every ZIP entry; exact 40-hex source HEAD; AI handoff `NEEDS_AGENT_ACTION` with zero DEV host calls; never mutate a sibling owner sentinel.
- [ ] **Step 2:** Run `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/f5-fixture-evidence.test.mjs` and confirm failure before implementation.
- [ ] **Step 3:** Implement `runF5Fixture` with exclusive output admission, process-owned temp fixture, Studio plan/apply, offline native AI route/image packet, target-specific builders, archive verification and `finally` cleanup; write receipt only after all observations or a failure reason.
- [ ] **Step 4:** Re-run targeted tests, `npm test`, `npm run check`, `node examples/core-session.mjs`.
- [ ] **Step 5:** Commit Task 1.

### Task 2: Real narrative browser flow and CI evidence upload

**Files:**
- Create: `packages/runtime-narrative/test/browser/f5-smoke.mjs`
- Modify: `.github/workflows/runtime-browser.yml`
- Modify: `packages/runtime-narrative/test/browser/package.json`

**Interfaces:**
- Playwright adapter passed to `runF5Fixture`; records screenshot basename/hash, viewport, narrative steps and browser errors. It uses Studio `planPreviewBuild`, `buildPreview`, `startPreviewServer`.
- CI executes this script after N3 smoke, uploading F5 evidence even on failure.

- [ ] **Step 1:** Write a browser smoke first: wide desktop and emulated portrait, story start → Back → photo and keepsake → compose/send echo → Save/reload; a separate corrupt/upgrade save conflict check; offline navigation observation classified truthfully, with screenshot hashes.
- [ ] **Step 2:** Run locally where browser available, otherwise verify syntax and execute on browser-enabled CI (record local NOT_RUN reason).
- [ ] **Step 3:** Wire `smoke:f5` and GitHub Action upload-artifact with failure-safe artifact collection; no release flag becomes true.
- [ ] **Step 4:** Check targeted Node tests and full checks, commit Task 2.

### Task 3: F5 gap audit and PR

**Files:**
- Create: `docs/qa/f5-e2e-status.md`

**Interfaces:**
- Document what the exact run attests and the unresolved packaging / external host / offline/device gates; do not declare F5 fully accepted.

- [ ] **Step 1:** Compare receipts to F5 spec and list outstanding observations, including Phaser if unexercised.
- [ ] **Step 2:** Run full checks and independent whole-branch review; address important findings.
- [ ] **Step 3:** Open a draft PR with exact tested HEAD and CI evidence, but do not merge without owner direction.
