# Narrative Interactions for Ludory — design

**Status:** Architecture approved by owner, 2026-10-29: **full reusable Narrative Engine**, not a collection of widgets. **Scope:** new Ludory projects only; no existing-game migrations or publication.

## Intent

Provide a reusable, offline-first **narrative scene engine** across future Ludory games: canonical scene graph, choices, conditional transitions, route intent/locks, delayed callbacks, endings, photo composition, keepsake selection, guided message composition, relationship state, and memories/journal. A game supplies story content, characters, art and explicitly authored effects; Ludory owns graph validation, deterministic sequencing/execution, conditional transitions, persistence integration, UI adapters and Studio scaffolding.

The first consumer is intended to be a *new, separately authorized* Ludory-native edition of «Поцелуя на краю света». The existing repository is frozen by `AGENTS.md`; neither implementation nor testing here may modify it. Content must not encode that story's names, places, or route graph as framework defaults.

## Goals

1. All interactive operations work without network or runtime AI/API calls; assets are local to the game bundle.
2. Photo, keepsake, and message choices cause observable immediate and delayed consequences authored by the game.
3. Choice application is deterministic and idempotent; state is JSON-only, validated and usable in `@ludory/core` snapshots.
4. Narrative UI is opt-in, keyboard/pointer/touch accessible, responsive for portrait and VK-style desktop wide layouts, without hardware-camera permission or free-text requirements.
5. Authoring detects missing reactions, invalid branch predicates, contradictory message combinations, invalid localization/asset references, duplicate IDs, and unreachable configured echoes before release.
6. Studio creates a fresh `narrative-interactive` example through preview-first, ownership-safe scaffolding. Existing `narrative-basic` template remains unchanged and usable.
7. Verifiable evidence distinguishes tests/browser emulator from actual physical devices and host platform compliance.
8. Graph owns canonical scene/beat sequencing, conditional choices, route locks and ending transitions; every interactive beat and authored delayed payoff is tied to the same state machine, not to game-specific sequencing glue.

## Non-goals

- Not a generic LLM chat engine; runtime messages have **no free-form text input** or neural classification.
- No mandatory reflex/puzzle minigames, currency/energy loop, camera/contact/files access, platform SDK dependencies, server, paid inference, or telemetry.
- No automatic adoption or rewriting of CEOS/Starter Kit or other existing games.
- No change to Core's platform-neutral contract, `@ludory/runtime` generic host, or Phaser internals solely to implement romance-specific logic.
- No claimed VK/Yandex release readiness. SDK integrations, review, rights, moderation and devices are independent gates.

## Alternatives considered

| Alternative | Tradeoff | Decision |
| --- | --- | --- |
| Bake mechanics directly into every game template | Quick demo, duplicates state/validation and prevents reuse | Reject |
| Put romance-specific fields into `@ludory/core` | Fewer packages but violates Core's genre-neutral boundary | Reject |
| **Pure narrative package + optional browser adapter + Studio template** | Versioned package surfaces and more initial tests, but reusable across games | **Select** |

The user selected an interactive romance loop over text-only VN and full minigames, approved all three interactions, and chose offline authored message composition over server AI.

## Ownership and integration

```
@ludory/core                   Generic JSON state/session; unchanged
@ludory/narrative              Pure scene graph, deterministic engine, interactions, state/view model
@ludory/runtime                Existing host, input/audio/save/viewport; unchanged
@ludory/runtime-narrative      Opt-in DOM renderer/input translation for narrative UI
@ludory/studio                 New narrative-interactive template + profile catalog entry
Connect                        No changes to platform adapters during this project
```

**N1: `@ludory/narrative`** must not import DOM, Node filesystem, Phaser, Runtime, host SDKs, or platform APIs. Its public exports are versioned (new `schemaVersion: 1`). It accepts plain game-owned catalog/configuration and returns JSON-compatible data. A snapshot of `state.narrative` can be stored inside Core state; no second persistent save system.

**N2: `@ludory/runtime-narrative`** implements the existing `RuntimeRenderer` contract and translates UI actions into normalized `RuntimeInputEventV1` actions consumed by a pure narrative update adapter. It owns only transient in-session rollback state; gameplay state is persisted through the Core/Runtime snapshot. No page JS string evaluation, no innerHTML of narrative text. All accessibility and sizing constraints live here; Phaser can be a future optional renderer, not an MVP dependency.

