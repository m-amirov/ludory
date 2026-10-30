# F1a: in-place NTFS junction evidence and Windows onboarding

## Task 1 — Red-team proof on actual Windows

1. Add a test-only PowerShell/C# helper that calls Windows `CreateFileW` and
   `DeviceIoControl(FSCTL_SET_REPARSE_POINT)` on an *existing empty* directory.
   The helper must report an explicit Win32 code on rejection.
2. Add a Windows-only regression: successful unpinned baseline, attack after
   renaming `src/main.js` to the transaction backup, and guarded assertions
   for the external sentinel, transaction status, lock and retained backup.
3. Run local smoke, then Windows Node 22/24 CI. Capture whether the pinned
   mutation was *blocked* or *succeeded*; fix the root cause if it succeeds
   and diverts a write or authorizes an incorrect commit.

## Task 1b — Verified in-place junction remediation (activated by RED)

1. Reproduce the confirmed transient outside-project hardlink on native NTFS.
   Do not accept a successful rollback as evidence that no outside write took
   place. The v3 read-only-share experiment is rejected by Windows `EBUSY` on
   ordinary managed-file rename.
2. Create native, handle-relative nondeletable guard files within each pinned
   project/managed/archive directory. No full-path guard creation in an empty
   directory is accepted as race-free. Reject stale addon protocol versions.
3. Delete guards by the same native HANDLE only after safe finalization; retain
   guards, backup and lock on incomplete rollback. A verification error after
   native guard creation is sticky even if there were no managed publications
   to undo: retain the lock for orphan-guard recovery. Test both `GENERIC_WRITE`
   and attribute-only junction injection on Windows Node 22/24.
4. Keep Draft until the exact final SHA passes all four CI matrix jobs and an
   independent security review confirms the file-guard lifetime contract.
5. Probe the additional empty-stage window immediately after `mkdtempSync`
   and before acquiring the stage pin. A successful outside junction must
   abort without creating metadata outside, and retain the recovery lock.
   Also inject after the native stage pin but immediately before its
   `NtCreateFile(RootDirectory=held)` guard creation; prove no guard is ever
   written through the malicious junction.
   Use `OBJ_DONT_REPARSE` as defense-in-depth on handle-relative guard creation;
   do not treat that flag alone as a proven security boundary.

## Task 2 — Native addon onboarding (bounded)

1. Identify the current Windows native build and failure surfaces in Studio.
2. Provide Codex/CLI with a deterministic, actionable prerequisite check
   and build instruction, without silent untrusted downloads or relaxed
   apply security. Add tests for missing addon and OS differences.
3. Run `npm test`, `npm run check`, Core example and full CI on the exact HEAD;
   update PR #46 evidence. Keep it Draft, do not merge or touch game projects.
