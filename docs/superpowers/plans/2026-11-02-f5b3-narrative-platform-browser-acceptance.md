# F5b3 Narrative Platform Browser Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the two *actual F5b2 ZIP candidates* from one trusted narrative game run the same authored story through Yandex/VK Connect adapters in real browsers with local fake SDKs, without claiming live platform approval.

**Architecture:** Build both ZIPs once from a fresh F5b1 plan, verify the source-linked receipts, and serve their exact inspected archive members from a localhost test server. Inject Yandex `/sdk.js` or a VK Bridge test double only at the HTTP boundary, never into an archive. Playwright exercises story, cloud save, lifecycle, media and layouts; source/hash-bound mock-only evidence is uploaded by CI.

**Tech Stack:** Node.js 22+ ESM, existing Studio F5b1/F5b2 APIs, `@ludory/release` archive inspection, `fflate` 0.8.2, Playwright 1.56.1, existing Runtime browser CI.

**Spec:** `docs/superpowers/specs/2026-11-02-f5b-narrative-platform-export-design.md` (owner-approved approach A, 2026-11-02).

## Global Constraints

- F5b3 is a browser gate *after* F5b1 trusted source pin and F5b2 separately verified Yandex/VK ZIPs. Its status is `MOCK_SDK_BROWSER_PASS` only; `releaseReady: false`, `publicationAllowed: false` always.
- Use one new Studio `narrative-interactive` source with id/version and author-edited `src/story.js`, never a frozen or externally authored game. Preserve source files exactly across build/test.
- Execute archive entrypoint bytes from each real ZIP; only `/sdk.js` (Yandex) or `assets/vk-bridge.js` (VK) may be replaced in the *local HTTP fixture*. The replacement is disclosed in evidence and does not alter the archive.
- Verify full pair source/derived/archive receipts via `verifyNarrativePlatformCandidates(paths, sourcePlan)` before serving. Serve no external network resources, but **do not impose offline-startup requirements** on released games.
- Same story path must cover photo, keepsake, composed message/echo, Back, save/reload and portrait/wide layout. Prove SDK init, visibility/pause, gameplay/audio where the narrative actually supports it.
- SDK refusal, foreign imports, changed source, symlinked output, swapped targets, tampered receipts or ZIPs and destination collisions must return `BLOCKED` or fail the browser gate—not a synthetic PASS.
- No CEOS/Starter Kit mutation, new server backend, API image generation, live SDK login, publication, moderation or rights assertion. Browser emulation is not a physical-device acceptance.
- Browser engines missing locally are a documented `NOT_RUN`, never a PASS. CI installs Chromium/Firefox/WebKit and is the required full browser evidence source.

## File Structure

- Create `packages/runtime-narrative/test/browser/f5b3-fixture.mjs`: owned temp source, F5b2 candidate/receipt generation, ZIP validation, in-memory HTTP server, test-only SDK shims and cleanup.
- Create `packages/runtime-narrative/test/browser/f5b3-fixture.test.mjs`: source/ZIP binding and negative server/admission tests that run without a browser.
- Create `packages/runtime-narrative/test/browser/f5b3-platform-smoke.mjs`: Playwright game-path, save/lifecycle/responsive/error scenarios, bounded failure and evidence aggregation.
- Modify `packages/runtime-narrative/test/browser/package.json`: add `smoke:f5b3`.
- Modify `.github/workflows/runtime-browser.yml`: run the F5b3 smoke and upload its mock-only evidence on success/failure.
- Modify `packages/studio/test/narrative-platform-export.test.mjs`: assert the CI F5b3 smoke/evidence contract is wired, without weakening archive security tests.

## Review Focus

1. A valid SDK init that fails its *ready* stage must not mark the narrative as running/accepted (Task 3).
2. Browser save failures, invalid cloud state or reload must not silently fall back to local storage or overwrite the invalid platform record (Task 2/3).
3. A ZIP that differs from the paired receipt, or an HTTP fixture serving bytes different from that inspected ZIP, must never be reported as F5b3 PASS (Task 1/3).
4. UI actions dispatched during platform pause must not advance the story; a later resume cannot duplicate input (Task 3).
5. A 320px portrait device, Pixel 7 portrait and desktop wide layout must keep choices tappable and avoid horizontal overflow; network requests must remain localhost-only (Task 2).

---

