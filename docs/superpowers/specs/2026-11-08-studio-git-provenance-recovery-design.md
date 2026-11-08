# Owner-approved Git provenance recovery for Studio components — design

Date: 2026-11-08  
Status: proposed; awaiting owner approval for implementation

## Intent and observed blocker

A Studio-created game can be moved to a different machine after a legitimate native component upgrade. The game tracks the current `ludory.components.json`, but Studio deliberately keeps `.ludory-components-backup-*` transaction witnesses untracked. If those archives are absent on the destination, `verifyOwnershipHistory()` returns `CONFLICT` even when all current managed bytes match their manifest. Normal `components trust` cannot authorize such a game.

This occurs in the Draft game PR #3. Its creation receipt records `narrative-interactive@1.2.3`, its current component state records `1.2.4`, and the available checkout has no transaction archives. The game must stay untouched while Ludory gains an explicit recovery path.

## Selected approach and alternatives

1. **Selected — strict local Git-history evidence plus owner confirmation and independent host checkpoint.** This recovers verifiable *continuity*, not an assertion that the original Studio transaction archives existed on this host. It cannot silently grant Studio update authority.
2. Restore the actual `.ludory-components-backup-*` archives from the original Studio machine. This is preferable when genuinely available and requires no new code.
3. Recreate the Studio game and copy author-owned content. This changes the managed baseline and needs a separate opt-in migration, so it is outside scope. Treating Git hashes alone as trust or manufacturing historical Studio transition receipts is prohibited.

## Boundaries

- Work only in Ludory Studio's native component update/trust modules and CLI; no OpenAI API, server, game repo writes, legacy migration, bundle changes or economy enablement.
- No `--force`, no silent repair of a mismatched existing host pin, and no automatic fallback from a corrupt real archive.
- Recovery requires a **full, local, readable Git object history**. Missing/shallow/snapshot-only history, ambiguous parents, state-path rename, missing commits or inaccessible managed blobs produce `BLOCKED` or `CONFLICT`. Never fetch from a remote implicitly.
- Git history is content evidence, not authentication. A project editor can create a Git history; the owner must review the source commits, managed path list and exact hashes before accepting a one-time recovery digest.

## CLI contract

Introduce `ludory components recover --project <game> --from-commit <full-sha> --to-commit <full-sha> [--json]` as **read-only by default**.

Preview reads the exact committed history for the single Studio project path and reports:
- creation receipt and game-manifest identities;
- each distinct component state transition, version/ownership changes and managed file hash witnesses;
- current physical project root identity, receipt/manifest/state digests, authored proof digest, source and target commit IDs;
- `recoverySha256` bound to this complete preview; no game writes;
- `NEEDS_USER_ACTION` only if all checks are satisfied; otherwise a precise fail-closed reason.

To apply, require `--accept-recovery-sha256 <exact-preview-digest> --apply` together with explicit owner consent. Freshly recompute the entire preview before any write; stale source/history/files/host/candidates must block.

## Git evidence and verification

- Resolve a *fixed*, physical Git worktree containing the requested project; never use external network, Git hooks, aliases, untrusted filters, arbitrary shell interpolation, or repo-local configuration as authority.
- Validate full 40-character commit object IDs, ancestry along a single unambiguous first-parent history, and all transitions for `<project-relative>/ludory.components.json` between `from` and `to`. The starting state must match the actual creation receipt's ownership contract; the final committed state and all current managed bytes must match the physical project.
- For every state/version change, validate canonical state bytes and the SHA-256 of *each* Studio-managed file as it existed in that commit. Reject missing/modified managed blobs, downgrades, ownership regression, unknown added owner paths, manifest/receipt divergence, unsafe paths, symlinks and inconsistent author-file classification. Existing `verifyOwnershipHistory` transition rules remain the reference.
- Keep authored story, proofs, media and assets out of managed ownership. Check their current safety/proofs and bind their current digest to the preview for stale-change rejection.
- Reject an existing real `.ludory-components-backup-*` archive with conflicting/unsafe records instead of using recovery to suppress evidence of corruption.
- Bound history length/byte size; reject unsafely large or ambiguous evidence rather than improvising a best-effort chain.

## Persisted recovery authority

Successful apply writes **only** a new, canonical, private, host-owned `component-recovery-v1` checkpoint, separate from the game and from the Studio component trust pin. It contains the bound game path, physical root identity, creation/manifest/current-state SHA-256, history anchor commits and recovery digest. Use exclusive creation, secure file checks, locking and fsync; refuse replacement or disagreement.

`verifyOwnershipHistory()` may recognize this checkpoint **only as a bottom anchor for the exact recovered state** and only after asserting the host checkpoint plus unchanged ownership/hash invariants. Later genuine Studio updates must still produce their normal archives and retain their chain to this anchor. A checkpoint does not self-register component trust.

The owner must then run the existing `components trust` preview and explicitly accept its `stateSha256` on this host. Only after that may ordinary `components status/update` reach `IN_SYNC/READY`. If a host trust pin already exists but differs, recovery is blocked, not a re-pin operation.

## Verification / acceptance criteria

- TDD regression: unmodified transferred project at 1.2.4 with missing archives -> `CONFLICT` before recovery. Real Git fixture: verified 1.2.3 creation -> ownership-safe 1.2.4 update; preview `NEEDS_USER_ACTION`, explicit apply creates host-only checkpoint, separate `trust` acceptance and normal subsequent update succeed.
- Negative tests: invented or partial history; wrong SHA; modified managed bytes; missing/reordered/ambiguous transitions; source receipt mismatch; symlink/hardlink or path escape; author ownership regression; corrupted real archive; stale preview; existing contradictory host pin; checkpoint substitution; interruption/retry. All fail closed and leave game bytes untouched.
- CLI JSON/status documentation and a real-world runbook. No manual editing of `ludory.components.json`, historical receipts or generated game sources.
- `npm test`, `npm run check`, `node examples/core-session.mjs`, focused Studio/CLI tests and relevant GitHub CI must pass. Report platform-specific skips honestly.
- Deliver as a **separate Draft Ludory PR** based on merged `main`; do **not** merge without separate approval. Game PR #3 remains Draft and on 1.2.4 until the new procedure itself passes review and a genuine complete Git history is available for owner-approved recovery.

## Known limitation requiring explicit handoff

The available local game PR #3 clone contains only one synthetic snapshot commit. It cannot satisfy the proposed Git-history gate. A complete genuine Git checkout or genuine retained original Studio archives must be supplied before claiming successful recovery of the game. The framework PR can still be developed and tested on real locally constructed Git histories without touching the game.
