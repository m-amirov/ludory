# F1a Windows directory pins — design addendum

## Intent and scope

Close the native Windows TOCTOU vulnerability demonstrated by PR #46's
`Windows-held flat archive and project root` CI test. A normal Node directory
descriptor uses libuv's `FILE_SHARE_DELETE` and therefore does **not** prevent
NTFS directory rename. Publication currently assumes the stage, project root,
and managed parent directories cannot be replaced while component filenames
are resolved. No game repository, CEOS, Starter Kit or Release workflow is in
scope. PR #46 remains Draft; `main` is unchanged.

## Options and selected approach

- **Preferred:** Use the Windows-exclusive `UV_FS_O_EXLOCK` flag supplied by
  libuv's native `CreateFileW` implementation (Node's `fs.openSync` numeric
  flags). Hold verified OS handles from before the first project-local write
  until all publication, rollback and finalization operations are complete.
  This avoids a native addon or a new binary dependency. If the exclusive
  mode also blocks legitimate file operations, do not weaken the guarantee:
  move to a native implementation exposing `FILE_SHARE_READ|FILE_SHARE_WRITE`
  without `FILE_SHARE_DELETE`, and keep the unsafe path disabled meanwhile.
- A PowerShell/.NET `CreateFileW` sidecar can request precise share flags,
  but adds process startup, authentication, lifetime and IPC failure modes.
- Fail-closing **all** Windows component updates is safe but does not provide
  the capability requested by the owner.

## Requirements

1. Windows must reject renaming the actual project root, the exact transaction
   archive and every managed parent **while the transaction depends on them**.
   A guard must be observed on actual Windows/NTFS, not simulated Linux flags.
2. Windows updates must never proceed without successful OS-backed pinning;
   failures preserve lock and backup semantics and cannot be turned into PASS.
3. Guards must not prevent ordinary reads/writes/renames **of managed files**
   or make successful Windows updates impossible.
4. Preserve Linux `/proc/self/fd` inode anchoring, retained backups,
   concurrent-editor protection and ownership/host-trust contracts.
5. Correct platform-dependent flat backup/quarantine expectations in tests,
   without weakening the Windows pin regression.
6. Review exact Windows Node 22/24 and Linux Node 22/24 CI, run local tests,
   `npm run check` and Core example; keep PR Draft if any gate is blocked.

## Anti-goals and review focus

No native build required at install time, no broadened ownership, no silent
recovery/deletion, no pretending `fs.openSync` without an exclusive flag pins
a directory. Review sharing conflicts with running editors, failure while
creating the archive, post-lock rename attempts, parent junction swaps and
rollback under filesystem errors.
