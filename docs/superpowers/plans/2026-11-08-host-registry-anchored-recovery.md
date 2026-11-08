# Handle-Anchored Studio Recovery Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the proven post-check host-directory substitution attack on Studio component recovery without changing game files or granting normal host trust.

**Architecture:** Move recovery checkpoint persistence into a directory-handle-anchored, exclusive, transaction-specific host writer. On Linux, all file operations use a verified open directory descriptor through `/proc/self/fd`; on Windows, Studio injects its N-API native pin with new narrowly scoped handle-relative file operations. The existing preview confirmation and canonical trust records remain unchanged.

**Tech Stack:** Node.js 22+ ESM, `node:test`, Linux `procfs` dirfd paths, Windows N-API v5 + `NtCreateFile(RootDirectory)`, SHA-256 and existing Studio trust/CLI contracts.

**Spec:** `docs/superpowers/specs/2026-11-08-host-registry-anchored-recovery-design.md`

## Global Constraints

- Implement only on branch `feat/studio-git-provenance-recovery` in isolated Ludory worktree. Do not modify existing game PR #3, game source/assets, economy, SDK integration or release flow.
- A recovery apply writes at most one new private host checkpoint and a temporary exclusive host lock; no automatic normal trust pin. Existing contradictory trust and real native archives remain blockers.
- All recovery reads, lock operations, checkpoint writes and removal must use the **same pinned root inode**, with no fallback to a mutable pathname after the final identity check.
- Missing native capability on Windows, or unsupported Linux `/proc/self/fd`/POSIX, blocks apply. Never represent mocked Windows behavior as NTFS evidence.
- Preserve canonical record schema and owner digest; keep the `@ludory/studio-trust` package independent from `@ludory/studio` by injecting the Windows adapter.
- Do not mark PR #94 Ready or merge before exact-head Linux+Windows CI and independent security review; no game release.

## Review Focus

1. Root renamed or replaced **in `openSync` immediately before checkpoint open**: no usable checkpoint in substituted root, no false `RECOVERED`.
2. Root absent at preview, first created during apply, then replaced after lock acquisition: both newly created and existing-root cases fail closed.
3. Existing host trust pin or partial checkpoint in the *pinned physical root* cannot be bypassed by showing an empty substituted path to the public API.
4. Failure after writing but before final root-identity confirmation cleans up only the newly created checkpoint via a pinned file/directory handle; lock cleanup also stays pinned.
5. Missing/stale Windows N-API contract and unmounted Linux procfs cause explicit blocked results without path-based fallback; Linux tests cannot assert Windows OS guarantees.
6. A canonical checkpoint left behind under a still-existing per-project lock after an interrupted publication cannot become authority when a reader or `components trust` runs concurrently.

---

### Task 1: Linux anchored recovery writer and race regressions

**Files:**
- Create: `packages/studio-trust/src/host-recovery-writer.mjs`
- Modify: `packages/studio-trust/src/index.mjs`
- Test: `packages/studio/test/component-git-recovery.test.mjs`
- Test: `packages/studio/test/component-recovery-checkpoint.test.mjs`

**Interfaces:**
- Produce `openRecoveryStore(root, { windowsPin } = {})` returning `{ rootIdentity, read(name), createLock(name), createRecord(name, bytes), removeCreated(handle), sync(), close() }`, with a small opaque `handle` for created files. `read` returns `null` for missing files only and checks regular-file, non-symlink/hardlink, size and owner invariants; lock creation is exclusive.
- `registerComponentRecoveryCheckpoint(project, details, expectedHostBinding, options?)` uses one store instance for every registry operation. On Linux, `store` opens root `O_DIRECTORY|O_NOFOLLOW`, checks the root inode, and reads/writes through `/proc/self/fd/<fd>`. The `options` object forwards Windows adapter in Task 2 without importing Studio.
- The stable lock's **removal** is the recovery commit marker. `readComponentRecoveryCheckpoint` must reject a lock present before or after reading canonical bytes, including after a crash. On any pre-commit failure, delete only this invocation's newly created checkpoint; if deletion cannot be verified, leave the lock as a blocking residue.

