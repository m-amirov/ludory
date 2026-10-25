# Studio Safe Component Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update only verifiably Studio-managed template assets, aborting the entire operation on user modifications.

**Architecture:** Create a distinct v1 components ownership manifest at game creation; plan updates by SHA-256 and catalog version, then stage and apply exclusively with rollback on synchronous failures. Preserve historical receipts and frozen games.

**Tech Stack:** Node 22+ ESM, built-in `fs`, `crypto`, `node:test`, existing Studio catalog and CLI.

**Spec:** `docs/superpowers/specs/2026-10-25-studio-safe-components-design.md`

## Global Constraints

- User edits: block whole update; no merge and no force.
- Do not write to old games or import CEOS / Starter Kit history.
- New components state alone supplies Studio ownership; old receipt does not.
- Reject unsafe paths, symlinks, stale plans and partial apply claims.
- Independent release and VK/Yandex acceptance remain out of scope.

## Review Focus

- Corrupt or fabricated ownership state => CONFLICT before any writes (Task 2).
- Same-version modified catalog asset => CONFLICT (Task 2).
- New asset path collides with user file or a symbolic directory => CONFLICT (Task 2).
- Catalog or user file modified between preview and apply => no updates (Task 3).
- Failure after first file replacement => restore original files, retain unverified backups (Task 3).

---

### Task 1: Creation provenance

**Files:** `packages/studio/src/scaffold.mjs`, `packages/studio/src/catalog.mjs`, `packages/studio/test/scaffold.test.mjs`, `packages/studio/test/catalog.test.mjs`.

**Interfaces:** `ludory.components.json` v1 with `schemaVersion`, `template` (id/version/origin/sourceSha256), and `files` path/hash map. Only template assets, no manifest or receipt.

- [x] Test: new create emits stable components state with correct hashes; old manifest/receipt remain unchanged.
- [x] RED: run `node --test packages/studio/test/scaffold.test.mjs`.
- [x] Implement creation state and reserve its output name in catalog.
- [x] GREEN: targeted tests pass.
- [x] Commit creation provenance.

### Task 2: Read-only update plan

**Files:** create `packages/studio/src/component-updates.mjs`; create `packages/studio/test/component-updates.test.mjs`.

**Interfaces:** `planComponentUpdate(projectDir, {catalog}={}) -> {mode, project, status, writes, conflicts, ...}`; `componentStatus(projectDir, options)` read-only wrapper.

- [x] Test: clean newer template READY, no catalog change IN_SYNC, edit entire update CONFLICT, old receipt BLOCKED, downgrade/same-version drift/conflicting additions/symbolic paths blocked.
- [x] RED: run `node --test packages/studio/test/component-updates.test.mjs`.
- [x] Implement strict state validation, source compatibility, version comparison and stable plan fingerprint.
- [x] GREEN: run target tests and confirm preview never modifies bytes.
- [x] Commit planner.

### Task 3: Transactional guarded apply

**Files:** `packages/studio/src/component-updates.mjs`, `packages/studio/test/component-updates.test.mjs`.

**Interfaces:** `applyComponentPlan(plan)` accepts only a freshly verifiable READY plan, returns APPLIED or throws with conflict/recovery context.

- [x] Test: clean update changes managed assets and state; stale hash/source blocks; simulated failure restores prior bytes and state; user-created files untouched.
- [x] RED: run targeted tests.
- [x] Implement exclusive lock, staging, persistent original inode backups and conservative rollback.
- [x] GREEN: targeted tests pass.
- [x] Commit apply.

### Task 4: CLI, docs and integration verification

**Files:** `packages/studio/src/cli.mjs`, `packages/studio/README.md`, `packages/studio/test/cli.test.mjs`, `README.md` if needed.

**Interfaces:** `components status`, `components update` preview, `components update --apply`; JSON and exit codes match existing Studio families.

- [x] Test CLI read-only/updated/blocked with exit codes.
- [x] RED: run CLI tests.
- [x] Add minimal routing and docs with explicit frozen-game limitation.
- [x] GREEN: run `npm test`, `npm run check`, `node examples/core-session.mjs`.
- [x] Commit; request code review; do not merge without owner permission.
