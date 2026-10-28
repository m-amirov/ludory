# S4-N2 — implement the optional Ludory reader-experience skill

**Scope:** Owner-authorized implementation following the [S4-N2 contract in merged PR #30](../specs/2026-10-28-reader-experience-skill-design.md), on `main` at `cd023376e1726e26f619673a1fb21d2093fe1837`. One repository-native `ludory-reader-experience` instruction entrypoint with source-bound tests and evidence; no new reader CLI, browser automation, Web DEV duplicate or edits to frozen/real games.

**Delivery:** Separate branch `codex/reader-experience-n2-implementation`, new **Draft PR** targeting `main`. Contract approval and implementation authorization are not approval to merge or publish.

## Task 1 — Baseline and failing tests (RED)

- [x] Baseline two multi-pressure situations before writing the skill: canon-exposed Web DEV `ACCEPT` relabeled as blind/Release PASS; unverified owner-pasted notes with one reader shown two routes and a request for automatic rewrites. Record actual resistance, not invented baseline failures.
- [x] Create tiny disposable new Studio `narrative-game` source fixture with actual entrypoint imports and rendered player text.
- [x] Pin exact canonical UTF-8/LF JSON v1 packet literal and SHA-256; segregate private route ID, flags, author canon and source digests.
- [x] Add mutation scenarios for visible text, history, questions, choices, locale and route; reject stale and mixed route/locale identities.
- [x] Add negative fake human, primed/owner-pasted, synthetic positive-with-provenance and same-reader second-route tests; state synthetic-only scope.
- [x] Observe focused **RED**: 5 `ENOENT` missing-skill failures, 3 fixture/protocol tests passing.

## Task 2 — Skill and guided pressure (GREEN)

- [x] Create `.agents/skills/ludory-reader-experience/SKILL.md` with narrowly discoverable first-pass trigger, read-only authority, ownership boundaries and explicit no-duplicate Web rule.
- [x] Define reproducible reader-only packet, withheld private provenance, hash-bound exposure/consent protocol, blocked evidence precedence, order conditioning, intentional ambiguity and bounded report.
- [x] Observe 8/8 focused tests passing; negative contract mutations reject removal of safeguards.
- [x] Repeat both baseline pressure scenarios with skill loaded; both already resisted in baseline and remained safe with sharper evidence labels. Record this truthfully rather than inventing a behavioral RED failure.

## Task 3 — Verification and handoff

- [x] Update skills roadmap without counting this Draft skill as merged into `main`; preserve pending Runtime/Connect/Release gates.
- [x] Run full `npm test` (377 total: 375 PASS, 2 platform SKIP; Quality integration 17/17), `npm run check`, `node examples/core-session.mjs`, `git diff --check`; rerun after review changes.
- [x] Independent review completed; fixed three substantive issues (draft-only path without entrypoint, browser fixture module mounting, stale source binding) and two optional P2 documentation clarifications. Focused 8/8 and full `npm test` green after remediation.
- [ ] Publish **Draft PR**, prove remote tree parity and inspect exact-head GitHub Ubuntu/Windows Node 22/24 CI; request owner integration decision. Do not merge automatically.
