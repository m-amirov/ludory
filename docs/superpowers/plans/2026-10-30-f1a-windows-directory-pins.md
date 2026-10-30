# F1a Windows directory pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Windows NTFS directory substitution during Studio component updates without an unverified third-party dependency.

**Architecture:** A small OS-specific protected-directory opener wraps native libuv exclusive directory handles and verifies inode identity. `applyComponentPlan` retains handles for the project root, archive and every relevant managed parent until transaction completion; on unavailability it fails closed. Existing Linux descriptor paths remain unchanged.

**Tech Stack:** Node.js 22+ ESM, built-in `node:fs`, libuv `UV_FS_O_EXLOCK` on Windows, `node:test`, GitHub Actions Windows/Ubuntu.

**Spec:** `docs/superpowers/specs/2026-10-30-f1a-windows-directory-pins-design.md`.

## Global Constraints

- Keep PR #46 Draft, never merge or publish; preserve user dirty files, games, existing archives.
- If libuv exclusive opening interferes with required operations, stop the experiment and implement an independently validated native alternative or explicitly block Windows; never quietly remove the security test.
- No broad refactor; retain current ownership, trust, rollback and evidence rules.

## Review Focus

1. Existing editor read handles may cause Windows exclusive lock rejection: fail cleanly before publication.
2. Root, archive and nested parent paths are renamed in an attacker-controlled interval: block the rename, not merely detect it afterwards.
3. Exclusive directory handle blocks normal `stat`/`rename` of child paths: either find safe precise sharing or block Windows updates.
4. Rollback discovers a partial publication after a filesystem error: preserve originals, quarantine and transaction lock.
5. Filesystem integration differs between Node 22 and 24: require both native jobs green.

---

### Task 1: Prove native directory lock behavior

**Files:** Create `packages/studio/src/windows-directory-pin.mjs`; modify `packages/studio/test/component-updates.test.mjs`.

**Interfaces:** `openProtectedDirectory(path: string): number` (Windows only) returns live fd or throws; `assert` test checks rename failure with the fd held, then success after closing it.

- [ ] Write Windows-only regression assertions for project and archive rename while protected; assert Linux rejects Windows-only opener.
- [ ] Run focused tests before implementation for RED (local unsupported-host branch; Windows runner for native branch).
- [ ] Implement minimal OS-backed opening and inode validation; no catch-and-continue fallback.
- [ ] Run focused local tests and exact Windows CI; record any unsupported directory operations.
- [ ] Commit the proven primitive and test, or record the blocked proof before further implementation.

### Task 2: Pin transaction paths throughout Windows apply

**Files:** Modify `packages/studio/src/component-updates.mjs` and `packages/studio/test/component-updates.test.mjs`, update `packages/studio/README.md`.

**Interfaces:** `applyComponentPlan(plan)` remains synchronous; all native handles are closed in the finalizer, with failures retaining recoverable backups and locks.

- [ ] Add tests for nested parent substitution and lock failure that fail against the current apply.
- [ ] Wire OS handles for root, archive and managed parents before their first critical publication, keeping unpinned Linux logic intact.
- [ ] Verify RED→GREEN on Windows; fix four exact stale path expectations according to flat Windows archive contracts.
- [ ] Verify targeted tests, full suite, syntax check, Core example and actual Windows/Ubuntu CI jobs.
- [ ] Commit to PR branch, update Draft PR evidence. Do not assert release or merge readiness without all gates.