- [ ] **Step 1:** Add race tests for root replacement immediately before checkpoint file creation (existing and missing root), plus substitution after record write before acknowledgment, plus simulated crash with canonical checkpoint and retained lock. Assert no usable recovery checkpoint in substituted root, blocked readers under a retained lock, and no game-file changes; before code, the first reproducer must fail against the current pathname writer.
- [ ] **Step 2:** Run `node --test packages/studio/test/component-git-recovery.test.mjs`. Expected: RED on reproduced old authority leak.
- [ ] **Step 3:** Implement the anchored Linux store, stable per-project exclusive `.json.lock`, host-only O_EXCL canonical checkpoint, descriptor-relative abort and fsync; reject unsupported POSIX. Use existing `secureDirectory`, `readSecure`, `load` safety functions where compatible, without loosening any trust checks.
- [ ] **Step 4:** Rerun focused recovery/checkpoint/CLI tests. Expected: all PASS and explicit fail-closed for root/path substitutions.
- [ ] **Step 5:** Commit `fix(studio): anchor Linux recovery registry writes to directory handle`.

### Task 2: Windows native handle-relative recovery API

**Files:**
- Modify: `packages/studio/native/directory-pin.c`
- Modify: `packages/studio/src/windows-directory-pin.mjs`
- Modify: `packages/studio/src/component-updates.mjs`
- Modify: `packages/studio/test/component-updates.test.mjs`
- Test: `packages/studio/test/component-recovery-native.test.mjs` (new)
- Modify: `packages/studio-trust/src/host-recovery-writer.mjs`

**Interfaces:**
- Upgrade `pinContractVersion` from 4 to 5. Expose narrowly scoped native `createRecoveryLock(rootToken, basename)`, `readRecoveryRecord(rootToken, basename)`, `createRecoveryRecord(rootToken, basename, bytes)`, using NtCreateFile relative to the held physical `HANDLE`; create methods return held tokens; reuse native `removeGuard(token)` for abort/deletion and `close(token)` for successful record release. Validate reserved 64-hex hash basenames and cap record bytes at 8192.
- Extend `openProtectedDirectory()` with `createRecoveryLock`, `readRecoveryRecord`, `createRecoveryRecord` wrappers; include existing `createGuard` to prevent in-place junction replacement. `acceptComponentGitRecovery()` injects this Windows adapter into `registerComponentRecoveryCheckpoint`; an unavailable native binary blocks apply.

- [ ] **Step 1:** Add v5 contract RED tests and NTFS-only integration tests for handle-relative record creation, lock exclusivity, rooted read, abort removal, held directory replacement/reparse guard, and a stale/missing native module fail-closed case. Tests must exercise real N-API on Windows in the existing Core CI matrix (Node 22/24).
- [ ] **Step 2:** Run Linux contract-focused tests. Expected: RED until version 5 and methods are implemented; Windows tests SKIP explicitly off NTFS.
- [ ] **Step 3:** Implement minimal N-API additions reusing `NtCreateFile`/`removeGuard` patterns, check file type/identity, write/flush bytes and preserve held tokens. No arbitrary-path native write method. Add thin Studio-owned injection while keeping trust package independent.
- [ ] **Step 4:** Run Linux focused suite and, on GitHub Actions, Windows N-API build plus native recovery tests. Expected: exact-head Windows PASS; any missing evidence keeps PR Draft.
- [ ] **Step 5:** Commit `feat(studio): publish recovery checkpoints relative to Win32 directory pin`.

### Task 3: Documentation, complete gates, independent review

**Files:**
- Modify: `packages/studio/README.md`
- Modify: `docs/superpowers/specs/2026-11-08-host-registry-anchored-recovery-design.md` only for justified design rulings
- Modify: `docs/superpowers/plans/2026-11-08-host-registry-anchored-recovery.md` for actual gate evidence

- [ ] **Step 1:** Document Linux procfs prerequisite and Windows `npm run build:windows-pin`, the host-only pinned writer, no path fallback, separate trust and irreversible blocked residue behavior.
- [ ] **Step 2:** Run `node --test packages/studio/test/component-git-recovery.test.mjs packages/studio/test/component-recovery-native.test.mjs packages/studio/test/component-recovery-checkpoint.test.mjs packages/studio/test/component-git-recovery-cli.test.mjs`; check native tests honestly skip on non-Windows.
- [ ] **Step 3:** Run `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`; preserve full evidence and exact command exit codes.
- [ ] **Step 4:** Request independent whole-branch security code review; resolve Critical/Important issues with regression-first fixes, repeat tests.
- [ ] **Step 5:** Publish exact final tree to existing GitHub **Draft PR #94** using non-force expected-head ref update, inspect Linux/Windows CI, and update PR body with evidence and residual gates. Do not merge or modify game PR #3.

## Acceptance

The original post-check checkpoint-publication race must be reproduced as RED and blocked as GREEN. A cross-platform PR is Ready only when exact-head Windows native behavior and Linux gates pass, independent review has no outstanding Critical/Important issues, and owner separately authorizes the next PR state change. If this cannot be established, keep Draft with an explicit blocker; never make up a Windows PASS.