### Task 1: Source-bound dual-ZIP browser fixture

**Files:** Create `f5b3-fixture.mjs` and `f5b3-fixture.test.mjs` beside the existing `studio-n3-smoke.mjs`.

**Interfaces:**
- `createF5b3Fixture() -> Promise<{ sourcePlan, sourceDigest, outputs, candidates, serve(target), cleanup() }>`: a fresh in-process Studio narrative game with a unique literal `F5B3_AUTHORED_STORY_317`, two exclusive ZIPs and three receipts. `candidates.yandex/vk` each has `archiveSha256` and validated `entries` from `fflate.unzipSync`.
- `serve(target, { sdkMode = 'normal' } = {}) -> Promise<{ url, requests, close() }>`: localhost-only HTTP server for **archive-member bytes**; a Yandex fake script at `/sdk.js`, or VK fake Bridge on the matching module request. No filesystem extraction or generic dynamic path resolution.
- Test doubles record SDK init, LoadingAPI.ready, gameplay/lifecycle events, cloud storage calls and failures in a test-only page global; their cloud store survives reload in the fixture origin.

- [ ] **Step 1 — RED:** Add test `F5b3 builds one author story into two inspected ZIPs and serves archive bytes unchanged`: assert source digest equals pair receipt digest, `verifyNarrativePlatformCandidates(...).status === 'LOCAL_ARCHIVES_VERIFIED'`, each ZIP contains the literal marker, both targets have exact manifests, source hash inventory is unchanged, and served `src/main.js` matches the inspected ZIP member. Add negative tests for stale/modified source, overwritten destinations, tampered ZIP/receipt, symlinked output parent, swapped target and foreign SDK import; each must fail before HTTP launch.
- [ ] **Step 2 — Observe failure:** Run `node --test packages/runtime-narrative/test/browser/f5b3-fixture.test.mjs`; expected RED because the fixture API is absent.
- [ ] **Step 3 — GREEN:** Implement `createF5b3Fixture` and `serve` using F5b2 `planNarrativePlatformExport`/`buildNarrativePlatformCandidates`/`verifyNarrativePlatformCandidates` plus existing Release inspectors. Build only in a uniquely owned temp directory, register cleanup of every server and owned directory. Reuse the fake SDK/Bridge *contract shapes* already exercised in C5/V4.
- [ ] **Step 4 — Verify:** Re-run fixture tests and `npm run check`; expected no failures and no outside writes.
- [ ] **Step 5 — Commit:** `test(browser): create source-linked F5b3 archive fixture`.

### Task 2: Narrative parity, cloud saves and responsive play

**Files:** Create/modify `packages/runtime-narrative/test/browser/f5b3-platform-smoke.mjs` using the Task 1 fixture.

**Interfaces:**
- Run `runNarrativeCandidate(target, browserType, device)` on exact ZIP bytes. Collect `{target,browser,viewport,status,archiveSha256,externalRequests,observedStoryPath}` per scenario; the observed path must match the counterpart platform's authored choices and consequences.
- Desktop Chromium 1000×720 and emulated Pixel 7 portrait are mandatory for each target; 320×640 narrow portrait and WebKit iPhone emulation are included in CI. Use the existing N3 selectors and layout checks rather than inventing a second game UI.

- [ ] **Step 1 — RED:** Add a browser scenario for both targets that awaits `#status[data-sdk-ready="true"]`, plays `F5B3_AUTHORED_STORY_317` through photo, keepsake and composed-message echo, checks Back, saves into fake *platform* cloud storage, reloads and confirms preserved scene/journal plus no duplicate Back history. Assert exact source/ZIP hashes, portrait preference, non-clipped 44px mobile actions, no horizontal overflow, visible decoded image and zero non-local requests.
- [ ] **Step 2 — Observe failure:** Run `node f5b3-platform-smoke.mjs` from `packages/runtime-narrative/test/browser` with Playwright Chromium installed; expected RED until the runtime scenario is implemented (or explicit `NOT_RUN` if the browser executable is unavailable).
- [ ] **Step 3 — GREEN:** Implement bounded Playwright contexts for Yandex/VK, output source-linked scenario results, and close pages/servers on both success and failure. Do not relax SDK readiness or use a local-storage fallback to make an SDK failure pass.
- [ ] **Step 4 — Verify:** Re-run Chromium scenarios and existing `npm run smoke:n3` when executable is available; preserve unavailable browser results as `NOT_RUN`.
- [ ] **Step 5 — Commit:** `test(browser): prove narrative parity across Yandex and VK ZIPs`.

