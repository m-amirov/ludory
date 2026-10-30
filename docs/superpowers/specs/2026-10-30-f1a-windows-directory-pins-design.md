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

- **Selected after native experiment:** A small Win32 N-API module uses
  `CreateFileW` with `FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES`, `FILE_FLAG_BACKUP_SEMANTICS`,
  `FILE_SHARE_READ | FILE_SHARE_WRITE` and **without `FILE_SHARE_DELETE`**.
  Returned handles stay in the same Node process for the whole transaction.
  Build the addon explicitly; if absent, refuse Windows apply before writes.
  `FILE_READ_ATTRIBUTES` alone was insufficient: metadata-only opens did not
  enforce the expected rename sharing restriction on Windows CI.
- **Rejected by native CI:** `UV_FS_O_EXLOCK` disallows all sharing: rename
  of the target directory is denied, but even the legitimate `new-0` to
  `backup-0` file move beneath it returns `EBUSY` on NTFS (both Node 22/24).
  Therefore a generic exclusive `fs.openSync` handle is not usable.
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

Build is required on Windows during verification and before first native apply;
no broadened ownership, no silent recovery/deletion, and no pretending ordinary
`fs.openSync` pins a directory. Review sharing conflicts with running editors, failure while
creating the archive, post-lock rename attempts, parent junction swaps and
rollback under filesystem errors.

## Pending NTFS reparse-point and distribution verification

The passing rename tests do **not** prove protection against
`FSCTL_SET_REPARSE_POINT` turning an *existing, temporarily empty* managed parent
into a junction without renaming it. Add a Windows-only native injection probe
that establishes the same runner can create an in-place junction on an
unprotected empty directory, then retries at the publication window while
the managed parent is pinned. Reject diverted writes or `APPLIED` after a
successful malicious substitution. Retain a backup and lock on incomplete
recovery. A blocked injection is evidence of a working OS guard only if the
unprotected baseline succeeds; never pass on a missing/unsupported probe.

The production addon presently needs `npm run build:windows-pin` on Windows.
Any smoother installation mechanism must remain offline, verified and
fail-closed; no unauthenticated binary downloads or Windows apply fallback.
An older addon may remain loadable in ignored `native/build/Release` after a
source update, so the loader must require a versioned native security contract
before any directory pin operation. Merely probing `open` and `close` is not
sufficient to distinguish an old metadata-only binary from the corrected
share-enforced implementation.
