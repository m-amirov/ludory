# F5b2 Narrative Dual-Target Candidate Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From one F5b1-trusted, freshly pinned narrative game, build separately inspected Yandex/VK ZIP candidates whose external receipts prove that both contain the author's story from the same source digest.

**Architecture:** Give newly scaffolded narrative games an explicit, platform-injectable launch function without changing their browser behavior. Bundle that original authored entrypoint and story from the immutable F5b1 snapshot into two fresh Studio SDK projects, each with its own Connect adapter and local managed SDK. The existing candidate builders and Release archive inspectors create and check the ZIPs; exclusive outputs and a paired receipt bind archive bytes to one source.

**Tech Stack:** Node.js 22+ ESM, esbuild (already pinned), Studio scaffold/trust/preview, Runtime Narrative, Connect Yandex/VK, existing candidate builders, Release archive inspection, Node test.

**Spec:** `docs/superpowers/specs/2026-11-02-f5b-narrative-platform-export-design.md` (owner-approved approach A, 2026-11-02).

## Global Constraints

- F5b2 accepts only the *same in-process F5b1 plan object* produced by `planNarrativePlatformExport`; rerun `materializeNarrativePlatformSource` before derivation. Untrusted plans, changed sources and incompatible entrypoints produce `BLOCKED` with no success verdict.
- Only new Studio narrative games; do not modify or migrate a user's source project, any frozen game, Starter Kit or CEOS.
- The **author's actual** `src/main.js`, `src/story.js` and referenced local media must be compiled/copied from the pinned source; do not silently substitute an example story or source-independent bootstrap.
- Each generated target project is created through `planCreate`/`applyCreatePlan` with `web-game` and exactly one matching `yandex-runtime`/`vk-runtime` target; do not fake Studio receipts or loosen existing packager/Release admission.
- The Yandex ZIP has the locally managed `ludory-yandex.js` and *no copied* `sdk.js`. The VK ZIP has only its bundled `ludory-vk.js` / local `vk-bridge.js` plus managed licenses. No remote fallback or network dependency is introduced.
- Actual source contents and platform-specific lifecycle, persistence and SDK readiness are mandatory for candidate acceptance. F5b3 remains the browser-level verification gate, not a reason to claim browser PASS in F5b2.
- ZIP outputs and receipts are created exclusively in a pre-existing caller-selected output directory, never overwrite, and remain outside the source/derived roots. Any partial output on error must be reported; never silently delete an uncertain file.
- A successful F5b2 result is `CANDIDATES_BUILT_LOCAL`, `releaseReady: false`, `publicationAllowed: false`; no mock SDK PASS, live platform PASS, moderation or rights clearance is claimed. Owner has waived offline startup only.

## File Structure

- `packages/studio/catalog/templates/narrative-interactive/src/main.js`: authored launch function and UI/game logic; no SDK import.
- `packages/studio/catalog/templates/narrative-interactive/src/entry.js`: normal browser auto-start of the authored launch function.
- `packages/studio/catalog/templates/narrative-interactive/index.html`, `template.json`: point to the new entry; declare the file/version.
- `packages/studio/src/narrative-platform-compile.mjs`: compile pinned entry/story and local Connect SDK bootstrap into strict single-file target `src/main.js`, and adapt pinned narrative HTML without replacing its authored DOM/CSS; refuse unresolved/remote/out-of-snapshot imports.
- `packages/studio/src/narrative-platform-export.mjs`: F5b1 plan consumption, derived Studio scaffolds, output admission, candidate builds, paired hash receipt and cleanup; preserve F5b1 APIs.
- `packages/studio/test/narrative-platform-compile.test.mjs`, `narrative-platform-export.test.mjs`, `narrative-template.test.mjs`: real fixtures, hard failure and content-provenance tests.
- `package.json`: add new modules to syntax checks; no new dependency.

## Review Focus

1. Author-customized `src/main.js` that changes semantics or removes the exported launch contract: compile the real code when supported, otherwise return a clear `BLOCKED` before generating any ZIP (Task 1/2 tests).
2. Source contains a local JS import outside its snapshot, dynamic remote import, or a copied platform SDK: reject rather than bundle a foreign dependency (Task 2 tests).
3. A source asset is missing, a symlink, over-size, case-colliding, or name-invalid under the stricter ZIP allowlist: fail closed without content substitution (Task 2 tests).
4. Destination already exists, is a symlink, overlaps the source, or changes during the operation: exclusive output admission and partial-output accounting; do not overwrite or erase foreign files (Task 3 tests).
5. Stale source after F5b1 plan, swapped target ZIP, post-build modification, inconsistent author story or pair receipts: linked hash verification returns `BLOCKED` and never a release verdict (Task 3 tests).

---

### Task 1: Explicit authored narrative launch contract

