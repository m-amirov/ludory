# Narrative N1 Pure Engine Implementation Plan

**APPROVED ARCHITECTURE:** Full reusable Narrative Engine, including canonical scene graph, branches, locks, delayed callbacks and endings; owner confirmed 2026-10-29.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver deterministic, offline full scene graph interpreter, transitions, route locks, echoes, endings, and photo/keepsake/message/relationship/memory primitives as `@ludory/narrative`.

**Architecture:** A new pure ESM package validates authored graph + interaction catalogs, executes graph-owned choices, scene transitions and finite actions immutably to JSON state, and projects view/journal models. It does not modify Core/Runtime/Studio public behavior and stores no data outside a Core-compatible state subtree.

**Tech Stack:** Node.js >=22, ESM, `node:test`, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-29-narrative-interactions-design.md`.

## Global Constraints

- `@ludory/core` remains genre/platform-neutral; no browser globals, SDK, filesystem, Phaser or runtime AI in N1.
- `schemaVersion:1`, immutable/copy-on-write JSON, finite catalog-controlled IDs and effects; no function-valued conditions.
- All three interactions have authored reactions and explicit observable echoes, and `message` has only enumerated valid tuples.
- Graph is the only canonical source of scene transitions, conditional branches, route locks and endings; all predicates are declarative data.
- Follow `AGENTS.md`, TDD RED before GREEN, npm workspace exports and local sample/demo content only.
- Never modify frozen existing games, assume a release gate, or silently rewrite Studio project-owned files.

## Review Focus

1. Duplicate action after restore or rapid click must not reapply relations, memory or collectibles — Task 2 regression.
2. Unknown interaction/option, crafted JSON objects and `__proto__`-like keys must be rejected without mutation — Tasks 1 and 2.
3. A reachable message tuple with missing localized preview/reply must be rejected by catalog validation — Task 3.
4. Journal entries gated by unearned memory or undiscovered route must remain hidden — Task 4.
5. Save snapshot with unknown IDs, corrupt types, or extra fields must be rejected without wiping supplied state — Task 4.
6. Forged choice to hidden branch, route-lock violation, broken transition, invalid echo source and unreachable ending must be rejected — Tasks 1 and 4.

---

### Task 1: Package and strict authored catalog

**Files:** Create `packages/narrative/package.json`, `packages/narrative/src/catalog.mjs`, `packages/narrative/src/index.mjs`, `packages/narrative/test/catalog.test.mjs`, `packages/narrative/README.md`. Modify root `package.json` test/check scripts and lockfile.

**Interfaces:** `defineNarrativeCatalog(input)` returns a canonical, frozen copy of `{schemaVersion:1,interactions:[...]}`; `getNarrativeInteraction(catalog,id)` returns one validated interaction. Allowed type tags: `photo`, `keepsake`, `message`; each has unique slug IDs, RU/EN localized labels, explicit options and referenced echo IDs. Define finite allowed effect operations `relationship_delta`, `flag_set`, `memory_add`, `album_add`, `keepsake_add`. No executable predicates or unknown keys.

- [ ] Write tests for schema/version/id/type uniqueness, forbidden input prototypes, unsupported effects, invalid referenced IDs and missing authored echoes; include valid photo/keepsake/message fixtures.
- [ ] Run `node --test packages/narrative/test/catalog.test.mjs`, observe expected RED (module/functions missing).
- [ ] Implement catalog validation, own-data JSON copying and exports; update workspace package metadata and root test/check script.
- [ ] Re-run the targeted test, require GREEN; run `node --check packages/narrative/src/catalog.mjs`.
- [ ] Commit as `feat(narrative): validate authored interaction catalogs`.

### Task 1B: Canonical scene graph and declarative predicates

**Files:** Create `packages/narrative/src/graph.mjs`, `packages/narrative/src/predicates.mjs`, `packages/narrative/test/graph.test.mjs`. Update exports/README.

**Interfaces:** `defineNarrativeGraph({schemaVersion:1,id,startSceneId,scenes})` freezes a validated graph; `scenes[]` have ordered `beats` (`dialogue`, `choice`, `photo`, `keepsake`, `message`, `echo`), `choices` with `targetSceneId` and optional `when`, optional `endingId`. `evaluateNarrativePredicate(predicate,state)` supports only `all/any/not/flag/memory/routeIntent/routeLock/relation`. Graph checks unique IDs, valid targets, source events, ending reachability ignoring conditions, nonterminal exits, no unbounded automatic loops.

- [ ] RED tests: broken graph targets, unknown predicates, missing echo source/target, duplicate scenes, unreachable endings and a valid two-route sample.
- [ ] Implement strict canonical graph/predicate validation; require GREEN.
- [ ] Commit as `feat(narrative): validate branching scene graphs`.

### Task 2: Pure photo and keepsake effects

**Files:** Create `packages/narrative/src/state.mjs`, `packages/narrative/src/reducer.mjs`, `packages/narrative/test/reducer.test.mjs`. Update `src/index.mjs` exports.

**Interfaces:** `createNarrativeState(graph)` returns canonical `{schemaVersion:1,sceneId,beatIndex,relations:{},flags:{},routeIntent:null,routeLock:null,memories:[],album:[],keepsakes:[],messages:[],completedEvents:[],completedEchoes:[],visitedScenes:[start],actionLog:[]}`. `advanceNarrative(graph,catalog,state,action)` owns the interaction's scene/beat transition and choice effects. Bounded action-log replay validates earned facts, routes and positions; revisit of a one-shot interaction beat auto-skips it instead of duplicating rewards. Invalid options throw without mutating original state.

- [ ] Write tests for `photo` consent/decline and `keepsake` one-item exclusive selection, relation bounds, immutability, repeated identical/distinct action and hostile IDs.
- [ ] Run targeted `node --test packages/narrative/test/reducer.test.mjs`, observe RED.
- [ ] Implement canonical initial state and photo/keepsake reducers, immutable receipts, no global I/O.
- [ ] Require GREEN; run combined narrative tests.
- [ ] Commit as `feat(narrative): apply deterministic keepsake and photo choices`.

### Task 3: Offline authored message composer

**Files:** Create `packages/narrative/src/message.mjs`, `packages/narrative/test/message.test.mjs`; extend catalog validation/reducer and index exports.

**Interfaces:** `resolveNarrativeInteraction(catalog,state,id)` returns context-filtered options/view model for all types. For `message`, `selection={recipient,intent,tone,attachmentId?}` must select **exactly one authored valid tuple** with full RU/EN preview/reply. Attachments may only reference already-earned album/keepsake IDs. A sent message stores bounded semantic metadata and `eventId`, never arbitrary free text. Graph beat advancement happens only through `advanceNarrative`. No AI claims or timeouts.

- [ ] Add RED tests for message tuple enumeration, invalid combinations, missing localization, undiscovered attachment, effect/response selection from relation flags, cancel vs send, unrelated context independence.
- [ ] Implement finite tuple matching and deterministic message application/preview with no injected snippets or HTML interpolation.
- [ ] Require targeted and full narrative GREEN.
- [ ] Commit as `feat(narrative): compose authored offline messages`.

### Task 4: Echo/journal projection, state validation and Core interop

**Files:** Create `packages/narrative/src/journal.mjs`, `packages/narrative/test/journal.test.mjs`, `packages/narrative/test/core-interop.test.mjs`; update README/index.

**Interfaces:** `buildNarrativeJournal(graph,catalog,state,locale)` returns earned memories/album/keepsakes/relationship notes without numeric spoilers, validating state first; `validateNarrativeState(graph,catalog,state)` returns checked JSON or throws without mutation by replaying canonical actionLog. `resolveNarrativeView` and `advanceNarrative` deliver graph navigation, conditional choices, route locks, echo payoff only after source event, and endings; compiled graph validates all target/source IDs and strictly excludes echo-before-source. `validateNarrativeEchoCoverage(graph)` is an explicit authoring gate for every interaction beat. Preserve `state.narrative` via generic Core snapshot and restore (`@ludory/core` existing API).

- [ ] RED tests for unreachable/hidden branch selection, locked route, scene advancement, ending, unseen memories, false/duplicate echoes, invalid state and real createGameSession snapshot/restore without hidden external state.
- [ ] Implement projection and strict validation; add README sample of branching scene→photo→keepsake→message→echo→ending sequence.
- [ ] Require GREEN; run `npm test`, `npm run check`, `node examples/core-session.mjs`, record outputs and any environment blockers.
- [ ] Commit as `feat(narrative): expose journal and Core-compatible snapshots`.

### Task 5: N1 review and integration gate

**Files:** Add `docs/evidence/2026-10-29-narrative-n1-acceptance.md` with exact tested HEAD, commands, exit codes, uncovered risks. No changes to existing games.

- [ ] Review public exports, package isolation, workspace lock, test coverage, idempotence and security edge cases; conduct an independent code review.
- [ ] Resolve Critical/Important findings, rerun all required checks after the fixes.
- [ ] Push scoped branch, open N1 PR with evidence and explicit limitations. Merge only after review/CI and owner-authorized gate; do not call N2 or release PASS based on N1.
