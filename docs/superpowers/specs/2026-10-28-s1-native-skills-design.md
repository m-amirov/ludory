# S1 Native Engineering Skills — Contract v1 (approved)

**Decision:** APPROVED for implementation by the owner's 2026-10-28 instruction to approve first-wave contracts and implement S1. This approval covers S1 engineering skills only; S2 visual/art/rights still require their own scoped implementation.

## Intent and constraints

Expose three discoverable, repository-local Codex workflows for auditing, proving claims and repairing defects in Ludory itself and **new Ludory-owned Studio games**. The source of inspiration is CEOS `audit`, `verification`, `fix` and Starter Kit `implementation-cycle`, but old code/session state is never imported.

Keep the existing `.agents/skills/ludory-engineering-quality` and `ludory-narrative-review` intact. No Node CLI, Core, Runtime, Connect or Release production behavior changes. No dependency on CEOS or Starter Kit at runtime; no global installation, hooks or second skill root. Frozen games remain untouched. Respect ordinary dirty/unversioned development. Release/source freeze rules are not imported into daily development.

## Approaches

1. **Copy CEOS files verbatim** — fastest but violates standalone Ludory: `ceos context`, legacy policy loading and run-state assumptions. Rejected.
2. **Three small native instruction skills with integration/static tests** — distinct intent, minimal overlap, existing Studio/AI commands only where available; bounded evidence requirements. **Selected.**
3. **One monolithic engineering skill** — little duplication but impossible to activate audit vs fix independently and obscures read-only intent. Rejected.

## Public skill contracts

### `ludory-audit`

- Trigger: user requests audit, code quality/readiness/risk inspection **without** authorizing behavior changes.
- Default authority: read-only project inspection and safe tests; never edit product code, accept a fix request implicitly, merge, publish or alter a frozen game. Test-generated temp output is not a product mutation.
- Input: exact target/scope, source identity (commit when available), relevant criteria and accepted evidence types.
- Output: scope/baseline, severity-ordered findings, each with reproducible source/command/artifact evidence, separate evidence gaps, and proposed next actions. Audit completion itself is not a `PASS` for features or release.
- Missing browser/Web/Quality/platform tools: record `BLOCKED` for only that evidence domain; distinguish missing evidence from a proven defect.

### `ludory-verification`

- Trigger: user asks whether an implementation, test, bugfix or acceptance claim is true, or independent sign-off is requested.
- Default authority: read-only verification; run strongest safe project-native checks without changing product behavior.
- Input: explicit, bounded claims; each claim maps to one executed assertion or directly inspected artifact with source identity and freshness.
- Output: claim-to-evidence matrix and exactly one **scoped** overall verdict `PASS`, `FAIL` or `BLOCKED`. `FAIL` if any mandatory criterion is observed failing; else `BLOCKED` if any mandatory criterion is unverified/stale; only all mandatory current assertions passing yields `PASS` for the declared scope. `N/A` needs a reason.
- `EXECUTED_UNVERIFIED` from Codex or a green unit test cannot prove browser pixels, real device/host, rights or Release PASS. Do not reuse producer self-claims as independent evidence.

### `ludory-fix`

- Trigger: user **explicitly** requests a fix/repair or implementation of a defect; diagnosis-only requests remain read-only.
- Default authority: edit only authorized files in the Ludory repo/new Studio game; preserve unrelated dirty/unversioned changes. Never edit a frozen game, publish or force-push.
- Process: reproduce a concrete symptom → identify root cause → write a failing behavior/regression test (RED) → minimal patch → focused test (GREEN) → wider relevant regression and diff review. If reproduction is unsafe/impossible, report blocker instead of speculative patch.
- Output: original symptom/root cause, changed files, RED and GREEN commands/results, remaining evidence gaps, scoped verification verdict. Native `workflow cycle` is optional for new Studio games and `--apply` has side effects; its `EXECUTED_UNVERIFIED` status is not independent acceptance. Do not run a Codex executor without explicit opt-in.

## Cross-cutting boundaries

1. `ludory-engineering-quality` remains the owner of optional quick/deep quality metrics; do not duplicate its CRAP/Dryer/Mutator execution. Missing external tools remains `BLOCKED`.
2. Skill discovery uses `.agents/skills/<name>/SKILL.md`, YAML `name` and `description: Use when ...`. Keep commands consistent with current Studio README, use generic `npm test`, `npm run check` and `node examples/core-session.mjs` only in a repository that actually provides them.
3. Clear precedence: explicit user scope, `AGENTS.md`, real tool access and configured project instructions; CEOS/Starter Kit are read-only sources. No generic skill overrides official current platform requirements.
4. No claim without evidence; no `PASS` without current executable assertions or appropriately inspected actual runtime artifacts. Separate findings, infra blockers and tool unavailability.

## Acceptance

- Three new skills with no conflicting triggers or mandatory global install.
- RED→GREEN repository tests for discoverability, scope boundaries, evidence/verdict semantics, Windows CRLF frontmatter and absence of legacy command dependencies. Tests only establish the declared **instruction contract**, not proof an agent followed every instruction.
- A read-only negative/pressure scenario for each skill is attempted; if no isolated behavioral agent test is feasible, report that coverage gap rather than a behavioral PASS.
- `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`; independent CI Ubuntu/Windows Node 22/24 and review before merge.
- PR is Draft and stacked on S0 PR #18, not on Runtime PR #16; no automatic merge.
