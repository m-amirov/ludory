# Native AI development acceptance fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct PR #6's four owner-accepted blockers without recreating CEOS orchestration complexity.

**Architecture:** Keep safe, append-only `.ludory/ai` publication, but decouple long-lived run history from mutable working-tree state. Capture optional Git provenance per action; treat evidence hash receipts as historical values. Provide one read-only run listing and supersede historical importer documentation.

**Tech Stack:** Node.js 22+, ESM, `node:test`, npm workspaces, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-native-dev-workflows-simplification-design.md` (owner approved the four fixes in this conversation).

## Global Constraints

- No existing game repository or CEOS files modified. No old-run importer, external CEOS dependency, artificial PASS or extra session manager.
- Preserve manifest/inode check between preview and apply, safe relative exclusive file writes, event/commit SHA receipts.
- Source move/read remains safe; tampering with actual event bytes or independent hash receipts is still fatal.
- No merge to main without fresh green local and Node22/24 CI and explicit owner request.

## Review Focus

1. New game with no `.git`, untracked manifest, nested monorepo or dirty working tree must start and inspect (Task 1 tests).
2. Existing run survives legitimate commit/art changes and relocation, but cross-game replay remains blocked (Task 2 tests).
3. Stored event/receipt tampering remains fatal even if external artifact bytes change normally (Task 2 tests).
4. Multiple active runs enumerate explicit IDs without selecting the wrong run (Task 3 tests).
5. A stale apply plan or symlink-swapped output still blocks without off-target writes (full regressions in Tasks 1–3).

### Task 1: Optional development Git provenance

**Files:** `packages/ai/src/source.mjs`; `packages/ai/test/source.test.mjs`, `packages/ai/test/workflows.test.mjs`.

**Interface:** `inspectNativeProject(projectDir)` retains project, rootIdentity, manifest, manifestSha256 and optional `gitHead/gitClean/gitRoot`. `verifyNativeSource(binding)` validates the current directory and manifest but does not block edits/HEAD changes. Current plan/apply still rejects replaced directories and changed manifest.

- [ ] RED: tests create a game without Git, nested Git root and dirty/ignored source, and assert doctor/start works; test stale manifest and directory still block apply.
- [ ] Run `node --test packages/ai/test/source.test.mjs packages/ai/test/workflows.test.mjs` and observe expected behavior failure.
- [ ] GREEN: make Git inspection advisory; bind *planned writes* to directory + manifest; retain symlink/traversal checks.
- [ ] Targeted then full `npm test` PASS.

### Task 2: Durable, portable run replay

**Files:** `packages/ai/src/store.mjs`, `packages/ai/test/store.test.mjs`, `packages/ai/test/workflows.test.mjs`.

**Interface:** `readNativeRun` validates own immutable run/event receipts against current game identity without rehashing old files; `planNativeEvent` binds a *fresh* source snapshot and records optional current Git HEAD per action. `commitNativeEvent` revalidates the new plan, independent of run origin's old working tree.

- [ ] RED: after code/art edits, Git commit or relocation, original run status and new checkpoint remain available; copied run into a separate live project is rejected, and mutated receipt still blocks.
- [ ] Run targeted store/workflow tests, observe expected failure.
- [ ] GREEN: decouple ledger integrity from current artifact content/path/HEAD; preserve fail-closed event hash chain and manifest/inode write publication.
- [ ] Targeted then full `npm test` PASS.

### Task 3: Ambiguous-run discoverability and scope correction

**Files:** `packages/ai/src/store.mjs`, `packages/ai/src/workflows.mjs`, `packages/studio/src/cli.mjs`, associated tests, `README.md`, `packages/studio/README.md`, `docs/ROADMAP.md`, `AGENTS.md`, former spec/plan supersession notice.

**Interface:** `listNativeRuns(projectDir)` returns inspected native runs; `workflow status` on ambiguous `latest` emits valid active run IDs and stages, and mutating commands stay blocked with those IDs; keep six existing public commands.

- [ ] RED: two active runs return discoverable IDs and nonmutating status; help/docs no longer prescribe historical CEOS import.
- [ ] Run targeted CLI/workflow/store tests and observe expected failure.
- [ ] GREEN: minimal run listing and accurate docs; no new orchestration layer or CLI command required.
- [ ] Full `npm test`, `npm run check`, Core example PASS; check native code has no CEOS dependency.

### Task 4: Independent review and published PR acceptance

- [ ] Fresh independent reviewer checks the three changed behaviors and old race/safety regressions.
- [ ] Upload only changed files as verified Git blobs onto current PR #6 head commit, update its branch, inspect exact diff and run Node22/24 Actions.
- [ ] Keep PR #6 Draft; do not touch main, CEOS repo, Starter Kit repo or frozen games.

## Self-review

No new runtime dependency, imported history or agent framework. Task 2 consumes Task 1's source contract; Task 3 consumes Task 2's portable run listing. Historical evidence bytes need not exist after recording, but tampering with the immutable checkpoint receipt must still be detected. This deliberately puts strict current-artifact verification in future Release, not routine development.