**N3: Studio** adds an opt-in built-in `narrative-interactive` template under `narrative-game` profile; new template uses locally bundled ESM modules and contains self-contained demo content for all three mechanics. Bump profile/template versions with existing catalog rules. Do not overwrite or silently alter existing game assets or Studio-managed project files. Reuse existing SHA-bound creation receipts and preview/apply. No external CDN.

## Narrative graph and catalog v1

A game authors a validated catalog. Suggested public interfaces for implementation planning:

- `defineNarrativeGraph(input)` validates and freezes a canonical authored graph with `schemaVersion:1`, `startSceneId`, unique `scenes[].id`, per-scene ordered `beats`, explicit `ending` scenes, and referenced interactions. Choices declare finite `targetSceneId` and optional declarative `when` predicate. Non-ending scenes have a reachable transition, or validation fails.
- `defineNarrativeCatalog(input)` validates and freezes authored photo, keepsake and message definitions, plus memories/echo definitions; all IDs are unique and referenced graph beats resolve.
- `createNarrativeState(graph)` produces `{schemaVersion,sceneId,beatIndex,relations,flags,routeIntent,routeLock,memories,album,keepsakes,messages,completedEvents,completedEchoes,visitedScenes,actionLog}`. State is JSON-only; validation replays the bounded canonical action log to reject inconsistent earned data/position, without pretending offline saves are cryptographically tamper-proof.
- `resolveNarrativeView(graph,catalog,state,locale)` returns the current authored beat, finite available options and earned journal data with no future spoiler. Interactive beats are `dialogue`, `choice`, `photo`, `keepsake`, `message`, `echo`, `ending`.
- `advanceNarrative(graph,catalog,state,action)` executes one admissible action, transition or beat advancement and returns `{state,receipt}`; duplicates do not reapply effects. All branch checks and echoes read the same state snapshot. An authored `route_lock` effect makes subsequent incompatible choices unavailable; route/ending transitions are still graph-authored.
- `buildNarrativeJournal(graph,catalog,state,locale)` returns discovered entries only after state validation; `validateNarrativeState(graph,catalog,state)` rejects inconsistent earned flags/memories/route/position using action-log replay without erasing the caller's snapshot. `validateNarrativeEchoCoverage(graph)` is a strict authoring/release preparation gate requiring each authored interaction beat to have a declared delayed echo; lightweight prototype graphs may omit this optional check.

Public signatures can be adjusted during implementation if there is a smaller consistent API, but **no runtime content executor may interpret arbitrary JavaScript embedded in catalogs**. Catalog data is untrusted authored JSON, not executable instructions.

### Interaction kinds

**`photo`**: authored options each point to a pre-bundled asset/crop variant, label and consent condition; outputs `photoId,subject,consent,sharedWith`, records a journal entry and optional relation effects. Decline to shoot is always an available option where it matters. No real camera permission.

**`keepsake`**: authored mutually exclusive items, origin, associated person and meaning; records one chosen item per event. Showing/gifting is a later separate authored action, not an inventory purchase. All item references must resolve.

**`message`**: finite, explicitly allowed combinations of `recipient`, `intent`, `tone`, optional `attachmentId` (from already discovered album/keepsakes). Catalog has complete authored RU/EN `previewText`, `replyText`, semantic effects and follow-up tags for every reachable allowed tuple; compiler/validator detects missing combinations and incompatible labels. Choice flow: select meaning → tone → optional attachment → preview → send or cancel. No player-editable text and no language inference. Inaccessible attachments are omitted, not offered as broken options.

**`relation` / `memory`** are supporting data, not new microgames. Effects use whitelisted operations: bounded relation delta, boolean flag set, append unique memory/album/item ID, route-intent tag and exclusive route-lock. Never use arbitrary JS expressions or mutate state in render functions. `echo` beats declare `sourceEventId` and optional predicate on whitelisted state values; the author must supply visible RU/EN text for payoff. Echoes are marked completed once actually surfaced, not merely when a source interaction happens. Graph compilation validates target/source IDs and coarse start-to-ending reachability, while scenario tests cover conditional paths; static checks cannot prove every state combination is playable.

**Predicates and transitions:** Predicate DSL has only `all`, `any`, `not`, `flag`, `memory`, `routeIntent`, `routeLock`, and bounded `relation` comparisons. No JavaScript predicates, expressions or code evaluation. Choices always have explicit destinations; blocked alternatives cannot be selected by crafted action strings. A beat can deterministically `next` within its scene; a terminal beat must transition to another scene or declare an ending. Each scene must be reachable ignoring predicates; conditional reachability and content coherence require bounded simulation tests. No global game-side scene controller is required for new titles.

