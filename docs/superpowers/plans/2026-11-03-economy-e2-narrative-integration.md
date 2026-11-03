# Economy & Monetization — E2 implementation plan

Date: 2026-11-03
State: **OWNER APPROVED 2026-11-03 — implementation in separate feature branch**
Depends on: approved [Economy technical design](../specs/2026-11-03-economy-monetization-design.md), E1 `@ludory/economy` merged and green.
Proposed PR: **one isolated, reviewable E2 feature PR**, based on current `main`; do not touch frozen game repositories.

## Outcome and scope

Build an opt-in, serverless-safe composition between pure Economy E1 and the existing Narrative v1/Runtime without changing the Narrative graph format or enabling monetization in any existing game. An entitled premium choice behaves exactly like an authored ordinary choice, including relationship deltas, flags, memories and delayed narrative echoes. A locked premium choice cannot be dispatched using a forged `narrative:choose` input. Main stories, named routes and intended good endings retain proven free paths.

E2 is **not** SDK integration or production monetary settlement. There are no Yandex/VK purchases, rewarded callbacks, cloud APIs, product SKUs, real transactions or new server dependencies in this PR; those are E3/E4. A test/demo storage port is only a simulated durability boundary. An enabled economy with absent, corrupt or failing durable persistence remains unavailable; it never quietly falls back to localStorage or credits itself. `@ludory/core` stays untouched.

## Proposed public boundaries

1. `@ludory/runtime-economy` (new package, `exports`, Node 22+ ESM, browser-compatible):
   - `definePremiumManifest({schemaVersion:1, choices:[{beatId,choiceId,contentId}]}, {graph, economyConfig})` validates exact references against authored Narrative choices, globally unique `(beatId,choiceId)` keys (and unambiguous beat IDs), known E1 premium content IDs and correct config. Cost is **read from E1 config**, not trusted sidecar/UI input. No mutation of source objects.
   - `verifyFreeNarrativePaths({graph,catalog,manifest,terminals,traces})` performs structural free-edge validation and replays supplied free-action traces with `createNarrativeState`/`advanceNarrative`, rejecting premium steps. A trace declares an intended `{routeId?,endingId,actions}`; the validator checks actual final ending and route lock when declared, including predicates/effects, and rejects missing/duplicate intended terminal coverage. Precise graph reachability constraints are below.
   - `createEconomyRuntime({config,manifest,graph,storage})`: explicit async `initialize()`, read-only `getChoiceAccess(beatId,choiceId)`, async `unlockChoice(beatId,choiceId)`, `getView()` and optional `dispose()`. `storage` is an injected game-scoped async `{load(),save(state)}` adapter. A successful durable save is required **before** publishing a new entitlement as usable. No arbitrary amounts or raw UI-originated economy operations. Single-instance operations serialize; idempotency is delegated to E1. The coordinator will not declare its own storage proof for a production connector.
   - Optional synchronous `authorizeChoice({beatId,optionId})` closure uses only a ready, validated, persisted entitlement state. Missing initialization/storage, pending save, errors and locked content fail closed. A non-premium choice is freely available.
2. `@ludory/runtime-narrative`:
   - Add an optional `authorizeChoice` injection to `createNarrativeRuntimeUpdate`, applied **at the update event boundary** for every `narrative:choose` before `advanceNarrative`; not only in renderer. Existing callers that do not supply the hook retain identical behavior. A monetized composition must always pass the hook; the published premium UI is not an authority boundary by itself.
   - Add an optional `premiumChoices` read-only view/unlock port to `createNarrativeRenderer`. Visible choice buttons display an explicit price and entitlement/access state. Locked choices invoke a separate explicit unlock command and cannot dispatch a narrative choice. A successful unlock refreshes the current beat without advancing it; rejected/pending unlock exposes a non-success status. Only the ordinary narrative action commits the choice's authored effects. Existing renderer remains equivalent with the option absent.
   - Support wallet-only re-render when narrative state has not changed, without destabilizing existing high-FPS focus/click preservation; maintain accessibility on keyboard, touch and portrait.

