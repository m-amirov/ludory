# Narrative Player-Facing Headings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop displaying narrative engine IDs to players while preserving authored labels, keyboard navigation, saves and Studio-managed upgrade safety.

**Architecture:** Change the shared renderer's heading and panel semantics without changing narrative view/state types. Rebuild the generated Studio bundle under a versioned template, then upgrade the game through the ownership-aware Studio component mechanism after framework integration.

**Tech Stack:** Node.js ESM, `node:test`, Ludory Runtime Narrative, Studio CLI and generated browser bundle, GitHub Actions Chromium.

**Spec:** `docs/superpowers/specs/2026-11-08-narrative-player-headings-design.md`

## Global Constraints

- Template `narrative-interactive` must advance exactly `1.2.4` → `1.2.5` with deterministic generated assets.
- Do not change internal narrative IDs, state/save shape, authored graph, media rights, music, economy, or platform release behavior.
- Do not manually edit Studio-managed files in the game; no host-trust bypass. Game PR #3 stays Draft against PR #2.
- Work from merged Ludory `main`, in `LUDORY/.worktrees/<branch>`; preserve unrelated dirty work and backups.

## Review Focus

- Unlabeled dialogue, choice and echo: no visible `<h2>` and no technical ID in the panel's accessible label — Task 1.
- Explicit photo/keepsake/message `view.label`: heading remains present and localized — Task 1.
- Ending with no authored label: localized ending heading remains present — Task 1.
- Keyboard focus after Back/Next/choice without a heading falls back to the panel, without losing interactive button focus restoration — Task 1.
- Studio upgrade from real 1.2.4 to 1.2.5 preserves all author-owned bytes and writes a recoverable backup — Task 2.

---

### Task 1: Runtime presentation and accessibility

**Files:**
- Modify: `packages/runtime-narrative/src/renderer.mjs` in `draw()`.
- Test: `packages/runtime-narrative/test/renderer.test.mjs`.
- Browser test: `packages/runtime-narrative/test/browser/smoke.mjs` if its harness supports focus assertions; otherwise prove focus in a deterministic DOM integration fixture.

**Interfaces:**
- Consumes `resolveNarrativeView(graph, catalog, state, locale)` with `view.label?: string`, `view.type`, `view.sceneId`, `view.beatId`.
- Produces an `<article class="ludory-narrative__panel">` with `dataset.sceneId`, `dataset.beatId`, localized `aria-label`, and conditional `<h2>`.

- [ ] **Step 1: Write failing tests.** Add exact assertions: `find(panel, el => el.tagName === 'H2') === null` for ordinary unlabeled beats, no raw ID in `panel.getAttribute('aria-label')`, dataset IDs equal fixture state, and existing authored label/ending heading behavior. Cover RU/EN and focus on beat transitions.
- [ ] **Step 2: Run red tests.** `node --test packages/runtime-narrative/test/renderer.test.mjs`; expect only new expectations to fail on existing raw-ID fallback.
- [ ] **Step 3: Implement minimal renderer behavior.** Set `panel.dataset.sceneId/beatId`, set panel accessible label from `UI[locale].story`, append `<h2>` only for `view.label` or `view.type === 'ending'`, retain `panel` focus fallback already present in `draw()`.
- [ ] **Step 4: Run green tests.** `node --test packages/runtime-narrative/test/renderer.test.mjs`; expect zero failures. Run `node --check packages/runtime-narrative/src/renderer.mjs` and `git diff --check`.
- [ ] **Step 5: Commit.** `git add packages/runtime-narrative/src/renderer.mjs packages/runtime-narrative/test/renderer.test.mjs` then `git commit -m "fix(narrative): hide internal IDs from player headings"`.

### Task 2: Studio 1.2.5 generated bundle and ownership-safe upgrade

**Files:**
- Modify: `packages/studio/catalog/templates/narrative-interactive/template.json`.
- Regenerate: `packages/studio/catalog/templates/narrative-interactive/assets/ludory-narrative.js` using the canonical script.
- Modify tests: `packages/studio/test/catalog.test.mjs`, `packages/studio/test/narrative-template.test.mjs`, `packages/studio/test/component-updates.test.mjs`.
- Update relevant version documentation in `packages/studio/README.md` if it calls 1.2.4 the latest.

**Interfaces:**
- Consumes updated Runtime exports and `scripts/build-narrative-template.mjs`.
- Produces real template descriptor version `1.2.5` and a changed managed bundle; Studio `planComponentUpdate()` must yield `READY` for an unmodified, owned 1.2.4 fixture.

- [ ] **Step 1: Write red tests.** Assert template version `1.2.5`, generated bundle check behavior, and fixture upgrading real `1.2.4` managed bundle to `1.2.5` without writes to `src/story.js`, `narrative-assets.json` or image assets; backup persists.
- [ ] **Step 2: Verify red.** `node --test packages/studio/test/catalog.test.mjs packages/studio/test/narrative-template.test.mjs packages/studio/test/component-updates.test.mjs`; expect new version/upgrade assertions to fail against 1.2.4.
- [ ] **Step 3: Regenerate.** Bump the descriptor to `1.2.5`; execute `npm run build:narrative-template`; adjust version-aware tests and README without unrelated edits.
- [ ] **Step 4: Verify green and reproducibility.** Run `npm run check:narrative-template`, the three focused Studio tests, `npm run check`, and `git diff --check`; check rebuilt asset is deterministic. No `npm test` PASS claim unless the complete run finishes.
- [ ] **Step 5: Commit.** Stage only template, generated bundle, relevant tests and documentation; `git commit -m "fix(studio): ship narrative heading policy in template 1.2.5"`.

### Task 3: GitHub review, then game-side adoption

**Files:**
- Ludory: new PR against `main`, documentation in this spec/plan.
- Game after Ludory integration: `tests/m4-browser-qa.mjs`, Studio-managed `game-studio/assets/ludory-narrative.js`, `game-studio/ludory.components.json`, `docs/qa/m4-studio-recovery.md`.

**Interfaces:**
- Consumes the released Studio `narrative-interactive@1.2.5` template and already owner-trusted `game-studio/` project.
- Produces unchanged authored story/provenance hashes, 1.2.5 Studio `IN_SYNC` status and fresh real Chromium S01→S03 evidence.

- [ ] **Step 1: Review Ludory diff.** Validate both Runtime and Studio gates against current `main`, open a dedicated PR, record exact HEAD/checks. Do not merge without final review and explicit user authorization.
- [ ] **Step 2: Check game trust and plan.** After Ludory integration, run read-only Studio `components trust/status/update` on the actual game host. If a new ownership grant is required, stop and ask the owner; never patch trust/manifest by hand.
- [ ] **Step 3: Test updated game behavior.** Modify `tests/m4-browser-qa.mjs` to wait on panel `data-scene-id`/`data-beat-id` and assert that visible headings and accessible panel labels contain no internal IDs for ordinary scenes; preserve existing branch, Back, Save/Reload and cue geometry assertions. Prove tests fail on 1.2.4 before upgrading.
- [ ] **Step 4: Apply legitimate Studio update and verify.** Apply approved 1.2.5 update, record changed managed paths, check `IN_SYNC`, re-run targeted Node and generated presentation checks, and collect fresh GitHub Actions Chromium screenshots at 390×844 and 1000×720.
- [ ] **Step 5: Update game Draft PR.** Publish only verified commits and QA evidence; keep PR #3 Draft and stacked on PR #2. Report remaining media/rights/SDK/release gates separately.