### Runtime state and backward behavior

Store game-specific data in `CoreSnapshot.state.narrative` (not inside Core definition metadata). `completedEvents` keys combine interaction ID and explicit sequence/occurrence; repeat clicks and duplicated events are no-ops. A caller can keep a bounded session-local pre-action state stack for Back; undo restores all relation, album, message and memory fields atomically. Save/restore is performed through Runtime storage, with game-owned version migration before passing `initialState`. No implicit importing legacy Kiss/CEOS saves. Failed validation must not erase user data; keep original copy and surface a bounded error.

## Player-facing behavior

1. Within a few minutes of starting a test story, one choice provokes visible character feedback.
2. A photo interaction offers meaningful frames and explicit decline; selected art becomes a persistent album item and can attach to a later message.
3. A keepsake action offers 2–3 meaningful items with a later callback, without demanding that the player collect all items.
4. The message composer shows a natural-language preview and an authored reply affected by previous choices; every allowed combination is valid and coherent. Response text is preauthored offline and must not be marketed as AI generation.
5. Journal shows relationship facts and memories in plain language without revealing undiscovered plot, raw score deltas or future routes.
6. Back, replay, reload, focus/pause, localization, and resize work; no interaction repeats rewards or loses an attachment.

Game-specific editors decide emotional story stakes and the content of alternatives, but all *mechanical* contracts must enforce observable echo coverage. Technical tests cannot replace blind player testing of emotional impact.

## Implementation slices / release gates

### N1 — Full pure narrative engine

New `packages/narrative` package, canonical graph validator, scene/choice/ending interpreter, conditions and route locks, pure interaction reducer, delayed echo triggers, journal projection, tests, sample graph and catalog. Pass package tests, `npm test`, `npm run check`, `node examples/core-session.mjs`. Negative tests: unreachable graph/invalid transitions, invalid combinations and localization, duplicate IDs, malformed snapshots, double dispatch, unsafe predicate, missing echo sources/targets and lock bypass. No browser UI and no Studio changes at this gate.

### N2 — Runtime DOM adapter

New `packages/runtime-narrative` module with accessible, mobile-responsive scene dialogue, choices, three interaction views, journal and ending states; Runtime host renderer/input integration. Real automated browser smoke for choice→transition→echo→ending→save→restore→undo, portrait/wide, no network, pause/audio; screenshots and error logs. Missing Playwright/browser/device evidence remains BLOCKED, never relabeled PASS. No platform publishing.

### N3 — Studio profile/template

New opt-in `narrative-interactive` template + updated catalog profile + local bundle build and test. Preview is read-only; apply only to empty projects and rechecks collisions/hashes; existing `narrative-basic` unaffected. Generated demo demonstrates branching scenes, photo→keepsake→message→delayed echo→journal→route lock→ending with RU/EN and offline runtime. Test creation, no-network behavior, scenario reachability, game state, schema errors and template asset integrity. Package lock/workspace/exports updated without adding unnecessary runtime dependencies.

After N3, integration into the **existing** «Поцелуй на краю света» is a separate opt-in adoption with owner-approved source HEAD, backup of old saves and editorial rewriting of EP1–EP10. The three open story questions (legacy saves, exact endings, age positioning) remain with that adoption; they do not block reusable mechanics.

No N1/N2/N3 PASS permits a claim of host SDK completion, physical-device certification, platform publication readiness or moderation success. PR reviews and independent CI are required before merging.

## Risks and future work

- Combinatorial message content grows quickly. Keep the initial demo to a bounded number of explicitly authored allowed tuples and require compiler coverage; do not add a generic text generator.
- Multiple sources of truth could desync relation state. Store all durable game facts under one Core state subtree and derive UI only from that snapshot.
- Existing Runtime host input is keyboard/pointer/touch with string actions; adapter must encode/validate the chosen finite action rather than smuggle arbitrary JSON or HTML into action names.
- Offline bundle size and art license provenance are game-level release considerations; core package has no image assets or licensing authority.
- Authoring echo completeness is a minimum check, not a guarantee that players perceive consequences.

## Decisions left to implementer

Exact file split, CSS presentation, sample characters/story, bounded limits for demo relation ranges and maximum message combinations, and unit assertion wording may be chosen by implementer within this spec. No project-specific character names or world facts may enter package implementation.
