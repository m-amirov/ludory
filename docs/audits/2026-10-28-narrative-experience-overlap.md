# S4-N2 — reader experience and romance skill overlap audit

**Status: READ-ONLY SOURCE AUDIT; RECOMMENDATION PROPOSED, NOT OWNER-APPROVED (2026-10-28).** No new skill is installed by this audit. CEOS and Starter Kit remain frozen, read-only references; no existing or new user game was inspected, contacted, edited or submitted.

## Pinned sources

- Ludory [`main` after PR #29](https://github.com/m-amirov/ludory/commit/46895aa29e070f551871ebd49524737d44dafdee), merge `46895aa29e070f551871ebd49524737d44dafdee`: **12 first-party `.agents/skills/` entrypoints**, including [`ludory-narrative-review`](../../.agents/skills/ludory-narrative-review/SKILL.md) and [`ludory-narrative-continuity`](../../.agents/skills/ludory-narrative-continuity/SKILL.md). Relevant code: `packages/ai/src/narrative-review.mjs`, `packages/ai/src/narrative-review-contract.mjs`, `packages/studio/catalog/templates/narrative-basic/src/main.js`.
- CEOS pinned `c8cc13bd3852409be93097ee823e9cd35e512b73`: [`reader-experience-review`](https://github.com/m-amirov/codex-engineering-system/blob/c8cc13bd3852409be93097ee823e9cd35e512b73/skills/reader-experience-review/SKILL.md), Git blob `3d452aad58000a75697babdb9876212d1751dca8`; [`romance-narrative`](https://github.com/m-amirov/codex-engineering-system/blob/c8cc13bd3852409be93097ee823e9cd35e512b73/skills/romance-narrative/SKILL.md), blob `e2d81731242874c453591f30c03638d308359f23`. These two complete upstream instructions were inspected, not executed or copied.
- Starter Kit pinned `7595fefe4e125c37c57a830d9bce60deda083489`: the [S0 skill inventory](2026-10-28-skills-gap.md) identifies **no distinct** cold-reader/romance entrypoint among its 15 skills. The `narrative-game` profile is not a cold reader, a certified narrative benchmark or an installed Ludory runtime.

## Actual Ludory coverage

| Need from upstream | Current first-party owner | Missing evidence or risk of duplication |
| --- | --- | --- |
| Editorial assessment of supplied prose, dialogue, character motivation, pacing, romance arcs, meaningful choices | `ludory-narrative-review` and its source/hash-bound independent Web DEV `episode-script` contract | This reviewer receives a brief and contextual material. An editorial `ACCEPT` is **not** an unprimed human cold read or gameplay test. Pending/blocked Web calls must not be repeated. |
| Route-conditioned knowledge, chronology, flags, promises, state and implemented Back/save | `ludory-narrative-continuity` (merged PR #29) | Its bounded current-source replay proves **source state** for named routes, not what a reader comprehends, real browser path or emotional impact. |
| First-pass understanding and perceived setup/payoff after receiving only player-visible text | **No native cold-reader receipt/protocol** | An author, parent Codex or reviewer primed with story bible cannot honestly self-certify as a blind reader. Real independent first-pass impressions require an authorized external participant or separately verified isolated route. |
| Romance-first concept, agency, boundaries, differentiated relationship dynamics, genre-specific polish | Existing `ludory-narrative-review` includes `romance` finding category and genre protection; owner-approved canon/brief decides genre | A new broad `ludory-romance-narrative` would duplicate author/review triggers and could impose romance on unrelated games. CEOS implementation also references retired context commands and companion skills. |
| Reader-perceived route differentiation in real play or delivered reading sequence | Narrative-review may critique draft text; continuity binds source state only | Requires source-identified *reachable* player-visible paths and an actual read/play record. Draft scene lists, solver output and browser-less mocks cannot establish reader experience. |

The current `narrative-basic` template is a three-scene clicking demo, not a production cold-read delivery or comprehensive route system. `packages/ai/src/narrative-review.mjs` asks the Web reviewer to read the supplied **draft and brief**, with continuity/romance categories: that is contextual editorial review by design. Its source-bound `ACCEPT`/`REWORK`/`BLOCKED` JSON should not be repurposed as a blind-first-impression result.

## Options and recommendation

1. **Copy CEOS reader and romance skills as two entrypoints:** not recommended. Creates a duplicate `romance` trigger, imports discontinued CEOS session/CLI instructions and risks reporting an AI review as a human cold read.
2. **Fold all of N2 into `ludory-narrative-review`:** fewer entrypoints, but combines canon-aware editorial feedback with a deliberately **canon-blind first read**. Uncontrolled exposure to the brief would contaminate the claimed blind result.
3. **Recommended for owner decision:** propose one **optional `ludory-reader-experience`** entrypoint for prepared source-bound cold-read packets and analysis of **actual independent first-pass evidence**. Preserve the current `ludory-narrative-review` and `ludory-narrative-continuity` contracts. Fold romance-first editorial guidance into existing narrative-review references **only on a later separately approved, narrow change**; no new standalone romance entrypoint now.

This is a **recommendation, not approval**. The proposed [N2 contract](../superpowers/specs/2026-10-28-reader-experience-skill-design.md) specifies a read-only default, evidence labels, privacy and negative tests. It authorizes neither an external reviewer invitation nor the skill implementation.

## Non-negotiable evidence distinctions

- **Cold-read packet prepared:** exact game/draft revision, locale, route/choice history and player-visible text digest. A packet is not a completed reader observation.
- **Independent first-pass evidence received:** identifiable provenance/authorization, reviewer exposure boundaries, questions and first-pass answers recorded **before** showing canon or author explanations. Reader comprehension risks remain editorial findings, not source-state or universal enjoyment scores.
- **Contaminated or missing reader:** label `NOT_RUN` or `EVIDENCE_GAP`; an AI model already shown the brief/author outline cannot be relabeled “blind”. Never fabricate a human, run an unverified Web helper, contact a third party or repeat a paid review automatically.
- **Observed play:** needs current build, browser/device and route identity in addition to any reader report. No user or Runtime/gameplay acceptance and no Release PASS were obtained by this audit.
- **Romance as genre choice:** protect agency, consent, boundaries, intentional ambiguity and non-linear arcs; no required love-interest counts, romance percentages, cliffhangers, emotional-score thresholds or automatic all-branch rewrites.

## Next gate

Owner reviews and approves/rejects the single proposed `ludory-reader-experience` contract after PR CI/review. Only then may a separate implementation PR add a repo-native skill and positive/negative synthetic fixtures. Human/isolated cold-read E2E remains `NOT_RUN` until independently observed; S3 live gameplay evidence depends on Runtime progress. Frozen old games and upstream source skills remain untouched.
