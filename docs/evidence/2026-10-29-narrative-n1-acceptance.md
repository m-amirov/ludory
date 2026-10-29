# Narrative Engine N1 — local verification

**Scope:** `@ludory/narrative`, pure graph-based engine for **new** games. Source branch: `feat/narrative-interactions-design`; integration target `main`. This report describes local results only, not GitHub CI or platform certification.

**Verified repository base:** `2b4bd70ed64b0e9b35fc206056d04fb585e43ecf`. All files in this N1 change are committed together on the feature branch after verification; exact candidate HEAD is the PR commit, not this base SHA.

| Command | Observed result | Notes |
| --- | --- | --- |
| `node packages/narrative/test/engine.test.mjs` | PASS, 11/11 | Both paths, message attachment, echo, route lock, dead-end graph, hostile catalog, revisits, state provenance and echo order |
| `node packages/narrative/test/conditions-and-interop.test.mjs` | PASS, 4/4 | Conditional authored replies, Core snapshot restore, unsafe predicates, earned journal |
| `npm test` | Exit 0 | Final rerun after review fixes: 516 tests, 514 PASS, 0 FAIL, 2 existing SKIP; integration quality checks 17/17 PASS |
| `npm run check` | Exit 0 | All configured Node syntax checks and Studio help |
| `node examples/core-session.mjs` | Exit 0 | Original Core session still runs and restores |
| `git diff --check` | Exit 0 | No whitespace errors |

## N1 contracts covered

- Pure ESM graph/catalog validation, two-locale data, finite options and state predicates.
- Scene transitions, route intent/locks, choice availability, endings and coarse all-scenes-to-ending graph reachability.
- Photo choice/album, keepsake, context-filtered finite message variants and localized authored replies; deterministic effects.
- Delayed echo beat only after source event/condition; unique completed events and completed echo IDs; explicit `validateNarrativeEchoCoverage` strict authoring gate.
- Structural and provenance checks replay the canonical bounded action log to reject changed route locks, unearned state and forged scene jumps; completed one-shot interactions are skipped on cyclic visits.
- JSON-only state, immutable reducer transitions, malformed state rejection, Core snapshot interoperability.
- No changes to `@ludory/core` or generic Runtime behavior, no external network/runtime APIs, no existing game writes.

## Not passed / deliberately out of scope

- **N2 Runtime UI:** NOT IMPLEMENTED / NOT TESTED. No desktop/mobile browser, keyboard, sound or responsive-evidence claim.
- **N3 Studio template:** NOT IMPLEMENTED / NOT TESTED. No ready-to-use game scaffold yet.
- **Conditional narrative coverage:** Static graph validation deliberately checks structural reachability and path to an ending **ignoring predicates**; authored scenario tests are still needed for route-conditional reachability/quality. An arbitrary author can create a logically impossible condition; static compile does not imply semantic completion.
- **Save trust model:** Action-log replay detects inconsistent snapshots; without a server/secret no offline format can prevent an adversary from rewriting both data and its log. N1 does not implement anti-cheat, privacy encryption or cloud saves.
- **Asset/content/rights:** IDs are catalog data; no art files/license validation in N1. N3 must verify asset existence and provenance.
- **Rollback:** N1 has no persistent Back history; N2 must hold/restore whole Core snapshots.
- **Platforms:** VK/Yandex SDK, deployment, moderation, physical devices, accessibility and release gates remain separate and unverified.

**Gate:** N1 package can be reviewed independently for integration; no claim that the entire Narrative Engine gameplay stack is finished until N2/N3 are verified.

## Independent review and correction pass

Read-only independent review of N1 at commit `3e12aa2` confirmed three Important defects and no Critical defects. One targeted TDD correction pass fixed all three:

1. Completed interaction loop → skip once-per-run beat on revisit while preserving single reward. Regression: `revisiting a completed interaction automatically skips it without duplicating rewards` (RED then GREEN).
2. Earned memory/route/ending forgery → bounded canonical `actionLog` and deterministic replay validation. Regression: `saved state cannot claim earned memory, switch a route or jump to a future ending` (RED then GREEN).
3. Impossible early echo → reject source-after-echo order within scene and source scene with no path to callback; expose `validateNarrativeEchoCoverage(graph)` strict authoring gate for N3. Regression: `echo cannot precede its source within a single scene` (RED then GREEN).

Full `npm test` rerun after the correction pass had exit 0 (514 PASS / 2 SKIP); `npm run check`, `node examples/core-session.mjs`, and `git diff --check` all exited 0. No independent second review was claimed for the new diff; RED→GREEN regressions and full-suite rerun are the correction evidence.
