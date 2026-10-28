# Skills & Failure Prevention — delivery roadmap

**Status (2026-10-28, `main` after merged [PR #31](https://github.com/m-amirov/ludory/pull/31), `b56b096463ea0d1fe9489ea358a31ef67f14a978`):** S0 [#18](https://github.com/m-amirov/ludory/pull/18), S1 [#19](https://github.com/m-amirov/ludory/pull/19), S2 [#20](https://github.com/m-amirov/ludory/pull/20)/[#21](https://github.com/m-amirov/ludory/pull/21), UI [#22](https://github.com/m-amirov/ludory/pull/22), incident [#23](https://github.com/m-amirov/ludory/pull/23)/[#24](https://github.com/m-amirov/ludory/pull/24), level design [#25](https://github.com/m-amirov/ludory/pull/25)/[#26](https://github.com/m-amirov/ludory/pull/26), reconciliation [#27](https://github.com/m-amirov/ludory/pull/27), narrative continuity [#28](https://github.com/m-amirov/ludory/pull/28)/[#29](https://github.com/m-amirov/ludory/pull/29) and reader experience [#30](https://github.com/m-amirov/ludory/pull/30)/[#31](https://github.com/m-amirov/ludory/pull/31) are merged. `main` now has **13 first-party skill entrypoints**. This is migration of selected instruction contracts, **not** 30/30 functional parity or runtime/platform acceptance. [S3 readiness audit](../audits/2026-10-28-s3-runtime-readiness.md) is read-only; no new S3 skill has been approved.

## Operating contract

- Skills live in one Ludory-owned root, `.agents/skills/<name>/SKILL.md`, and are opt-in based on the task/profile; do not create a competing `.codex/skills` root or install global CEOS hooks.
- Ludory Core stays renderer/SDK/browser-neutral; Studio/AI own task workflows, Runtime owns host behavior, Connect owns platform SDK adapters, Release owns publication gates.
- An instruction file guides Codex; executable assertions, browser pixels, artifacts and provenance must support any PASS. Missing/stale/blocked external tool evidence remains `BLOCKED` or `EXECUTED_UNVERIFIED` as appropriate.
- Work only on new Ludory-owned Studio games. CEOS/Starter Kit are read-only references, historical runs are not imported, and all mature games remain frozen.
- Quality/Visual/Runtime/Release acceptance are independent. Developer test success never implies visual, rights, live platform or release PASS. No skill may publish, submit, force-update refs or change source outside authorized scope.
- Reconcile existing Ludory skills first: preserve `ludory-engineering-quality` and `ludory-narrative-review` without overwriting their established contracts.

## Reconciliation with the 30 pinned CEOS/Starter Kit skills

The [S0 gap audit](../audits/2026-10-28-skills-gap.md) is a **historical pinned-commit inventory** (15 CEOS + 15 Starter Kit), not a current-count report; preserve its original snapshot. Current Ludory names below represent *intent and ownership*, not a claim that original implementations or their real E2E coverage were reproduced.

| Disposition of the 30 source entrypoints | Count | What happened / where it belongs |
| --- | ---: | --- |
| Original Ludory skill implemented for a source analogue | **10** | CEOS `audit` → `ludory-audit`, `fix` → `ludory-fix`, `incident-analysis` → `ludory-incident-analysis`, `narrative-continuity-engine` → `ludory-narrative-continuity`, `reader-experience-review` → `ludory-reader-experience`, `production-art` → `ludory-production-art`, `verification` → `ludory-verification`, `visual-qa` → `ludory-visual-qa`; Starter Kit `asset-provenance-and-rights` → `ludory-asset-rights`, `level-design-quality` → `ludory-level-design` |
| Folded into an existing skill/native workflow, without duplicate entrypoint | **3** | CEOS `audit-repair-loop`; Starter Kit `implementation-cycle`, `visual-quality-gate` |
| Native product workflow rather than a new skill | **1** | CEOS `ceos-continue` → Studio/AI continuation; no CEOS session/CLI compatibility promise |
| Read-only reference; deliberately not installed | **2** | Starter Kit `codex-engineering-system`, `project-termination` |
| Still deferred or contingent on product/genre prerequisites | **14** | CEOS: dialogue editing, romance, prod check, release, video (**5**). Starter Kit: accessibility, audio, feel, performance, mobile UX, product review, release audit, web playtest, Yandex release validation (**9**). Runtime-backed S3 work remains blocked pending real game/browser evidence. |

The other **3** Ludory entrypoints are `ludory-engineering-quality` and `ludory-narrative-review` (existing native skills) and `ludory-ui-design` (Ludory-specific UI craft, PR #22). Thus **10 source analogues + 3 native/Ludory-specific = 13** current skills. Folded/native/reference/deferred dispositions must **not** be counted as installed skills. The exact per-source reasoning and pinned SHAs remain in S0; no copies of old `SKILL.md` are required.

## PR sequence and dependencies

| PR lane | Delivery state | Scope | Remaining acceptance boundary |
| --- | --- | --- | --- |
| **S0 — source gap audit** | **MERGED #18** | All 30 upstream skills pinned and classified | Historical inventory, not feature parity |
| **S1 — engineering workflows** | **MERGED #19** | `ludory-audit`, `ludory-verification`, `ludory-fix` | Independent evidence required for each actual task; bounded executor alone is unverified |
| **S2 — visual/art/rights** | **MERGED #20–#21** | `ludory-production-art`, `ludory-visual-qa`, `ludory-asset-rights` | Skill text/tests do not prove real image receipt, actual pixels, rights clearance or Web DEV availability |
| **S2.5 — UI craft** | **MERGED #22** | `ludory-ui-design`: type, layout, art direction, responsive states | Design review is separate from real-runtime pixel/interaction QA |
| **I1 — incident analysis** | **MERGED #23–#24** | `ludory-incident-analysis`: read-only timeline, correlation, uncertainty | No automatic recovery or incident-resolution PASS |
| **L1 — level design** | **MERGED #25–#26** | Optional `ludory-level-design`: bounded source rules, witness replay, exhaustive or invariant-based impossibility checks | Verified source fixture only; no general solver, live game/playability or Runtime equivalence claim |
| **S4-N1 — optional narrative continuity** | **MERGED #28–#29** | Optional source-first `ludory-narrative-continuity`; preserves `ludory-narrative-review` for prose/editorial Web review; [bounded pressure trials](../audits/2026-10-28-narrative-continuity-skill-trials.md), independent review and Windows/Ubuntu Node 22/24 CI on the implementation commit | New *opt-in* narrative Studio game, real imported state rules and canon; source-only fixture coverage is not Runtime/player or whole-game PASS |
| **S3 — runtime/player quality** | **READINESS AUDITED; SKILLS BLOCKED BY PRODUCT EVIDENCE** | [S3 prerequisite audit](../audits/2026-10-28-s3-runtime-readiness.md): proposed first `ludory-mobile-ux` only after native R2/R3/R6 and a real local browser build; accessibility, web playtest, audio, performance, game feel and product review each need separate observable proof | Runtime [#16](https://github.com/m-amirov/ludory/pull/16) and [#17](https://github.com/m-amirov/ludory/pull/17) remain stacked Draft PRs, not on `main`. R2–R6 and current browser/device evidence not implemented; no S3 skill PASS |
| **S4-N2 — experiential/genre review** | **MERGED #30–#31** | [Overlap audit](../audits/2026-10-28-narrative-experience-overlap.md), [contract](../superpowers/specs/2026-10-28-reader-experience-skill-design.md) and opt-in `ludory-reader-experience`: reproducible unprimed first-read packet, private provenance and truthful absence of real reader notes | 8/8 focused synthetic skill tests, full CI; **no actual unprimed human reader** observed, no duplicate Web review or Runtime delivery proof |
| **S5 — release/media** | **BLOCKED BY CONNECT + RELEASE** | Release audit, Yandex/VK target gates, optional gameplay video/live inspection | Target-specific SDK/build/ZIP/platform evidence and explicit owner publication authorization |

The skill work merged through N2 is **instruction/fixture delivery**, not an all-green quality pipeline or completed reader session. Runtime R1 remains a separate contract-layer Draft PR, **not on `main`**, not a runtime host or browser game; S3 and S5 must not issue acceptance before their product prerequisites exist. Do not recreate `project-termination`, `codex-engineering-system` or legacy CEOS continuation as Ludory skill entrypoints without a new scoped justification.

## Next decision gates (recommended order)

1. **S3 product-first, current — Runtime integration decision.** Review the separately stacked Draft [#16](https://github.com/m-amirov/ludory/pull/16) design and [#17](https://github.com/m-amirov/ludory/pull/17) R1 layer; their historical CI 4/4 does not prove current `main` integration. Obtain explicit owner approval, reconcile bases and rerun CI before integration. R2 host work is a further separate authorization.
2. **S3 after R2–R6 — one evidence-backed player-quality skill first.** Start with actual new Studio game host/browser lifecycle, input/viewport and local bundle evidence; [audit proposes](../audits/2026-10-28-s3-runtime-readiness.md) `ludory-mobile-ux` as the first narrow opt-in contract when observations exist. Audio, accessibility, performance and game-feel follow their own measured paths; do not batch seven instruction-only PASS claims.
3. **S5 after Connect/Release — independent platform gates.** Build separate Yandex and VK scopes, with explicit target, package and publication authority. Release-audit instructions cannot grant Release PASS or submission permission.

Each future skill needs a separate contract, positive/negative evidence, CI/review and owner integration decision. Existing projects and both source repositories stay frozen/read-only throughout.

## Implementation requirements for each new skill

1. Define a narrow activation description and an explicit scope/authorization boundary. The skill must name its actual product prerequisites and not pretend an unavailable tool is present.
2. Describe exact inputs and repository-native commands; do not call `ceos`, touch `.codex-os`, install a global hook or assume old worktree/session ownership.
3. Define evidence identity (source SHA-256, relevant commit/build, input artifacts, viewport/state when visual), separated `PASS`/`FAIL`/`BLOCKED` and outstanding evidence gaps.
4. Supply a positive fixture and at least one negative or blocked fixture for every new acceptance claim; where applicable prove regression against the corresponding historical failure. Test skill frontmatter, active path, outdated command references and overlap with existing triggers.
5. Exercise the workflow in an isolated **new** Studio fixture/game; keep side effects in the authorized scope. For externally blocked routes, verify the honest blocked outcome rather than calling it PASS.
6. Use branch/PR review, run relevant `npm test`, `npm run check`, `node examples/core-session.mjs`, inspect `git diff --check` and CI. An unchanged repo test suite alone does not prove new skill efficacy.

## Recorded S1 decisions (implemented on `main`)

- `ludory-audit`: default read-only, classify product/test/infra/evidence findings by severity, return sources and remediation suggestions without changing code.
- `ludory-verification`: map each user acceptance claim to an executable check, distinguish scoped functional verdict from browser/visual/platform gates, report a single scoped overall verdict.
- `ludory-fix`: require a reproduced issue or explicit behavior test, minimal root-cause patch, RED/GREEN evidence, targeted regression, preserve unrelated dirty/unversioned files. Native AI cycle is an optional bounded mechanism, not proof of independent acceptance.

**S1 decision:** [contracts approved](../superpowers/specs/2026-10-28-s1-native-skills-design.md) and the three skills merged with tests.

**S2 decision:** [contracts approved](../superpowers/specs/2026-10-28-s2-native-skills-design.md); S2 implementation merged in PR #21 after CI and review. This establishes instructions and structural tests, **not** real-art, live-pixel, rights-clearance or Release PASS. The [UI-design craft contract](../superpowers/specs/2026-10-28-ui-design-craft-skill.md) was separately approved and merged in PR #22; it is not runtime visual acceptance.

**I1 decision:** [incident-analysis contract](../superpowers/specs/2026-10-28-incident-analysis-skill-design.md) approved in PR #23; skill implementation and [bounded pressure trials](../audits/2026-10-28-incident-analysis-skill-trials.md) merged in PR #24. It remains read-only and establishes neither incident recovery nor Runtime, Quality or Release PASS.

**L1 decision:** [level-design contract](../superpowers/specs/2026-10-28-level-design-skill-design.md) approved and merged in PR #25; the original, source-bound `ludory-level-design` skill was independently reviewed and merged in [PR #26](https://github.com/m-amirov/ludory/pull/26). Its Windows/Ubuntu Node 22/24 CI was green for that PR's exact head SHA. This **does not** add a general solver, runtime/browser playtest, universal difficulty measure, or Release PASS.

**N1 decision:** [contract](../superpowers/specs/2026-10-28-narrative-continuity-skill-design.md) approved and merged in [PR #28](https://github.com/m-amirov/ludory/pull/28); skill implementation, [plan](../superpowers/plans/2026-10-28-narrative-continuity-skill.md) and [pressure evidence](../audits/2026-10-28-narrative-continuity-skill-trials.md) merged in [PR #29](https://github.com/m-amirov/ludory/pull/29), with green four-way Windows/Ubuntu Node 22/24 CI. The source-only tests do not establish gameplay/browser or Release PASS.

**N2 decision:** [contract](../superpowers/specs/2026-10-28-reader-experience-skill-design.md) approved and merged in [PR #30](https://github.com/m-amirov/ludory/pull/30); owner separately authorized implementation and then explicitly approved merging [PR #31](https://github.com/m-amirov/ludory/pull/31), merged at `b56b096463ea0d1fe9489ea358a31ef67f14a978`. Repo-native skill, synthetic protocol tests and [bounded pressure trials](../audits/2026-10-28-reader-experience-skill-trials.md) are now present in `main` but are **not** real human-reader evidence.

**S3 readiness finding:** [audit](../audits/2026-10-28-s3-runtime-readiness.md) confirms no `packages/runtime` on `main`; Runtime #16/#17 remain Draft and stacked on an older foundation. The next owner decision concerns integrating those existing Runtime contracts with fresh current-main review/CI and authorizing R2 later, **not installing seven unsupported S3 skills**. Romance-specific guidance stays under existing narrative review; S5 waits for Connect/Release.
