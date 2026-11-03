# Narrative Manifest Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove fixed demo title from the verified narrative shell without changing game save identity.

**Architecture:** Resolve the visible and document title from the validated game manifest in the canonical Studio launcher. Keep the generated entrypoint immutable relative to the new catalog template; update browser-facing HTML placeholder and versioned template contract.

**Tech Stack:** Node.js ESM `node:test`, Ludory Studio catalog, Narrative Runtime and F5b2 compiler.

**Spec:** `docs/superpowers/specs/2026-11-03-narrative-manifest-title-design.md`.

## Global Constraints

- Do not weaken exact canonical-launcher F5b2 verification.
- Preserve the previously deployed `game.id:narrative-demo` save-key contract.
- Use `ludory.project.json.title` for RU/EN fallback. No new external dependencies.
- Work in isolated branch from `main`, without changing original game repository.

## Review Focus

- Missing English title must fall back to RU without resurrecting lighthouse demo.
- Invalid locale must not cause undefined title.
- Existing save key remains byte-for-byte stable.
- Newly generated template's source receipt and F5b2 compiler remain synchronized.
- Tampered author entrypoint remains rejected.

---

### Task 1: Manifest-driven titles

**Files:** `packages/studio/catalog/templates/narrative-interactive/src/main.js`, `packages/studio/catalog/templates/narrative-interactive/index.html`, `packages/studio/test/narrative-template.test.mjs`.

**Interfaces:** Export `resolveNarrativeTitle(game, locale) -> string` returning available title; shell calls it after `defineGame` resolves manifest.

- [x] Add failing tests against generated runtime: RU localized title, English fallback, unknown locale fallback and canonical entry unchanged after export.
- [x] Run targeted test RED because export missing and demo title still hard-coded.
- [x] Implement runtime manifest-title resolution, remove fixed UI demo copy and use neutral initial HTML heading.
- [x] Run targeted tests GREEN and verify F5b2 still blocks tampered launcher.

### Task 2: Version and verify

**Files:** `packages/studio/catalog/templates/narrative-interactive/template.json`, `packages/studio/test/catalog.test.mjs`, `packages/studio/test/narrative-template.test.mjs`, relevant browser fixtures if needed.

- [x] Write/update assertions expecting version 1.2.1.
- [x] Bump template version and update existing contracts for generic heading and manifest-based document title.
- [x] Run Studio, platform-export/compile, and narrative tests plus repo `npm test` where feasible; capture unrun browser tests explicitly.
- [ ] Review diff and commit to `feat/narrative-custom-title`; open PR against Ludory main only after test evidence.

### Verification 2026-11-03

- RED: test `narrative authored entry exports a launch function` failed because `entry.resolveNarrativeTitle is not a function`.
- GREEN targeted: `node --test packages/studio/test/narrative-template.test.mjs packages/studio/test/catalog.test.mjs packages/studio/test/narrative-platform-compile.test.mjs` → 37/37 PASS.
- Full: `npm test` → 1054 PASS, 16 SKIP, 0 FAIL; follow-on quality integration → 18 PASS, 0 FAIL.
- Static/release checks: `npm run check` exit 0. Its inventory reported `rightsStatus=BLOCKED, advisories=NOT_RUN` — not a release clearance.
- Real Chromium/WebKit browser testing not run: those browser executables are unavailable in this worker. Browser fixtures were updated but not accepted as browser QA.
- Existing `narrative-demo` save key deliberately retained; key renaming requires a separate migration contract.