### Task 3: Fail-closed SDK lifecycle and adverse browser cases

**Files:** Modify `f5b3-fixture.mjs`, `f5b3-fixture.test.mjs`, `f5b3-platform-smoke.mjs`.

**Interfaces:**
- Expose test-only `sdkMode: 'normal' | 'init-refused' | 'ready-refused' | 'storage-refused' | 'corrupt-cloud'` in the localhost fixture. `init-refused` and `ready-refused` must lack `data-sdk-ready`; cloud failures cannot persist via source preview storage.
- Exercise Yandex `game_api_pause/resume` and VK `VKWebAppViewHide/Restore` while the actual Runtime host runs; verify a paused choice is not applied and one subsequent resume applies it once. Check observable GameplayAPI/audio calls only where that adapter or narrative exposes them.

- [ ] **Step 1 — RED:** Add cases for rejected SDK init/ready, cloud save refusal and malformed stored snapshot, pagehide/restore, pause/resume and attempted gameplay during pause. Assert no false SDK-ready, no silent record overwrite or browser-storage fallback, bounded error status, and no remote requests. Add direct tests showing a tampered served member fails the archive-byte equality gate.
- [ ] **Step 2 — Observe failure:** Run focused Node fixture and Chromium smoke; expected RED on the newly required adverse scenarios.
- [ ] **Step 3 — GREEN:** Extend fake SDK/Bridge and assertions. Only if a **real product bug** is reproduced, add the smallest failing Studio/Connect regression test and fix its root cause in the owning package; never hide it in the fake fixture.
- [ ] **Step 4 — Verify:** Run focused tests, `npm test`, `npm run check`, `node examples/core-session.mjs`; require zero failures.
- [ ] **Step 5 — Commit:** `test(browser): gate narrative SDK lifecycle and failure states`.

### Task 4: CI evidence and browser acceptance boundary

**Files:** Modify nested `package.json`, `.github/workflows/runtime-browser.yml`, `packages/studio/test/narrative-platform-export.test.mjs` and F5b3 smoke.

**Interfaces:**
- `npm run smoke:f5b3` runs the whole F5b3 suite after the existing Playwright install in `runtime-browser.yml`.
- Write `LUDORY_F5B3_ARTIFACT_DIR/f5b3-mock-browser.json` with `schemaVersion:1`, exact source digest, both archive SHA-256 values, per-browser evidence, `status: 'MOCK_SDK_BROWSER_PASS' | 'BLOCKED'`, `mockSdkOnly:true`, `releaseReady:false`, `publicationAllowed:false`. On a failure, write a bounded `BLOCKED` receipt before nonzero exit; screenshots are optional supportive artifacts.

- [ ] **Step 1 — RED:** Add a Studio test asserting the workflow runs `smoke:f5b3`, propagates `LUDORY_F5B3_ARTIFACT_DIR`, and uploads `f5b3-mock-browser.json` with `if: always()`. Add a smoke receipt test rejecting a PASS label with incomplete target/scenario/hash evidence.
- [ ] **Step 2 — Observe failure:** Run `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/narrative-platform-export.test.mjs`; expected RED because the F5b3 CI gate is not yet wired.
- [ ] **Step 3 — GREEN:** Add the nested script and workflow step/upload, and make smoke emit truthful source-bound JSON in `finally`. CI WebKit/Firefox execution must remain mandatory; no fabricated PASS on missing engines.
- [ ] **Step 4 — Verify:** Run `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`, and every available local Playwright engine. On GitHub CI, require the uploaded mock-only evidence and a green browser job; do not equate this with a live platform pass.
- [ ] **Step 5 — Commit:** `ci(browser): require F5b3 mock SDK narrative evidence`.

## Handoff and acceptance boundary

F5b3 must be developed on a separate branch stacked on the **current F5b2 PR #68** until #67 and #68 land. Prior F5b2 review found five Important issues and closed them; do not regress their negative tests. The PR #68 Windows canonical-path fix must pass its rerun before F5b3 can be presented as integrated. A browser smoke may verify **mock SDK contract** only; actual platform availability, rights, moderation and publishing remain NOT_RUN and require separate owner authorization.
