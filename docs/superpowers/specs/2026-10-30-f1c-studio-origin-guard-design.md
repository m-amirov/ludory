# F1c — Trusted Studio origin for native AI mutations

**Status:** Approach B selected by owner on 2026-10-30; detailed implementation contract awaits owner approval. **Base:** `main` at merge PR #47, `468bbfa4aad76f8bfc9be95156757a391c59080e`. **Scope:** new games created by Studio only; legacy/production game repositories remain frozen.

## Intent, success and non-goals

Prevent native AI workflow commands from writing to a foreign, copied, migrated or legacy project whose local `ludory.project.json` and `ludory.studio.json` happen to look valid. The root defect is that `workflow start --apply` and several manual event/recovery paths have no Studio-origin gate; other AI operations trust a locally forgeable creation receipt. A real Studio-created game, including one with dirty or absent Git metadata, must still work.

- **In scope:** shared, host-registered Studio provenance; all AI mutations through the CLI **and** exported APIs; read-only previews; rechecks immediately before filesystem writes and host execution; regression and Windows/Linux CI evidence; operator guidance.
- **Out of scope:** writing, scanning or migrating frozen games; auto-registering old projects; CEOS imports; remote/portable trust synchronization; platform release or external Web DEV attestations.
- **Anti-goals:** a locally copied JSON marker granting write access, silent trust repair, hidden paid or free Web requests, false release PASS, and requiring a clean Git tree for a new Studio game.

## Approaches considered

| Approach | Benefit | Defect / tradeoff | Decision |
| --- | --- | --- | --- |
| A. Check `ludory.studio.json` in every workflow command | Small code change | Marker can be copied or forged; existing AI code already demonstrates the weakness | Rejected |
| **B. Require independent host trust registered by Studio create** | Root identity, creation files and managed component state are bound to one physical project; no implicit migration | Moving a game to another host requires explicit future re-trust workflow | **Selected** |
| C. Restrict only the Studio CLI entrypoint | Little API refactoring | Direct AI package callers bypass the guard | Rejected |

## Technical contract

1. **One source of trust.** Reuse the already deployed host-owned trust store from `packages/studio/src/component-trust.mjs` (schema v1, secured per-user directory, canonical record, file SHA-256 and root device/inode). Extract the existing implementation into a narrowly scoped internal package without new third-party dependencies, e.g. `@ludory/studio-trust`, so Studio and AI share the same verifier without a Studio → AI → Studio package cycle. Retain the Studio module's exported API as a compatibility re-export. Do not create a second authority or rewrite existing trust records.
2. **Verification.** Resolve the project as a physical canonical directory; read its `ludory.studio.json`, `ludory.project.json`, `ludory.components.json` as bounded regular files with no symbolic-link traversal and stable descriptors; compare exact SHA-256 bytes and root identity against the independently registered host record. The trust check is read-only. A missing record, mismatched creation files, modified managed state, moved root or unsafe registry is an explicit `BLOCKED`/conflict with a stable reason, never a hint to self-register.
3. **Mutating AI routes.** `workflow start`, `continue` (manual and Codex), `checkpoint`, `cycle`, `recover`, `recover-storage --apply` must require trusted origin before any write. Apply the same origin rule to draft, image import, independent narrative/art review, quality mutations and any other AI API that writes state or initiates host work. The exported `hasStudioCreationReceipt` must no longer be sufficient by marker shape alone; all direct paths must use the shared verifier. An invalid preview returns a blocked result where the existing API uses results, with no `.ludory` creation or subprocess; an invalid `--apply` must fail closed even if a plan was created while the project was trusted. A forged/tampered in-memory plan cannot bypass the guard.
4. **Read-only access.** `workflow doctor`, `status`, `next`, native store diagnostics and component inspection stay available on preexisting projects; they must not silently mutate user files. `recover-storage` inventory may remain read-only for diagnosis, but applying recovery requires verified trust and the existing explicit executor-stopped confirmation. Do not relabel a foreign project as Studio-owned merely to permit recovery.
5. **User edits and existing state.** Ordinary game source changes, dirty Git, and no Git repository do not invalidate origin. Tampering with pinned Studio receipt, manifest or component-state bytes does invalidate it; legitimate Studio component updates must advance the existing host pin according to their current contract. No automatic repair or migration on a different PC; expose a clear `TRUST_MISSING` blocker and future opt-in instructions.
6. **Revalidation and boundaries.** Verify on planning before offering a mutating action, again at the point of apply/host submission, and use existing store/source root pinning for the write itself. Preserve recognized crash remnants and append-only evidence; never erase a run simply because provenance is unavailable. Reject changed project path/identity, symlinks or hard-linked local receipts/registry records. No new network dependency, OpenAI API or paid service.

## Acceptance matrix and release constraints

- A foreign project with only a valid game manifest, one with a forged `ludory.studio.json`, and one with a copied Studio receipt **cannot** start, continue, checkpoint, recover, import an image, or initiate a Web review. Assert before/after full-tree hashes, including user files and absence of new `.ludory` files.
- A Studio-created fixture with a real host registry can start/continue/checkpoint and use existing AI preview paths. Dirty and unversioned fixtures are each exercised. `doctor/status/next` and non-applying recovery previews remain non-mutating for foreign projects.
- A trusted preview applied after receipt/registry/state/root-path substitution is refused before any write or external executor invocation. On Windows, cover reparse-point/path-swap cases that test infrastructure can actually simulate; untested NTFS power-cut guarantees are not claimed.
- Existing AI native-workflow fixtures that construct fake local Studio receipts must be updated to create actual Studio-owned fixtures or use low-level internal store contracts for tests that intentionally cover foreign state; no test-only production bypass.
- Run a failing regression first, then the focused tests, `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`, exact-HEAD Windows/Linux CI, and independent review. A PR may be proposed, but **not merged without fresh owner approval**.
- Host Web DEV, ImageGen, real devices, platform SDK and Release evidence remain `BLOCKED`/`NOT_RUN` unless actually observed. This F1c gate is provenance only and does not imply F1/F2–F6 or Ludory 1.0 PASS.

## Implementation discretion / open decisions

The engineer may choose the shared package's internal export names, stable blocker codes and fixture helpers without changing existing trust format or published CLI shape. Any need to support cross-host trust adoption, old native runs or profile/manifest rewrites exceeds F1c and requires separate owner authorization.