**Files:** Modify `packages/studio/catalog/templates/narrative-interactive/src/main.js`, `index.html`, `template.json`; Create `src/entry.js`; Modify `packages/studio/test/narrative-template.test.mjs` and existing narrative browser smoke as necessary.

**Interfaces:**
- Produce `export async function startNarrative({ platform = null } = {})` in the authored `src/main.js`.
- `platform.prepare(game)` returns `{ storage, attach(host), ready(host), dispose() }` for target-specific Connect lifecycle. No platform argument means the existing browser `localStorage` path; UI, state, Back, saves, restart and translations remain unchanged.
- `src/entry.js` imports `startNarrative` and calls it once for the ordinary source preview; the derived target compiler imports that exact exported function, never the preview auto-start wrapper.

- [ ] **Step 1 — RED:** Add `narrative entry exports startNarrative without auto-running on import`: dynamic-import a fresh source project's `src/main.js` in a DOM-less Node process and assert `typeof module.startNarrative === 'function'`; use the browser smoke to assert `src/entry.js` starts the game, including after an authored story edit. Test that a missing `startNarrative` export is not mistaken for a supported source contract.
- [ ] **Step 2 — Observe failure:** Run `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/narrative-template.test.mjs`. Expected: at least the new launch-interface test FAILS because the current entry auto-starts and does not export that function.
- [ ] **Step 3 — GREEN:** Move browser autorun into `src/entry.js`; expose `startNarrative` and attach/ready/dispose hooks at the real Runtime host lifecycle points. Bump the catalog template version, retaining source and story ownership.
- [ ] **Step 4 — Verify:** Re-run the targeted Node tests, `npm run check:narrative-template`, the existing narrative browser smoke and `npm test`; expected: all green (browser may be deferred only if its dependency is unavailable, explicitly recorded).
- [ ] **Step 5:** Commit `feat(studio): expose injectable narrative runtime launch contract`.

### Task 2: Verified derivation of two separate Studio targets

**Files:** Create `packages/studio/src/narrative-platform-compile.mjs`, `packages/studio/test/narrative-platform-compile.test.mjs`; Modify `packages/studio/src/narrative-platform-export.mjs`, `packages/studio/test/narrative-platform-export.test.mjs`.

**Interfaces:**
- `compileNarrativePlatformEntrypoint({ sourceRoot, target }) -> { entryBytes, htmlBytes, authorEntrySha256, authorStorySha256 }`, target is `yandex-games` or `vk-games`. Bundle the pinned *authored* `src/main.js` plus its local imports using esbuild, with strict resolution confined to the pinned snapshot; leave only the exact target's required local SDK imports in the emitted ESM and no extra executable file in its ZIP. Until F5b3 can attest the runtime platform handshake, accept only the unchanged built-in adapter-aware `src/main.js`; modified launchers (even with a named export) are explicitly `BLOCKED`, never silently replaced.
- Private `deriveNarrativePlatformProjects(pin) -> { yandex: {root, hash, files}, vk: {root, hash, files}, cleanup }` is called only by the trusted F5b2 orchestration after a successful fresh F5b1 materialization; do not export a new forgeable `SOURCE_PINNED` admission path. Scaffold both targets with `pin`'s pinned `ludory.project.json` id/version/title/language; copy allowed media from pin, write compiled target entry and an adaptation of the **pinned authored** `index.html` (preserving real story DOM/CSS and changing only its module script to `src/main.js` plus the required Yandex SDK script), keep managed SDK bytes/receipts from scaffold untouched; verify Studio origin and a deterministic sorted `{path,sha256,size}` derived-project digest.
- Target bootstrap calls the real Connect adapter (`createYandexConnector`/`createYandexLifecycle`/`createYandexPlayerStorage` or VK equivalents); Yandex readiness precedes `host.start()`, VK Bridge is bundled local. Both inject host storage and lifecycle through Task 1's interface. The generated entry explicitly exposes a testable readiness/error status, but never labels SDK mocks as live approval.

- [ ] **Step 1 — RED:** Add `F5b2 derives the authored story and UI into two trusted single-target projects`: in real fresh Studio fixtures author literal story marker `F5B2_CUSTOM_STORY_214` and UI heading `F5B2_CUSTOM_TITLE_214`, then assert both compiled entrypoints contain the marker, both HTML files retain the heading and responsive CSS, both manifests match source `id`, `version`, `title` and each has the exact one-element target array. Assert both `verifyStudioOrigin(...).ok === true` and compare source hashes before/after. Add named negative cases for an old/incompatible entry, copied SDK, foreign imports, missing/symlinked/media-collision assets, and platform-target swaps.
- [ ] **Step 2 — Observe failure:** Run `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/narrative-platform-compile.test.mjs packages/studio/test/narrative-platform-export.test.mjs`. Expected: new compiler/deriver APIs missing, tests FAIL for the intended reason.
- [ ] **Step 3 — GREEN:** Implement strict esbuild input graph admission, explicit target bootstraps and derived temporary Studio scaffolds using `planCreate`/`applyCreatePlan`, with owned cleanup only. Adapt *source* narrative HTML while preserving its UI and satisfying both target archive script policies; never substitute the SDK sample game's score/buttons page or weaken either builder.
- [ ] **Step 4 — Verify:** Re-run targeted tests, `npm run check`, `npm test`, `node examples/core-session.mjs`; expected: zero failures and no unexpected skips.
- [ ] **Step 5:** Commit `feat(studio): derive verified Yandex and VK narrative projects`.

