# F1a — Studio-managed component updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Codex-operated Studio to update demonstrably Studio-owned template files in new games, without changing project-owned files or frozen games.

**Architecture:** Creation records a dedicated v1 ownership manifest containing only eligible generated template paths. A read-only update planner verifies hashes and compatibility; an explicit apply rechecks the plan, locks the project and conservatively stages/replaces files with persistent recoverable backups. The historical creation receipt remains informational, not upgrade authority.

**Tech Stack:** Node.js 22+ ESM, built-in `fs`, `path`, `crypto`, `node:test`; existing Studio catalog, scaffold, CLI and physical-path helpers.

**Spec:** `docs/superpowers/specs/2026-10-30-ludory-v1-completion-design.md` §4 F1; historical implementation reference: `origin/feat/studio-safe-component-updates` (PR #10), **not** a merge target.

## Global Constraints

- Existing game repositories, CEOS and Starter Kit remain frozen; use fresh Studio-owned fixtures only.
- Project-owned `package.json`, `AGENTS.md`, `game-spec.yaml`, saves, art, rights, user configuration, `ludory.project.json` and `ludory.studio.json` are never updater-owned.
- No updates based on a historical Studio creation receipt alone. A new separately validated components state grants only narrow ownership.
- No silent three-way merge, automatic deletion, path move, downgrade, overwrite of a modified file, force option or implicit `--apply`.
- Dirty or unversioned **new** games are allowed; content conflicts, not Git cleanliness, control updates.
- No new runtime dependency; no Release/platform readiness claim. Keep existing CLI/SDK behavior intact.
- Test `npm test`, `npm run check`, `node examples/core-session.mjs` and obtain Linux/Windows CI evidence at the candidate HEAD before acceptance.

## Review Focus

1. An attacker provides crafted JSON or duplicated keys in a component manifest: state must not grant ownership of arbitrary paths (Task 2).
2. An editor retains an open descriptor across update/rollback: no already-written or subsequently-written user bytes may be silently destroyed (Task 3).
3. A directory or file is replaced by a symlink/hardlink between planning and apply: operation must fail closed without following it outside the project (Task 3).
4. Template version increases while compatible manifest/engine/targets change unexpectedly: refuse the update before any write (Task 2).
5. Windows/NTFS path casing, file sharing, permissions or backup rename behavior differs from Linux: CI must exercise the same contract, and unsupported operations must return a visible blocker (Task 4).

---

### Task 1: Isolate template component ownership at creation

**Files:** Modify `packages/studio/src/catalog.mjs`, `packages/studio/src/scaffold.mjs`; test `packages/studio/test/catalog.test.mjs`, `packages/studio/test/scaffold.test.mjs`.

**Interfaces:** `isStudioComponentPath(filename: string): boolean` from `catalog.mjs`; new canonical `ludory.components.json` v1: `{schemaVersion:1, template:{id,version,profile,origin,sourceSha256}, files:{[relativePath]:sha256}}`. Keep existing `ludory.studio.json` bytes/schema unchanged.

- [ ] **Step 1:** Write failing creation tests: new fixture has canonical components state; every recorded hash matches an actual emitted asset; `package.json`, `AGENTS.md`, `game-spec.yaml`, manifest/receipt, `.ludory/**` are excluded; a colliding catalog output `ludory.components.json` is rejected.
- [ ] **Step 2:** Run `node --test packages/studio/test/catalog.test.mjs packages/studio/test/scaffold.test.mjs`; expected RED because component provenance does not exist.
- [ ] **Step 3:** Implement filtering, reserve the state pathname and add state only to the new-game scaffold preview/atomic create. Do not change existing game files or historical receipts.
- [ ] **Step 4:** Rerun the same tests; expected GREEN with unchanged existing scaffold behavior.
- [ ] **Step 5:** Commit `feat(studio): record narrow managed component provenance`.

### Task 2: Read-only ownership and update planning

**Files:** Create `packages/studio/src/component-updates.mjs`; create `packages/studio/test/component-updates.test.mjs`.

**Interfaces:** `planComponentUpdate(projectDir, {catalog}={})` returns `{mode:'component-update',project,status:'READY'|'IN_SYNC'|'BLOCKED'|'CONFLICT',writes:string[],conflicts:string[],fingerprint?}`; `componentStatus(projectDir, options)` read-only projection. Read catalog through `loadCatalog` and manifest through current Studio/Core validation.

- [ ] **Step 1:** Add failing tests for clean higher-version READY, unchanged IN_SYNC, any modified/missing file CONFLICT (even if template unchanged), no-components-state BLOCKED, malformed/duplicate-key or edited state CONFLICT, downgrade/same-version source drift CONFLICT, changed profile/engine/targets/path deletion CONFLICT, colliding new path, hardlink/symlink/ancestor conflict. Assert byte-for-byte no writes on all previews.
- [ ] **Step 2:** Run `node --test packages/studio/test/component-updates.test.mjs`; expected RED (module/API unavailable).
- [ ] **Step 3:** Implement strict bounded state parser, safe relative path filtering, file identity/hash verification, SemVer comparison, compatibility and source digest checks, stable plan fingerprint with expected current state/manifest/root identity. Port **selected** PR #10 logic after auditing current catalog/scaffold contracts; do not transplant its old CLI file.
- [ ] **Step 4:** Rerun targeted tests; expected GREEN; confirm planner has no mutation side effects.
- [ ] **Step 5:** Commit `feat(studio): preview safe managed component updates`.

### Task 3: Guarded apply and recoverable failure

**Files:** Modify `packages/studio/src/component-updates.mjs`; extend `packages/studio/test/component-updates.test.mjs`.

**Interfaces:** `applyComponentPlan(plan)` accepts only a current READY plan; returns `APPLIED` with explicit paths and state, or a structured error/blocker with recovery instructions. Exclusive lock and staging/backup paths are project-local and never silently cleaned after a partial rollback.

- [ ] **Step 1:** Add failing tests: a fresh plan updates exactly managed files/state; preview-time edits, moved directories and changed catalog/source block apply; no user assets overwritten; second-file failure restores safe originals; post-check edits through held descriptors are retained; rollback collision/failed finalization leaves backups and visible `BLOCKED` state; stale lock blocks concurrent attempts; non-atomic/unsupported filesystems are reported instead of PASS.
- [ ] **Step 2:** Run `node --test packages/studio/test/component-updates.test.mjs`; expected RED for unimplemented apply or negative failure handling.
- [ ] **Step 3:** Implement replan-and-compare under exclusive lock, inode/path rechecks, same-filesystem staging and durable original inode backups, conservative rollback/quarantine with exact byte comparisons. Never remove a file whose ownership or bytes changed concurrently. Keep backup location and operator recovery reason visible.
- [ ] **Step 4:** Rerun targeted tests; expected GREEN including injected failures.
- [ ] **Step 5:** Commit `feat(studio): apply component updates with conservative recovery`.

### Task 4: Studio CLI, operating instructions and OS gates

**Files:** Modify `packages/studio/src/cli.mjs`, `packages/studio/README.md`, possibly `README.md` and root `package.json` syntax list; extend `packages/studio/test/cli.test.mjs`.

**Interfaces:** `ludory components status --project GAME [--catalog DIR] [--json]` is read-only; `ludory components update --project GAME [--catalog DIR] [--apply] [--json]` previews unless `--apply`; standard CLI exit codes `0` success, `2` BLOCKED/CONFLICT, `1` unexpected error. No `--force`.

- [ ] **Step 1:** Add failing CLI tests for read-only preview, clean apply, edited file refusal, historical game missing state, invalid flags and JSON/result status preservation. Create fixture only under temporary paths.
- [ ] **Step 2:** Run `node --test packages/studio/test/cli.test.mjs`; expected RED (components command unavailable).
- [ ] **Step 3:** Wire public CLI without replacing unrelated `workflow`, `quality`, narrative, image and profile branches; update Studio docs with backup/lock and recovery limits. Keep `npm run check` aware of new file.
- [ ] **Step 4:** Run `node --test packages/studio/test/component-updates.test.mjs packages/studio/test/scaffold.test.mjs packages/studio/test/cli.test.mjs`, `npm test`, `npm run check`, `node examples/core-session.mjs`; expected zero failures, aside from explicitly documented preexisting skips.
- [ ] **Step 5:** Run Windows and Linux GitHub CI against **exact** PR HEAD. If CI/host unavailable, keep that evidence `BLOCKED` and PR unmerged. Commit `feat(studio): expose guarded component updates`.

## Completion / handoff

Independent whole-branch review must examine PR #10 stale integration, race/rollback behavior and Windows differences. Record current/base/head, target tests, full suite, exact CI runs, backup behavior, limitations and retained source files. No merge until owner approves and CI gates pass.
