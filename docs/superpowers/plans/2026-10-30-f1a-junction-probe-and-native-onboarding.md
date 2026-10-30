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

## Task 2 — Native addon onboarding (bounded)

1. Identify the current Windows native build and failure surfaces in Studio.
2. Provide Codex/CLI with a deterministic, actionable prerequisite check
   and build instruction, without silent untrusted downloads or relaxed
   apply security. Add tests for missing addon and OS differences.
3. Run `npm test`, `npm run check`, Core example and full CI on the exact HEAD;
   update PR #46 evidence. Keep it Draft, do not merge or touch game projects.
