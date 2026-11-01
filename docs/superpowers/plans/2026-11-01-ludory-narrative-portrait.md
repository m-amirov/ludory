# Ludory Narrative Mobile Portrait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new narrative games portrait-first on phones, without breaking desktop wide layout, landscape use, saves or other game genres.

**Architecture:** A small optional Narrative renderer preference drives scoped mobile CSS; new narrative templates opt in and expose their preference as metadata for QA/release checklists. Existing renderer callers default to the current `auto` behavior; old projects are not rewritten.

**Tech Stack:** Node.js 22+ ESM, DOM/CSS, existing `@ludory/runtime-narrative`, Studio catalog templates, Playwright browser smoke.

**Spec:** `docs/superpowers/specs/2026-11-01-ludory-pre-f5-qa-lan-portrait-design.md` §4, §6.

## Global Constraints

- Default portrait only for **new narrative** templates, not other genres; author can choose `auto` in a new game.
- No forced `screen.orientation.lock`, disabled zoom or lost progress on rotation; actual console orientation is manual until observed.
- Desktop wide remains as before; mobile landscape is usable without misleading forced orientation.
- Keep accessibility, safe areas, focus order, tap targets and story navigation intact.
- No write to existing game repos/user-edited template files; update bundled template assets through existing documented generator only.
- Separate P2 branch from accepted `main`; exact-head CI, independent review and owner-approved merge.

## Review Focus

1. 320px-wide devices with long RU/EN choice labels: buttons wrap without clipping (Task 2).
2. Soft keyboard and large text/zoom: composer and send/cancel controls remain reachable (Task 2).
3. Short landscape phone viewport and safe-area notch: usable fallback, no obscured controls (Task 2).
4. A phone rotated during a choice/save/reload: scene state is stable, no unintended reset (Task 3).
5. An existing programmatic renderer caller omitting preference: old DOM contract and wide layout unchanged (Task 1).

---

### Task 1: Explicit non-breaking renderer preference

**Files:**
- Modify: `packages/runtime-narrative/src/renderer.mjs`, `packages/runtime-narrative/src/styles.mjs`
- Test: `packages/runtime-narrative/test/renderer.test.mjs`

**Interfaces:**
- Extend `createNarrativeRenderer({ graph, catalog, locale, assets, labels, relationFacts, preferredMobileOrientation = 'auto', ... })` where preference is `'auto'|'portrait'` (unsupported values throw `TypeError`).
- On `mount`, expose `data-mobile-preference="auto|portrait"` on the `.ludory-narrative` section while retaining existing `data-orientation` based on viewport; `resize` updates actual viewport state only.

- [ ] **Step 1: Write failing tests** for `portrait` data attribute, invalid preference, `auto` default, `resize` preserving preference, unchanged existing story inputs/callbacks.
- [ ] **Step 2: Run** `node --test packages/runtime-narrative/test/renderer.test.mjs` → FAIL for unsupported preference behavior.
- [ ] **Step 3: Implement** the optional constructor argument + scoped attribute; add portrait-specific CSS rules for readable panel width/spacing and intrinsic overflow without affecting desktop (`@media`/viewport selectors). Keep orientation based on measured viewport, not UA detection.
- [ ] **Step 4: Rerun** targeted tests → PASS, including stable snapshots for existing callers.
- [ ] **Step 5: Commit** `feat(narrative): support optional portrait-first mobile presentation`.

### Task 2: New Studio templates opt in

**Files:**
- Modify: `packages/studio/catalog/templates/narrative-interactive/src/main.js`, `packages/studio/catalog/templates/narrative-interactive/index.html`, `packages/studio/catalog/templates/narrative-interactive/template.json`
- Modify: `packages/studio/catalog/templates/narrative-basic/index.html`, `packages/studio/catalog/templates/narrative-basic/template.json`
- Test: `packages/studio/test/narrative-template.test.mjs`, `packages/studio/test/scaffold.test.mjs`
- Generated after source edit: `packages/studio/catalog/templates/narrative-interactive/assets/ludory-narrative.js`

**Interfaces:**
- New game templates declare `<meta name="ludory-mobile-orientation" content="portrait">`; interactive reads this meta at startup and passes `preferredMobileOrientation: (metaContent === 'portrait' ? 'portrait' : 'auto')` to the renderer; basic template uses the same metadata as the selector for its scoped CSS. Changing the meta to `auto` in a new game opts out in both templates.
- Increment both affected narrative template versions in `template.json` (existing Studio catalog accepts strict fields only); do **not** add an unvalidated field to existing strict profile schema.

- [ ] **Step 1: Write failing template tests** asserting portrait meta/renderer input for new interactive/basic games, ability to opt out by changing new-game metadata/config, no template write into existing project; verify other templates have no new setting.
- [ ] **Step 2: Run** `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/narrative-template.test.mjs` → FAIL for missing opt-in.
- [ ] **Step 3: Update** template HTML/CSS and renderer call to consume the opt-out meta; build generated bundled code with `npm run build:narrative-template`, update template version/fixture expectations and target orientation declaration **only as intended metadata** (Yandex console remains user-managed).
- [ ] **Step 4: Run** `npm run check:narrative-template` and targeted Studio tests → PASS, including deterministic bytes and no unexpected changes outside narrative templates.
- [ ] **Step 5: Commit** `feat(studio): default new narrative templates to mobile portrait`.

### Task 3: Actual viewport matrix and regression smoke

**Files:**
- Modify: `packages/runtime-narrative/test/browser/studio-n3-smoke.mjs`, `packages/runtime-narrative/test/browser/smoke.mjs` as needed
- Modify: `packages/runtime-narrative/README.md`, `packages/studio/README.md` if present; otherwise adjacent documented quickstart

**Interfaces:**
- Uses Task 2 new sample and original Node/browser fixtures. Exposes no new public runtime API.

- [ ] **Step 1: Add failing browser assertions** for 320×640, representative Android/iPhone portrait, 667×375 landscape, 1000×720 desktop and tablet: visible actionable buttons, no overlapping/clipped text, no page-level horizontal scroll; save/reload after orientation change preserves exact scene.
- [ ] **Step 2: Run** `node packages/runtime-narrative/test/browser/studio-n3-smoke.mjs` → FAIL at least on missing portrait preference or overflow assertion.
- [ ] **Step 3: Refine** template/renderer CSS only as the observed failures require; protect keyboard input, accessible zoom, Back and save semantics; document that responsive preference is separate from Yandex/VK console orientation settings.
- [ ] **Step 4: Run** the same browser smoke on available Chromium emulated devices (and WebKit if installed), plus `npm test`, `npm run check`, `node examples/core-session.mjs`. Absent WebKit/physical iPhone = `BLOCKED` for that environment, not simulated PASS.
- [ ] **Step 5: Commit** `test(narrative): cover portrait and rotation experience`.
- [ ] **Step 6: Open P2 PR**, review exact-head CI/browser screenshots and obtain owner approval before merging.
