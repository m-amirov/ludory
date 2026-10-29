# Narrative N2 Runtime UI Implementation Plan

**Architecture selected:** Full graph-owning Narrative Engine (owner confirmed 2026-10-29). **Execution gate:** N1 public contracts must be verified before N2.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide accessible offline DOM scene dialogue, branching choices, photo, keepsake, message, journal and ending UI over N1 full graph state/contracts using the existing Runtime host.

**Architecture:** New optional `@ludory/runtime-narrative` package implements `RuntimeRenderer` and maps finite UI actions to existing normalized Runtime input. It has no platform SDK and does not replace `@ludory/runtime` host; all gameplay facts are Core snapshot state.

**Tech Stack:** Node.js >=22 ESM, DOM/CSS, Runtime v1 contracts, `node:test`, browser smoke with existing project test infrastructure where available.

**Spec:** `docs/superpowers/specs/2026-10-29-narrative-interactions-design.md`.

## Global Constraints

- N1 must be merged/available at verified package version before N2 implementation; otherwise BLOCKED.
- Browser adapter only; no AI/server/camera permission/host SDK, arbitrary HTML or external assets.
- Portrait and desktop wide (including 1000×720), readable text, mouse/touch/keyboard, no gesture-only action.
- Preserve Core snapshot, Runtime pause/resize/save/restore and game-owned renderer contract; never mutate frozen games.

## Review Focus

1. Fast double tap on Send must produce one event and one reply — Task 2.
2. Back from final confirmation restores prior message/album/relations atomically — Task 2.
3. Late resize/unmount must not dispatch into dead Runtime host — Task 1.
4. Screen readers and keyboard-only users must reach all choices and observe selected state — Task 1.
5. Missing image or network-less play must show an accessible fallback and retain progress — Task 3.

---

### Task 1: Renderer contract and accessible widgets

**Files:** Create `packages/runtime-narrative/package.json`, `src/renderer.mjs`, `src/view.mjs`, `src/styles.css`, `src/index.mjs`, `test/renderer.test.mjs`; modify root `package.json` test/check and lockfile.

**Interfaces:** `createNarrativeRenderer({graph,catalog,locale,assets})` returns `{mount,resize,render,unmount}` matching RuntimeRenderer; `render` uses `resolveNarrativeView` from N1. Dedicated views for dialogue, branching choices, photo, keepsake, composer, conditional echoes, journal and endings; text via `textContent`, no `innerHTML` for authored text. Layout is responsive by viewport contract.

- [ ] RED tests for initial mount, photo/keepsake controls, composer preview, journal, accessibility labels, safe text, unmount/resize and finite action dispatch.
- [ ] Implement minimal renderer/widgets and styles; require targeted GREEN.
- [ ] Commit as `feat(runtime-narrative): render accessible novel interactions`.

### Task 2: Runtime input, undo and persistence integration

**Files:** Create `src/update.mjs`, `test/host-integration.test.mjs`; update exports and documentation.

**Interfaces:** `createNarrativeRuntimeUpdate({graph,catalog,historyLimit=...})` returns Runtime-compatible synchronous `update({deltaMs,inputs,state,setState})`. Finite action strings are parsed/validated into N1 `advanceNarrative` actions (next/choice/interaction/echo/ending). Use Core `state.narrative` as canonical; bounded transient history supports Back while active, not a second persisted store.

- [ ] RED tests for pointer/keyboard normalized input, forged conditional/route-locked branch, scene/ending transition, double dispatch, Back, reload/restore, replay/locale transition, lifecycle suspend and corrupt/unknown action.
- [ ] Implement update adapter with snapshot-history guard and validated commands; require targeted GREEN.
- [ ] Commit as `feat(runtime-narrative): connect interactions to Runtime host`.

### Task 3: Browser E2E and N2 evidence

**Files:** Create `test/browser/smoke.mjs` and a minimal fixture; add `docs/evidence/2026-10-29-narrative-n2-acceptance.md`.

- [ ] Write browser flow first: scene choice→photo→attachment→message→conditional echo→route lock→ending→journal, Back→alternative effect, Save→Reload→Continue; viewport 1000×720 and representative Android portrait; no outbound network needed.
- [ ] Run with existing browser test harness; fix observed regressions TDD. If browser is unavailable record BLOCKED and do not claim browser PASS.
- [ ] Run `npm test`, `npm run check`, `node examples/core-session.mjs`; independently review UI/action lifecycle and evidence.
- [ ] Push scoped N2 branch/PR and require passing CI and owner gate before N3.
