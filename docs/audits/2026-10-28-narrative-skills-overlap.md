# Ludory S4-N1 — narrative skill overlap audit (2026-10-28)

**Status: SOURCE AUDIT / CONTRACT PROPOSAL ONLY.** No skill has been created, approved, installed or run on a real game as part of N1. No historical game or source repository was modified.

## Pinned scope

- Ludory `main`: after [PR #27](https://github.com/m-amirov/ludory/pull/27), merge `ce90284ef78c02872d11761537ef4dd7bfc6aa67`. Existing entrypoint: [`.agents/skills/ludory-narrative-review/SKILL.md`](../../.agents/skills/ludory-narrative-review/SKILL.md), plus `packages/ai/src/narrative-review.mjs`, `packages/ai/src/narrative-review-contract.mjs`, the native narrative review tests and Studio's `narrative-basic` template.
- CEOS **read-only reference**: commit [`c8cc13bd3852409be93097ee823e9cd35e512b73`](https://github.com/m-amirov/codex-engineering-system/tree/c8cc13bd3852409be93097ee823e9cd35e512b73); inspected [`narrative-dialogue-editor`](https://github.com/m-amirov/codex-engineering-system/blob/c8cc13bd3852409be93097ee823e9cd35e512b73/skills/narrative-dialogue-editor/SKILL.md), [`narrative-continuity-engine`](https://github.com/m-amirov/codex-engineering-system/blob/c8cc13bd3852409be93097ee823e9cd35e512b73/skills/narrative-continuity-engine/SKILL.md), `reader-experience-review` and `romance-narrative`.
- Starter Kit **read-only reference**: source skills inventory at [`7595fefe4e125c37c57a830d9bce60deda083489`](https://github.com/m-amirov/starter-kit-yandex-games/tree/7595fefe4e125c37c57a830d9bce60deda083489) in the [S0 gap audit](2026-10-28-skills-gap.md). Its optional narrative profile/validators are **not** an installed Ludory runtime or graph tool.

These are source/document inspections. This audit did **not** execute the Web DEV reviewer, traverse a production game's story graph, inspect real save/Back behavior, test devices or assert full narrative quality.

## What is already owned by Ludory

1. **Editorial narrative review already exists.** `ludory-narrative-review` activates for episode scripts, authored or revised interactive stories, romance routes and narrative reports. It already covers characterization, dialogue, causality, meaningful choices, romance, continuity and StoryScope-inspired qualitative risks. It requires exact draft excerpts for P0/P1 and forbids genre/style quotas and unsolicited source overwrites.
2. **Native AI reviews a bounded draft, not a whole executable game.** `planNarrativeReview` obtains an `episode-script` draft, brief and optional sources; it demands a verified Web DEV route, creates hash-bound `NARRATIVE_REVIEW_REQUESTED`/`NARRATIVE_REVIEW_RESULT` evidence and preserves explicit pending recovery. `parseNarrativeVerdict` validates JSON fields, categories and quoted excerpts. Neither module computes reachable game states or establishes save/Back invariants; a reviewer accepting draft text cannot prove those properties.
3. **The current template does not supply a general stateful graph engine.** `packages/studio/catalog/templates/narrative-basic/src/main.js` defines three text scenes with clickable destinations. It contains no route flags, inventory, knowledge provenance, persistent state or Back contract. The optional `narrative-game` Studio profile selects a template, **not** Starter Kit's narrative validation tool or a Runtime browser acceptance gate.
4. **Web availability is not presumed.** The earlier foundation audit found a missing verified Web route; this contract-only audit did not repeat a live host check. A missing reviewer leaves independent draft review blocked, but must not be silently converted into a source graph PASS or a second review attempt.

## Overlap and gaps

| CEOS responsibility | Already covered in Ludory | Actual gap / recommended disposition |
| --- | --- | --- |
| `narrative-dialogue-editor`: character voice, subtext, speaker attribution, cadence, RU/EN intent, narrow line edits | Narrative review already checks `dialogue`, `character`, `pacing` and `romance`; its trigger includes author/revise | **MERGE into existing entrypoint later if needed.** A focused editorial reference could explain line-edit output and author approvals, but a second broadly triggered dialogue skill would collide with `ludory-narrative-review`. No such change in N1. |
| `narrative-continuity-engine`: branch-conditioned time/place, knowledge, flags, promise payoff, one-shot actions, save/Back | Review asks qualitative continuity questions about supplied draft and brief | **Candidate separate optional skill.** Real route/state reachability, exhaustive-bound semantics and source-owned transition evidence are distinct from Web editorial ACCEPT. Source-only checks possible when a new game actually contains relevant code; Runtime parity remains blocked. |
| `reader-experience-review`: blind first reading and comprehension | Narrative reviewer offers editorial critique, not independent blind reader observation | **DEFER N2.** Needs actual cold-reader evidence; do not fabricate a reader or treat Web draft review as playtest. |
| `romance-narrative`: romance-first concept and relationship arcs | Existing narrative review includes romance and genre protection | **DEFER N2 / opt-in.** No universal romance requirements or automatic full-season rewrites. |

## Considered implementation boundaries

1. **Copy both CEOS editor and continuity files as separate skills:** reject. The editor overlaps Ludory's current trigger and carries CEOS context/workflow assumptions; direct copies would create ambiguous ownership.
2. **Put both into `ludory-narrative-review`:** lower file count, but couples a Web draft verdict (`ACCEPT`/`REWORK`) to unrelated deterministic graph evidence and may imply one is proof of the other.
3. **Recommended contract proposal:** keep dialogue/editorial concerns under `ludory-narrative-review`; propose **one optional read-only `ludory-narrative-continuity`** for a *new, authorized Studio narrative game with an identified game-owned route/state implementation*. Use `ludory-verification` for independent acceptance and `ludory-fix` for separately authorized changes. Preserve the existing narrative review workflow and JSON contract unchanged.

## What can and cannot be accepted today

- **Can check:** exact source/scene hashes, game-owned graph edges and guards, a bounded action/state trace replayed through actual current source transitions, declared story facts with evidenced preconditions, deterministic project tests, and finite-state exhaustiveness **when actually proved**.
- **Cannot infer:** complete-route reachability from an authored scene list, character knowledge from an AI summary, semantic emotional payoff from a graph predicate, Back/save fidelity if absent from the game, runtime/browser playability, authentic blind readers, platform approval or Release PASS.
- **Must block:** graph source missing/ambiguous, frozen-game ownership, model-vs-game mismatch, unlimited state space with capped search, non-executable or stub validators, unpublished/unsupplied canon, and claimed route coverage with untested branches.

## Recommendation / owner gate

Present the [proposed S4-N1 contract](../superpowers/specs/2026-10-28-narrative-continuity-skill-design.md) for a **separate owner decision**. It is intentionally a source-first, opt-in complement, **not** an implementation approval. If the owner prefers one entrypoint, revise the design to add a bounded continuity reference to the existing skill and keep the same separate evidence gates. Only after approval should TDD pressure trials and implementation begin in a new PR.
