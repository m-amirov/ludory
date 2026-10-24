# Ludory native development workflows — simplification decision (2026-10-24)

**Owner decision:** PR #6 must not reproduce the CEOS blockers: clean Git, immutable checkout path/HEAD, manual recovery of ambiguous sessions, and migration of historic CEOS runs. Existing games are frozen and remain untouched; future adoption, if requested, starts a fresh Ludory run without importing CEOS history. This decision supersedes the legacy-import requirements of `2026-10-24-native-ai-and-one-time-ceos-migration-design.md`; the native-foundation portions of that older design remain relevant.

## Approaches and decision

- **Reject: strict CEOS-like binding for every action.** Tracked/clean Git and fixed project inode/HEAD for read, continue, and evidence replay blocks ordinary game development.
- **Chosen: forgiving development workflow with strict publication of Ludory-owned files.** `doctor/status/next` are read-only even for dirty, unversioned, nested or moved games. Runs use stable game identity; each planned write still revalidates the current directory inode and canonical manifest. Checkpoint receipts retain the actual SHA-256 of evidence at the time of recording; old files need not remain byte-identical forever. Git details, if present, are diagnostic metadata, not development authority.
- **Deferred: separate production/release attestation.** A release validator will later demand current source, actual assets and host evidence before PASS. PR #6 must continue refusing an unverified Release PASS, but must not impose those release gates on routine development.

## Contract for PR #6

1. Starting a new generated game needs no Git init/commit; nested monorepo paths are allowed. Dirty state is reported, not treated as a workflow failure.
2. A committed run is readable after changes to source/art, new commits, and moving the project. Original event/receipt hashes and transition chain are still verified. Changed/missing current artifact bytes are not treated as tampering of their historical hash receipt. The user can append a new checkpoint with new evidence.
3. Writes are preview-first; changing the directory or manifest between planning and applying must still block. File operations remain relative to verified directory inodes; no writes can escape `.ludory/ai`.
4. A run copied into another *live*, independently located project cannot be silently claimed. Relocation from a path that no longer exists is supported for the same manifest ID. Cloned games should use distinct IDs for independent histories.
5. Ambiguous `latest` is never silently guessed. `status` lists active runs (ID, stage, status) and other commands offer these IDs in their blocker; no separate session manager.
6. `continue` is currently an action-request ledger, not an AI executor. No invented PASS, capability claims, or unnecessary extra stage/session/worktree abstraction.
7. No history importer, CEOS CLI adapter, edits to old game repositories, or automatic sunset. Reference source remains read-only.

## Acceptance

- Tests explicitly reproduce dirty/unversioned/new/nested project reads, post-commit continuation, move to another directory, old artifact changes, copied foreign store, ambiguous run IDs, and preview/apply races.
- `npm ci --ignore-scripts`, `npm test`, `npm run check`, Core example; GitHub Actions Node 22/24 on the exact new PR #6 HEAD.
- Windows/NTFS, live agents and Release PASS remain separate, visibly unverified gates.
