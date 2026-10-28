# Skills & Failure Prevention — delivery roadmap

**Status (2026-10-28, `main` after [PR #29](https://github.com/m-amirov/ludory/pull/29), merge `46895aa29e070f551871ebd49524737d44dafdee`):** S0 [#18](https://github.com/m-amirov/ludory/pull/18), S1 [#19](https://github.com/m-amirov/ludory/pull/19), S2 contracts [#20](https://github.com/m-amirov/ludory/pull/20) and skills [#21](https://github.com/m-amirov/ludory/pull/21), UI [#22](https://github.com/m-amirov/ludory/pull/22), incident contract/skill [#23](https://github.com/m-amirov/ludory/pull/23)–[#24](https://github.com/m-amirov/ludory/pull/24), level-design contract/skill [#25](https://github.com/m-amirov/ludory/pull/25)–[#26](https://github.com/m-amirov/ludory/pull/26), reconciliation [#27](https://github.com/m-amirov/ludory/pull/27), and S4-N1 contract/skill [#28](https://github.com/m-amirov/ludory/pull/28)–[#29](https://github.com/m-amirov/ludory/pull/29) are **merged**. `main` has **12 first-party skill entrypoints**. This is migration of selected instruction contracts, **not** 30/30 functional parity or runtime/platform acceptance.

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
| Original Ludory skill implemented for a source analogue | **9** | CEOS `audit` → `ludory-audit`, `fix` → `ludory-fix`, `incident-analysis` → `ludory-incident-analysis`, `narrative-continuity-engine` → `ludory-narrative-continuity`, `production-art` → `ludory-production-art`, `verification` → `ludory-verification`, `visual-qa` → `ludory-visual-qa`; Starter Kit `asset-provenance-and-rights` → `ludory-asset-rights`, `level-design-quality` → `ludory-level-design` |
| Folded into an existing skill/native workflow, without duplicate entrypoint | **3** | CEOS `audit-repair-loop`; Starter Kit `implementation-cycle`, `visual-quality-gate` |
| Native product workflow rather than a new skill | **1** | CEOS `ceos-continue` → Studio/AI continuation; no CEOS session/CLI compatibility promise |
| Read-only reference; deliberately not installed | **2** | Starter Kit `codex-engineering-system`, `project-termination` |
| Still deferred or contingent on product/genre prerequisites | **15** | CEOS: dialogue editing, reader experience (**N2 contract proposed, not approved**), romance, prod check, release, video (**6**). Starter Kit: accessibility, audio, feel, performance, mobile UX, product review, release audit, web playtest, Yandex release validation (**9**) |

The other **3** Ludory entrypoints are `ludory-engineering-quality` and `ludory-narrative-review` (existing native skills) and `ludory-ui-design` (Ludory-specific UI craft, PR #22). Thus **9 source analogues + 3 native/Ludory-specific = 12** current skills. Folded/native/reference/deferred dispositions must **not** be counted as installed skills. The exact per-source reasoning and pinned SHAs remain in S0; no copies of old `SKILL.md` are required.

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
| **S3 — runtime/player quality** | **BLOCKED BY PRODUCT EVIDENCE** | Mobile UX, accessibility, audio, performance, game feel, web playtest, product review | Relevant Runtime R2–R7 implementation and real browser/device fixtures, actual build identity, independent interaction measurements |
| **S4-N2 — experiential/genre review** | **AUDIT + CONTRACT PROPOSAL; OWNER DECISION PENDING** | [Overlap audit](../audits/2026-10-28-narrative-experience-overlap.md): one optional `ludory-reader-experience` proposed for bounded blind first-read packets, with romance guidance kept under existing narrative review; [proposed contract](../superpowers/specs/2026-10-28-reader-experience-skill-design.md) | Actual unprimed reader evidence is **NOT_RUN** until independently observed; no fabricated reader, duplicate Web review or mandatory romance criteria |
| **S5 — release/media** | **BLOCKED BY CONNECT + RELEASE** | Release audit, Yandex/VK target gates, optional gameplay video/live inspection | Target-specific SDK/build/ZIP/platform evidence and explicit owner publication authorization |

The skill work merged through N1 is **instruction/fixture delivery**, not an all-green quality pipeline; N2 proposes a contract, not an installed skill or completed reader session. Runtime R1 was a separate contract-layer Draft PR, not a runtime host or browser game; S3 and S5 must not issue acceptance before their product prerequisites exist. Do not recreate `project-termination`, `codex-engineering-system` or legacy CEOS continuation as Ludory skill entrypoints without a new scoped justification.

## Next decision gates (recommended order)

1. **N2, current — review the optional reader-experience contract.** With N1 implemented and merged, decide whether one narrowly triggered cold-reader handoff skill is warranted. The [N2 audit](../audits/2026-10-28-narrative-experience-overlap.md) recommends no duplicate romance editor, and the [proposed contract](../superpowers/specs/2026-10-28-reader-experience-skill-design.md) permits unsent packet preparation while requiring real independent first-pass observations for a reader verdict. Owner approval, separate implementation PR and review remain explicit gates. Real player-visible route fidelity still needs Runtime.
2. **S3, after relevant Runtime milestones — one evidence-backed vertical slice first.** Start with actual new Studio game host/browser lifecycle and input/viewport fixtures; select the first mobile/accessibility/playtest skill only when its underlying observable APIs exist. Audio, performance and game-feel reviews follow their own measured paths. Do not batch seven skills as paper-only acceptance.
3. **S5, after Connect/Release — independent platform gates.** Build separate Yandex and VK scopes, with explicit target, package and publication authority. A release-audit instruction can be drafted earlier but cannot become Release PASS or an authorized submission.

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

**Next optional-content gate:** review/approve or reject the **proposed S4-N2 reader-experience contract**; no implementation until separate owner authorization. Romance-specific editorial guidance stays opt-in under existing narrative-review ownership. S3 mobile/accessibility/audio/performance/playtest still requires actual Runtime/browser/player evidence; S5 waits for Connect/Release.
