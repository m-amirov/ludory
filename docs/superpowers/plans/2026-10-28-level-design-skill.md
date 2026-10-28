# Ludory Level Design Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one optional, read-only `ludory-level-design` skill whose findings are bounded by real game-owned level rules and independently checked evidence.

**Architecture:** A repo-local Markdown instruction skill, Node `node:test` structural/mutation guards, and an isolated synthetic new Studio game with independent executable witnesses. Behavior under pressure is assessed with agent baselines before the skill and matching guided trials afterward. No new Runtime API, solver library, platform threshold or game modification.

**Tech Stack:** Node 22+ ESM, `node:test`, Studio `planCreate/applyCreatePlan`, JSDoc/Markdown.

**Spec:** `docs/superpowers/specs/2026-10-28-level-design-skill-design.md` (approved; merged PR #25).

## Global Constraints

- Only explicit level-based **new Studio-created** games. A writable `ludory.studio.json` marker is not independent ownership attestation; excluded frozen games are never inspected or modified.
- Read-only review by default; user-authorized edits require separate `ludory-fix`/TDD scope.
- No invented levels, win predicates, solver CLI, playtime quota, Yandex/VK acceptance or Release PASS.
- Positive solvability: exact start and legal action witness replayed through authoritative current game transitions with victory assertion.
- Impossibility: exhaustively checked finite reachable state space or independently checkable invariant; a solver `unsat`, timeout or failed path is insufficient.
- Unknown Runtime equivalence remains `BLOCKED_RUNTIME_EQUIVALENCE`, and absent device/player test remains `NOT_RUN`.
- No CEOS/Starter Kit import, global hooks, external tool use or modification of old game repos.

## Review Focus

1. A solver returns 0 and prints `100% solvable` but asserts no game-owned victory: do not report SOURCE_CHECKED solvability.
2. Solver and preview share an incorrect transition model: use authoritative game implementation and distinguish modeled vs observed rules.
3. Solver reports `impossible` even though a winning path exists: independently replay the valid counterexample and reject impossibility.
4. One failed route or cutoff is not a proof of impossibility; a valid loss is not automatically an unintended softlock.
5. A marker in an unrelated or frozen game does not authorize inspection; a non-level-based new game must not acquire invented levels.

---

### Task 1: Pressure baseline and behavior cases

**Files:** Create `docs/audits/2026-10-28-level-design-skill-trials.md`; Test `packages/studio/test/level-design-skill.test.mjs`.

**Interfaces:** Consumes an existing `planCreate/applyCreatePlan` new-game fixture. Produces checkable RED agent baseline findings and targeted tests that fail when the skill does not exist.

- [x] **Step 1:** Dispatch 3 independent scenarios **without this skill**: false-green solver; incompatible rules + false impossibility; unauthorized/frozen game and artificial level design. Include pressure to report a quick PASS and preserve verbatim rationalizations.
- [x] **Step 2:** Create deterministic Studio game in a disposable test directory and a tiny *fixture-local* finite-state puzzle with explicit start/actions/terminal; write node tests with hand-checked winning sequence, exhaustive finite-state impossible case, false impossible claim and legal-loss distinction. No production solver implementation.
- [x] **Step 3:** Add structural/mutation tests for trigger, trust/authorization, evidence binding, proof gates, runtime status separation, reporting shape and forbidden legacy commands; run `node --test packages/studio/test/level-design-skill.test.mjs` and observe missing-skill RED.

### Task 2: One minimal skill, GREEN and pressure verification

**Files:** Create `.agents/skills/ludory-level-design/SKILL.md`; Modify `docs/audits/2026-10-28-level-design-skill-trials.md`.

**Interfaces:** Consumes the approved spec and RED failures; produces only a discoverable source-review instruction, no new game/runtime code.

- [x] **Step 1:** Write minimal frontmatter (`Use when...`) and conditional entry, ownership + side-effect preflight, actual transitions and level identity, checked witness/impossibility/softlock criteria, evidence table and independent Runtime blocker; no guessed native level CLI.
- [x] **Step 2:** Run focused tests and confirm GREEN; test mutated unsafe guidance (weakening proof, permissions, status) causes a targeted failure.
- [x] **Step 3:** Re-run each baseline scenario with skill fully loaded; capture actual responses, remaining slips, and refactor/re-test until serious claim/authorization loopholes close.

### Task 3: Handoff, independent review and publication

**Files:** Modify `docs/skills/ROADMAP.md`; Modify `docs/superpowers/specs/2026-10-28-level-design-skill-design.md` status only.

**Interfaces:** Produces Draft implementation PR against merged contract, without automatically approving or merging it.

- [x] **Step 1:** Reconcile roadmap and contract statuses with verified task outcomes and test limitations.
- [x] **Step 2:** Run `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`; independent code review of the complete diff. Fix all Critical/Important issues.
- [ ] **Step 3:** Commit on `codex/level-design-implementation` from PR #25 merge SHA, create Draft PR and report exact head SHA and CI (pending is pending). Preserve checkout.