The exact exported names may be refined during tests, but boundaries and invariants above must not change without review. No need for a broad graph/engine refactor.

## Graph and free-route validation contract

- Treat a manifest entry as an extra gate on an existing `choice`, not as a new graph node. A `(beatId,choiceId)` match must identify exactly one authored choice across the whole graph; reject ambiguous reused beat IDs rather than gate the wrong scene.
- Remove premium-marked edges from a derived free-only scene graph; preserve normal `nextSceneId` links. Ignore predicates **only for the structural reachability pass** and report it as necessary, not sufficient, evidence.
- For every authored choice beat require at least one free outgoing choice, even inside optional scenes. The initial scene and every *free-reachable* nonterminal scene must have a free route to an ending. Premium-only scenes need not be free reachable, but cannot be the only access to an intended ending.
- The game author declares intended free route/ending terminals explicitly, with one complete action trace per target; validate that each trace contains no premium `(beatId,choiceId)`, ends at the specified `endingId`, and reaches a specified `routeLock` when applicable. Replaying is the predicate/effect proof: do not infer feasibility from reachability alone. Invalidated traces fail when stories change.
- Do **not** assert exhaustive exploration of all possible predicate states; report exact proven trace coverage. An ending labelled good by the author must have a free witness. No automatic assumption that all existing endings are good.

## Delivery tasks (TDD, in order)

### Task 1 — Manifest and authoring validation

Files anticipated: `packages/runtime-economy/{package.json,src/manifest.mjs,src/index.mjs,test/manifest.test.mjs}`, root workspace configuration/lock as required.

1. RED tests: valid sidecar, duplicate/ambiguous beat keys, wrong choice IDs, unknown content, wrong version/schema, source immutability, cost sourced from E1, missing free choice, dead-ended free graph, free and premium-only endpoints.
2. Implement strict bounded validation with no SDK/browser/global state. Derive choice lookup from `graph.scenes[*].beats[*]`; no assumptions about scene IDs in existing story assets.
3. Run `node --test packages/runtime-economy/test/manifest.test.mjs`; require GREEN and no incidental Narrative graph mutation.

### Task 2 — Verified free-play traces

Files: `packages/runtime-economy/src/free-paths.mjs`, `packages/runtime-economy/test/free-paths.test.mjs`.

1. RED tests: a free trace reaching a declared good ending, free alternative route, a premium-only good-ending witness rejected, forged/stale action, incorrect `endingId`/`routeId`, unsatisfied relationship predicate, missing terminal witness after graph change, no hidden premium gate in a trace.
2. Traverse scene edges for structural validation; replay full authored actions through the Narrative engine, not a surrogate simulator. Reject failed or nonterminal traces; collect a compact evidence report listing targets and action counts (never claim exhaustive state-space proof).
3. Run targeted tests; review fixture coverage against a premium option that grants `relation_delta`, `flag_set`, `memory_add` and changes a later echo while the free path to a good ending remains valid.

### Task 3 — Durable economy coordinator and gate

Files: `packages/runtime-economy/src/coordinator.mjs`, `packages/runtime-economy/test/coordinator.test.mjs`, `packages/runtime-narrative/src/update.mjs`, `packages/runtime-narrative/test/update.test.mjs`.

1. RED tests: default-disabled pass-through; unknown/locked choice forged directly as renderer/input; empty storage on first initialization; storage missing/rejecting/corrupt; insufficient funds; duplicate unlock and concurrent unlock; successful persisted entitlement; no relation effect at purchase; failed/ambiguous save with reloading/retry; unlocked Replay and fresh session; normal Back does not undo spend or entitlement.
2. Implement serialized `initialize`/`unlockChoice` operations that validate E1 state on load, apply `UNLOCK_PREMIUM`, await the injected `save` and only then swap the ready read-only wallet view. On ambiguous failed saves, reload and reconcile before retry; never report success on a rejected save. The storage contract must be documented as an injected test seam, *not* a real cloud guarantee.
3. Inject `authorizeChoice` into Narrative Runtime's synchronous choose handling. Preserve all existing actions with hook absent; guard against callback exceptions and stale/forged IDs. A gate only authorizes an entitled choice; it never mutates Narrative state or rewards.
4. Run economy, Narrative Runtime, and host-integration suites. Test an actual callback at the input entry point, not only a UI-disabled button.

