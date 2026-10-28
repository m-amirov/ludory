# Skills & Failure Prevention — delivery roadmap

**Status:** proposed from the [2026-10-28 30→2 skill audit](../audits/2026-10-28-skills-gap.md); no skills have been ported by this document. This is a cross-cutting Ludory lane and **does not block Runtime R1**.

## Operating contract

- Skills live in one Ludory-owned root, `.agents/skills/<name>/SKILL.md`, and are opt-in based on the task/profile; do not create a competing `.codex/skills` root or install global CEOS hooks.
- Ludory Core stays renderer/SDK/browser-neutral; Studio/AI own task workflows, Runtime owns host behavior, Connect owns platform SDK adapters, Release owns publication gates.
- An instruction file guides Codex; executable assertions, browser pixels, artifacts and provenance must support any PASS. Missing/stale/blocked external tool evidence remains `BLOCKED` or `EXECUTED_UNVERIFIED` as appropriate.
- Work only on new Ludory-owned Studio games. CEOS/Starter Kit are read-only references, historical runs are not imported, and all mature games remain frozen.
- Quality/Visual/Runtime/Release acceptance are independent. Developer test success never implies visual, rights, live platform or release PASS. No skill may publish, submit, force-update refs or change source outside authorized scope.
- Reconcile existing Ludory skills first: preserve `ludory-engineering-quality` and `ludory-narrative-review` without overwriting their established contracts.

## PR sequence and dependencies

| PR lane | Scope | Prerequisite | Acceptance |
| --- | --- | --- | --- |
| **S0 — gap audit (this document)** | Pin source skills, map all 30, classify create/merge/native/defer/reference; keep a separate skills roadmap | Current `main`, no old-project writes | Complete source map, correct counts, docs-only diff, no parity claim |
| **S1 — engineering workflows (P0)** | Add `ludory-audit`, `ludory-verification`, `ludory-fix`; refer to native Studio/AI commands and existing Engineering Quality | S0 reviewed; native AI statuses understood | Trigger and precedence tests; read-only audit; reproducible RED/GREEN fix; criterion-to-evidence verdict; blocked executor remains unverified |
| **S2 — visual/art/rights (P0)** | Add `ludory-production-art`, `ludory-visual-qa`, `ludory-asset-rights`; integrate source-bound image packets and review receipts | S0 reviewed; no assumption that Web DEV or native ImageGen is available | Verifiable original image hash, real screenshots and reviewer image receipt, rights manifest; absent tool/canon/live pixels stays BLOCKED |
| **S3 — runtime/player quality (P1)** | Add mobile UX, accessibility, audio, performance, game feel, web playtest, product review | Relevant Runtime R2–R7 functionality and browser fixtures | Representative responsive/touch/keyboard/pause/resume/load/cleanup scenarios, measured budgets, current-build evidence |
| **S4 — optional authored content** | Narrative editor, continuity, reader-experience, romance, level-design | New game explicitly opts into corresponding genre/profile | No blanket genre imposition; authored versus runtime reachability distinct; exact source/route evidence and bounded independent review |
| **S5 — release/media** | Independent release audit, Yandex and VK release skills, optional gameplay-evidence video and read-only live check | Connect and Release validators, real platform evidence, owner authorization | Separate Yandex/VK gates, inspected candidate ZIP, source identity, real observed host state; no implicit publish |

S1 and S2 may be developed while the independent Runtime R1 interface PR is prepared. S3/S5 must not issue fake acceptance before their runtime/platform dependencies are available. Defer `project-termination`, `codex-engineering-system` and legacy CEOS continuation as new skill entrypoints unless a separate scoped design establishes a new, nonlegacy need.

## Implementation requirements for each new skill

1. Define a narrow activation description and an explicit scope/authorization boundary. The skill must name its actual product prerequisites and not pretend an unavailable tool is present.
2. Describe exact inputs and repository-native commands; do not call `ceos`, touch `.codex-os`, install a global hook or assume old worktree/session ownership.
3. Define evidence identity (source SHA-256, relevant commit/build, input artifacts, viewport/state when visual), separated `PASS`/`FAIL`/`BLOCKED` and outstanding evidence gaps.
4. Supply a positive fixture and at least one negative or blocked fixture for every new acceptance claim; where applicable prove regression against the corresponding historical failure. Test skill frontmatter, active path, outdated command references and overlap with existing triggers.
5. Exercise the workflow in an isolated **new** Studio fixture/game; keep side effects in the authorized scope. For externally blocked routes, verify the honest blocked outcome rather than calling it PASS.
6. Use branch/PR review, run relevant `npm test`, `npm run check`, `node examples/core-session.mjs`, inspect `git diff --check` and CI. An unchanged repo test suite alone does not prove new skill efficacy.

## First S1 design decisions to review

- `ludory-audit`: default read-only, classify product/test/infra/evidence findings by severity, return sources and remediation suggestions without changing code.
- `ludory-verification`: map each user acceptance claim to an executable check, distinguish scoped functional verdict from browser/visual/platform gates, report a single scoped overall verdict.
- `ludory-fix`: require a reproduced issue or explicit behavior test, minimal root-cause patch, RED/GREEN evidence, targeted regression, preserve unrelated dirty/unversioned files. Native AI cycle is an optional bounded mechanism, not proof of independent acceptance.

**Owner decision still needed before S1 implementation:** approve the exact first-wave skill contracts and fixtures in a small design document. This roadmap authorizes planning, **not** blind copying or a claims-only PASS.
