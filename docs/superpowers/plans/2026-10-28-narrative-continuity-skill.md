# S4-N1: implement the narrative-continuity skill

**Scope:** The owner-approved [S4-N1 contract](../specs/2026-10-28-narrative-continuity-skill-design.md). New first-party repo-native optional skill only; no edits to Core, Studio workflow, Runtime, frozen games, or `ludory-narrative-review`.

**Integration:** Dedicated `codex/narrative-continuity-n1-implementation` branch and Draft PR; no automatic merge.

## Task 1 — Failing proof regressions (RED)

- [x] Create a disposable new Studio-game fixture whose loaded entrypoint imports a game-owned guarded narrative transition; preserve source/canon byte identity.
- [x] Verify a valid fact-first route, a reachable skipped-fact contradiction and an intentional withheld-fact route by direct source replay.
- [x] Include a decoy independent model and a zero-exit check to demonstrate that a successful command is not actual-game proof.
- [x] Add structural skill-contract tests: narrow activation and provenance, source binding and exhaustive-only claims, truthful statuses, separation from editorial Web review and repair.
- [x] Run focused RED and record the expected missing-skill failure.

## Task 2 — Narrative skill (GREEN)

- [x] Add `.agents/skills/ludory-narrative-continuity/SKILL.md` with discoverable frontmatter, read-only scope and current-entrypoint/transition trace protocol.
- [x] Require authoritative replay and canon-backed semantic findings; distinguish declarative-only scope, sample coverage and runtime/device/Back gaps.
- [x] Require complete finite-state traversal or independent invariant for global impossibility; reject fake-green, shared wrong models and no-op tests.
- [x] Add concrete synthetic example and a compact evidence-led output format with handoff gates.
- [x] Run focused regression and skill pressure tests, refine if needed.

## Task 3 — Verification and delivery

- [x] Run `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`; capture exact outcomes.
- [x] Get independent code review and address any actionable feedback (UI-reachable action wiring, source SHA-256, pressure reproducer).
- [ ] Publish a **Draft** implementation PR against the exact base. Check GitHub CI on its head SHA. Request separate owner decision for merge.