### Task 4 — Renderer, UX and integration fixture

Files: `packages/runtime-narrative/src/{renderer,styles}.mjs`, renderer tests, a new opt-in E2 example/fixture if useful; package exports/documentation.

1. RED DOM tests: premium label/price, locked action vs unlock command, explicit confirmation (no auto-spend by choosing), unlocked ordinary choose, insufficient-balance notice, pending/rejected save notice, same-beat wallet-refresh, keyboard/touch inputs, stale callback after unmount.
2. Add an opt-in port instead of importing monetization into the legacy renderer path; render localized labels with source-validated cost and currency metadata, avoid HTML insertion and untrusted label execution. Only call unlock after explicit user confirmation.
3. End-to-end simulated scene: choose premium romantic moment → persisted entitlement and debit → authored `relation_delta`/`flag_set`/`memory_add` → later authored echo; Back then choose again without another debit; separate fully free trace reaches the intended good ending.
4. Add focused README setup and short note: E2 simulator ≠ real purchase, saved state is mocked, disabled by default, frozen projects untouched.

### Task 5 — Repository verification and PR review

1. Node 22+ compatibility, browser bundle check (`esbuild` or existing Runtime browser harness), no Node built-ins in browser entrypoints. Workspace package `exports` and lock consistent; imports from published surfaces rather than deep paths.
2. Targeted suites for both new package and Narrative Runtime. Run **`npm test`**, **`npm run check`**, **`node examples/core-session.mjs`**, and the existing relevant browser smoke where possible. No Windows-only check, no Docker and no real platform approval assertion.
3. Require deterministic evidence for: every forged premium selection denied; no duplicate debits across Back/Replay; purchase has no relationship effects; authored premium effects replay once in each story timeline; free good-ending witness; default-off equivalence; failure-closed persistence; compatibility with `@ludory/core` and existing Narrative v1. Separate blocked real-platform evidence from local PASS.
4. Review diff for Story Graph v1 compatibility and potential wallet mismatch after failed saves. Open PR from `main`, retain test evidence and review comments. Merge only after successful checks and review; no deployment, publication, SKU activation or mutations in «Поцелуй на краю света».

## Risks and explicit exclusions

- The browser cannot independently verify that local/player state has not been tampered with. E2 does not pretend to add cryptographic purchase proof.
- Simulated `save()` success is not a guarantee of Yandex Player cloud durability or multi-device atomicity. Real connector adapters, quotas, recovery and SDK tests belong to E3/E4.
- Narrative `Back` is session-local. Premium entitlement persists through Back/Replay, but narrative relationship changes rewind along with the chosen timeline. No cross-timeline permanent relationship bonuses are introduced.
- Premium effects are authored in the original free-compatible Graph v1 choices. The framework cannot invent relationship deltas, intimacy thresholds or “good” ending criteria without a game author's explicit definition.
- If E2 test-driven review discovers a need to change E1's public API, stop and propose the smallest versioned contract adjustment. Avoid hidden breaking changes.

## Approval gate

This file authorizes **no production code changes yet**. Owner approval of the E2 interface and free-route proof contract is required before Task 1. On approval, implement in an isolated branch/worktree starting from verified `main`, review, and merge only after concrete test evidence.

## Post-review implementation decisions (2026-11-03)

- Enabled runtime binds its premium manifest to the active canonical Narrative graph and rejects mismatched versions at constructor and guarded updater/renderer boundaries.
- Free witnesses resolve the canonical current beat before checking premium choice IDs, including actions omitting `beatId`.
- A failed or ambiguous save needs a visible restore-wallet UI action that re-reads durable state before any new unlock; no automatic debit or story choice.
- Disposal after a deferred empty `load()` cannot start a new zero-balance save.
- E2 is local infrastructure only; mock tests cannot authorize platform payments or real release.
