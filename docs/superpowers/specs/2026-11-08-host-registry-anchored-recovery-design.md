# Handle-anchored Studio host-registry recovery — design

Date: 2026-11-08  
Status: owner-approved direction; implementation in Draft Ludory PR #94

## Intent and proven root cause

`components recover` already checks full local Git provenance, binds its preview to the selected host registry, and requires explicit acceptance. Independent PR #94 review nevertheless reproduced a host-root substitution immediately before `openSync(<host>/*.recovery.json)`. The current path-based writer creates an **effective checkpoint in the substituted directory**, then throws when cleaning up the lock in the original root. More pathname/inode comparisons cannot close the window between the last comparison and file creation.

The recovery checkpoint must be published *relative to a held physical directory*, or not published at all. No game file, component state, original receipt, or existing host trust pin may be changed. Recovery still grants no regular Studio trust; `components trust` remains a separate owner action.

## Approaches

1. **Selected (explicit owner approval):** platform-anchored host writer. Linux holds a verified directory descriptor and uses `/proc/self/fd/<fd>/basename`; Windows extends the existing reviewed Win32 native directory-pin contract to create, write, flush, and remove host recovery records relative to its `HANDLE` (`NtCreateFile` with `RootDirectory`). One bounded checkpoint operation, same normal trust schemas and digest. No server, Docker, migration, or new runtime dependency.
2. System-level protected database or keychain: changes the existing host-trust architecture, migration contract, and test surface far beyond this recovery gate. Not selected.
3. More pre/post `lstat` checks and ordinary path writes: rejected by the reproduced check-to-use race.

## Boundaries and public contracts

- Keep `registerComponentRecoveryCheckpoint(project, details, expectedHostBinding, options?)` as the only checkpoint publication entry point. `options.windowsPin` is a factory for the Studio-owned `openProtectedDirectory` adapter on Windows; `@ludory/studio-trust` must not import Studio and create a package cycle. Recovery reads use the same injected native adapter in read-only mode without creating a guard.
- Linux: open registry root with `O_DIRECTORY | O_RDONLY | O_NOFOLLOW`, verify its device/inode against the preview or newly created root, then derive **all lock, preexisting-pin read, exclusive checkpoint create, cleanup and directory fsync paths from that descriptor**, not the mutable original root. Check `/proc/self/fd` availability; unsupported hosts fail closed.
- Windows: upgrade the existing N-API `directory_pin.node` contract (version bump) with narrowly scoped, reserved-basename `createRecoveryLock` and `createRecoveryRecord` methods. Both use `NtCreateFile` relative to the verified held root `HANDLE`, exclusive creation, no reparse or overwrite; checkpoint accepts canonical bytes, flushes them, and returns a held file token that can be closed on success or deleted through that same handle on abort. Use the existing `removeGuard` for held-token deletion; do not expose arbitrary native file-write methods.
- Windows adapter keeps the protected root handle and existing native child guard held until the checkpoint is committed or aborted; it must check the native contract, expected dev/inode, and target path before/after. Missing/stale native binary blocks apply with the documented `npm run build:windows-pin` prerequisite; never fall back to ordinary Windows pathname writes.
- Preserve existing host trust `registerComponentTrust` / `advanceComponentTrust` semantics, component manifest, checkpoint JSON schema, and CLI confirmation digest. The new publication mechanism is private to the recovery checkpoint; no global trust-store refactor.

## Atomicity and failure semantics

1. The caller freshly recomputes the approved recovery preview and its bound host-registry destination. Detect existing conflicting trust/checkpoints as before.
2. **Option A, owner-approved follow-up (2026-11-08):** the host-registry directory must exist *before* owner preview. If absent, return `BLOCKED` with the selected path and initialization guidance, without exposing an approvable digest. The owner or host administrator creates the private directory in a separate step, then runs a new preview and reviews a fresh digest. Apply refuses an absent or previously absent root **before any checkpoint writer or automatic `mkdir`**, checks the existing directory generation, acquires the native/descriptor anchor, and rechecks identity **through the anchor**. This supersedes the earlier create-on-apply design.
3. Create the stable per-project lock exclusively in the anchored directory; read ordinary trust pin and checkpoint from the same anchor. An existing pin/checkpoint, unsafe file, or wrong identity blocks without replacement.
4. Create the recovery JSON exclusively **in the anchored directory**, write exact canonical bytes, file-sync, and directory-sync (where supported). Confirm the visible registry root still resolves to the pinned inode before considering the operation successful.
5. The **stable per-project lock removal is the publication commit point**. All recovery checkpoint readers, including `verifyOwnershipHistory`, must reject a present lock, checking both before and after reading the record. This prevents a process-crash residue or a partially published canonical JSON from being accepted as authority.
6. If the visible root changed or any publication step fails before this commit point, remove only a checkpoint created by this invocation using the held directory/file handle; preserve any preexisting records and signal `CONFLICT`/failure. If rollback cannot be proven, retain the lock so every reader remains blocked. Never remove an unverified lock to make a failed publication look complete. After lock removal, no later nonessential close/cleanup failure may be reported as a failed publication of an already committed record.

No owner digest is transportable to a different registry: path/physical binding remains in preview. A prior genuine `RECOVERED` checkpoint remains immutable and separate from `components trust`.

## Verification and release gates

- **RED regression before code:** substitute host registry immediately before the underlying checkpoint create, not only during lock creation. Previous code produces a usable record despite reporting error; new code must ensure *no usable checkpoint* in the substituted root. An initially absent registry must block preview/apply before file creation; only separately initialized, already existing registries reach the rooted writer.
- Prove Linux rooted writer still writes/reads a valid checkpoint, retains native lock semantics, and can remove only its own record after post-write path substitution. Simulate process interruption with a canonical checkpoint and retained lock: direct checkpoint read, separate trust preview and component status must block until owner-safe reconciliation. Ensure no game project files changed.
- Windows security tests on actual NTFS (existing Core matrix Node 22/24) build the updated N-API module and prove: current contract, exclusive native record creation, held `HANDLE` blocks pathname replacement or ensures anchored old-root writes, guard prevents in-place junction substitution, abort removes the just-created record by native file handle, and missing/stale module fails closed. Windows emulation on Linux is not accepted as native evidence.
- Existing Git recovery positives and negatives, separate Studio trust, later genuine Studio native update must remain green. Rerun `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`, CI matrix and independent whole-branch review. Do not mark Ready/merge on local Linux tests alone if Windows security gate is pending.
- Publish changes in the existing **Draft Ludory PR #94**, no force update, game PR #3 untouched/Draft/economy OFF. Neither framework tests nor recovery claims that the game has a genuine complete Git history.