### Task 3: Exclusive ZIPs, paired source receipts and local verification

**Files:** Modify `packages/studio/src/narrative-platform-export.mjs`, `packages/studio/test/narrative-platform-export.test.mjs`; Modify `package.json` for new syntax checks if needed.

**Interfaces:**
- `export async function buildNarrativePlatformCandidates(plan, { yandexZip, vkZip, yandexBuildReceipt, vkBuildReceipt, exportReceipt })` returns `{ mode:'narrative-platform-export', status:'CANDIDATES_BUILT_LOCAL', sourceDigest, candidates:{ yandex, vk }, exportReceipt, releaseReady:false, publicationAllowed:false }` or `{status:'BLOCKED', reasonCode, partialOutputs:[...], releaseReady:false, publicationAllowed:false}`. The five explicit destinations must be distinct, outside source and derived roots, in existing regular directories, and initially absent. No implicit default publication path.
- Existing `buildYandexCandidate` and `buildVkCandidate` write ZIP bytes. Write their exact `{archivePath,sha256,files}` build receipts as exclusive JSON files. Write one separate paired `schemaVersion:1` receipt containing `{sourceDigest, sourceFiles, candidates:[{target, derivedProjectSha256, archivePath, archiveSha256, files}]}`; the same pinned source digest is present exactly once at pair level, binding both targets.
- `export function verifyNarrativePlatformCandidates({ yandexZip, vkZip, yandexBuildReceipt, vkBuildReceipt, exportReceipt }, sourcePlan)` requires the original live, in-process F5b1 host-trusted plan. It re-materializes the current source/derived projects and compares them with the paired receipt, re-reads regular receipts, inspects ZIP bytes with `inspectYandexArchive`/`inspectVkArchive`, checks every archive/member/build-receipt digest, target exclusivity and derived hash binding; returns `LOCAL_ARCHIVES_VERIFIED` or `BLOCKED` (never Release PASS), preserving `releaseReady:false` and `publicationAllowed:false`. Standalone mutable JSON receipts are never proof of original source identity.

- [ ] **Step 1 — RED:** Add `F5b2 paired ZIPs both authenticate one source` with literal test marker `F5B2_CUSTOM_STORY_214`: create fresh dual-target narrative, call the build API with five distinct paths, assert status `CANDIDATES_BUILT_LOCAL`, both `inspect*Archive` hashes equal their recorded ZIP hashes, and `verifyNarrativePlatformCandidates(...)` returns `LOCAL_ARCHIVES_VERIFIED` with the original source digest; both archives expose the marker, and no author file changes. Add tampering cases for one ZIP, receipt, member hash, target, source digest or path, all expecting `BLOCKED`. Cover preexisting destination/alias/overlap, no overwrite, and a deliberately failed second packager with explicit partial-file accounting.
- [ ] **Step 2 — Observe failure:** Run `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/narrative-platform-export.test.mjs`. Expected: new build/verify entrypoints missing and tests FAIL.
- [ ] **Step 3 — GREEN:** Implement exclusive output preflight and receipt creation, use both existing candidate builders, run both Release inspectors, re-read receipt and archive bytes before success, and always invoke snapshot/derived-project cleanup in a `finally`. Preserve uncertain partial outputs for owner recovery rather than deleting by guessed path.
- [ ] **Step 4 — Verify:** Run targeted tests, `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`; expected: exit 0. Run a local full sample source-to-two-ZIPs test from a fresh temp narrative game and inspect both ZIPs with Release, but do not claim browser or live SDK acceptance.
- [ ] **Step 5:** Commit `feat(studio): emit source-linked Yandex and VK narrative ZIP candidates`.

## Handoff and acceptance boundary

Review all code and tests across the entire F5b2 branch. The local F5b2 branch starts from F5b1, so any PR created before #67 merges must be explicitly **stacked on PR #67** and retargeted only when safe; do not push, merge into `main` or publish games without separate owner authorization. F5b3 will consume the two locally verified ZIPs in real-browser fake-SDK/Bridge tests and cannot be marked done by F5b2 tests alone.
