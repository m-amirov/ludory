# S1 Native Engineering Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, using TDD and preserving review gates.

**Goal:** Ship three repository-local Ludory engineering skills (`audit`, `verification`, `fix`) whose activation, evidence boundaries and fail-closed behavior are testable.

**Architecture:** Three independent `.agents/skills` instruction files, no product code or runtime adapter changes. One Node test file locks public discovery/contract shape; agent pressure tests characterize behavior and remain distinct from static checks.

**Tech Stack:** Markdown/YAML `SKILL.md`, Node.js 22+ ESM `node:test`, existing npm scripts.

**Spec:** `docs/superpowers/specs/2026-10-28-s1-native-skills-design.md`

## Global Constraints

- S1 branch from PR #18 (S0), not PR #16; no changes to existing games, old CEOS/Starter Kit or global skills.
- Preserve existing `ludory-engineering-quality` and `ludory-narrative-review` as-is.
- Tests must not treat static Markdown checks as independent agent execution proof.
- Only scope-bounded local `PASS`, `FAIL`, `BLOCKED`; never a release claim.

## Review Focus

1. Audit prompt asks for a quick fix: audit stays read-only; a suggestion is not an edit.
2. Green tests but missing browser evidence: verification returns `BLOCKED` for visual claim, never broad `PASS`.
3. One observed failure plus other unavailable checks: verification must report `FAIL` with explicitly blocked remaining domains.
4. User asks only for diagnosis: fix is not activated as authority to write.
5. Failed Codex cycle with `EXECUTED_UNVERIFIED`: neither fix nor verification can promote it to accepted result.

---

### Task 1: Audit skill

**Files:** Create `.agents/skills/ludory-audit/SKILL.md`; create `packages/studio/test/s1-skills.test.mjs`.

**Interfaces:** `name: ludory-audit`, `description: Use when...`; sections for scope, read-only actions, findings/evidence/gaps and report format.

- [ ] Write the audit discovery/contract test asserting scope, findings and evidence outcomes. Verify RED due to missing skill.
- [ ] Write minimal `SKILL.md` grounded in current Ludory commands, no CEOS command dependency. Verify GREEN.
- [ ] Record a pressure scenario for audit-versus-fix scope. Commit audited artifact and tests.

### Task 2: Verification skill

**Files:** Create `.agents/skills/ludory-verification/SKILL.md`; extend `packages/studio/test/s1-skills.test.mjs`.

**Interfaces:** `name: ludory-verification`; table mapping criterion/command/observed evidence/status and `PASS`/`FAIL`/`BLOCKED` precedence.

- [ ] Add failing tests for verdict and evidence separation. Verify RED due to missing skill.
- [ ] Implement concise skill; preserve current independent scope and native `EXECUTED_UNVERIFIED`. Verify GREEN.
- [ ] Record blocked/failed/green pressure scenarios. Commit skill and tests.

### Task 3: Fix skill and integration check

**Files:** Create `.agents/skills/ludory-fix/SKILL.md`; extend `packages/studio/test/s1-skills.test.mjs`.

**Interfaces:** `name: ludory-fix`; explicit request-to-change boundary; reproduce/root cause/RED/GREEN, bounded native cycle optional.

- [ ] Add failing tests for mutation authority, RED→GREEN evidence and no hidden release status. Verify RED.
- [ ] Write minimal fix skill, verify focused GREEN and cross-skill frontmatter Windows CRLF contract.
- [ ] Record no-repro/diagnosis-only pressure scenarios; run full `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check` and review committed diff.
- [ ] Commit; open Draft PR stacked on S0, report CI and remaining behavioral evidence gaps.

## Execution note

The user expressly delegated S1 contract approval and implementation in the same request. This plan implements the independently approved v1 contracts above; any scope expansion beyond S1 requires a separate decision.
