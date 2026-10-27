# StoryScope Narrative Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically review new Studio `episode-script` drafts through a source-bound independent Web DEV turn, backed by a Codex skill and append-only verification.

**Architecture:** A project-local Skill supplies the narrative rubric. A new `narrative-review.mjs` plans and validates one reviewer interaction, persisting a request/result through the existing native run store. Studio invokes it automatically after draft/import and exposes a recovery-friendly explicit command.

**Tech Stack:** Node.js 22+ ESM, built-in `node:test`, existing native Store and authenticated Web DEV helper; no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-27-storyscope-narrative-review-design.md`

## Global Constraints

- All existing/frozen games remain untouched. New workflow is bounded to Studio-created games.
- No unverified provider, OpenAI API, automatic draft overwrite, fake PASS or release gate.
- Source/draft hash binding, append-only events, read-only preview, explicit recovery.
- Existing `art-concept`, image handoff and older event replay remain stable.

## Review Focus

- Malicious review JSON claiming `ACCEPT` while omitting/forging evidence: strict parser rejection and fail-closed result.
- Changing source or stored draft between preview and `--apply`: stale source prevents review.
- Review result without an open request, duplicate request, or wrong request hash: ledger validation rejects it.
- Host throws after request is recorded: no automatic retry; recovery requires stop confirmation.
- Old runs and art-concept drafts: no change in existing behavior.

---

### Task 1: Native review ledger contract

**Files:** `packages/ai/src/store.mjs`, `packages/ai/test/narrative-review.test.mjs`, `packages/ai/src/narrative-review.mjs`, `packages/ai/src/index.mjs`.

**Interfaces:** `planNarrativeReview(projectDir,{run}, {discover})`, `executeNarrativeReview(plan,{apply,host})`, `recoverNarrativeReview(projectDir,run)`; store events `NARRATIVE_REVIEW_REQUESTED` and `NARRATIVE_REVIEW_RESULT` with draft/context SHA and reviewer verdict.

- [ ] Test missing review, accepted report, P0/P1 rework, invalid JSON, hash mismatch, duplicate requests, interruption, request replay, and unchanged historical events.
- [ ] Run `node packages/ai/test/narrative-review.test.mjs`; expect RED due missing review functions/events.
- [ ] Implement minimal model parser, prompt and native request/result handling; persist only validated data.
- [ ] Run the targeted test; expect GREEN.
- [ ] Commit task after verification.

### Task 2: Studio CLI automation and recovery

**Files:** `packages/studio/src/cli.mjs`, `packages/ai/src/workflows.mjs`, `packages/studio/test/draft-cli.test.mjs`, `packages/ai/test/workflows.test.mjs`.

**Interfaces:** auto-review after `episode-script` draft/import; `workflow narrative-review` preview/apply; `workflow recover` explicit abort of pending reviewer.

- [ ] Add CLI tests for automated accepted and rework, missing host, preview-only, timeout/pending recovery, recovery confirmation and unchanged art-concept route.
- [ ] Run relevant test files; expect RED on new behavior.
- [ ] Implement auto-invocation, result propagation, new command and replay-safe recovery path.
- [ ] Run targeted tests; expect GREEN.
- [ ] Commit task after verification.

### Task 3: Skill, research reference and documentation

**Files:** `.agents/skills/ludory-narrative-review/SKILL.md`, `.agents/skills/ludory-narrative-review/references/storyscope.md`, `AGENTS.md`, `packages/studio/README.md`, `README.md`, `packages/ai/test/narrative-skill.test.mjs`.

**Interfaces:** explicit skill trigger for scripts/interactive choices/narrative QA; reference documents measurable patterns and scientific limits.

- [ ] Write failing structural/trigger/schema guidance tests for the repo-local skill and documentation.
- [ ] Run test; expect RED due missing skill.
- [ ] Add concise Skill, reference and minimal discoverability docs with no copy of copyrighted examples.
- [ ] Run targeted test and full `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`.
- [ ] Commit, review whole diff, and open PR when verifiable.
