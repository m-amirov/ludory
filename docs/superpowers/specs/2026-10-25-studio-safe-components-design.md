# Studio-managed component updates — design

## Intent

Allow Ludory Studio to update its own template-generated files in **new Ludory games** without losing user modifications. Existing CEOS/Starter Kit games remain frozen; this is not project migration, release certification or automatic merge of user code.

## Chosen approach

Strict, opt-in-by-provenance management: new `ludory create` games receive a separate versioned `ludory.components.json` with template identity, source checksum, and SHA-256 of Studio-generated managed assets. Project-owned `package.json`, `AGENTS.md` and `game-spec.yaml` may be initially created by a template but are excluded from management. Historical `ludory.studio.json` remains a creation receipt, **not** updater authority. Games without the new components state are BLOCKED. Components never claim ownership of the manifest, saved games, art, rights, configuration, or user-created files.

Alternatives considered: three-way merging of modified files (rejected for MVP: ambiguous and error-prone), and wholly separate immutable runtime bundles (deferred: needs template/runtime redesign).

## Behavior

- `ludory components status` and `ludory components update` are read-only. `update --apply` writes only after reviewing READY.
- Verify canonical project directory, valid game manifest and owned component state; reject symlinks, hard-linked files, unsafe paths, missing/modified managed files, foreign collision paths, removed template file paths, engine/target/profile incompatibility.
- Reject downgrade and source edits without SemVer increment. A higher compatible template version can update unchanged files and add non-colliding files inside existing physical directories. No automated deletions or path moves.
- If **any** managed file differs from its recorded SHA-256, the entire update is CONFLICT, including when the catalog is unchanged.
- Apply recomputes the complete plan and catalog bytes, verifies directory identity, takes an exclusive lock, and stages updates in the game directory. Original inodes are preserved in persistent `.ludory-components-backup-*` archives even after a successful update or clean rollback, because writers may still have open file handles. On a synchronous failure roll back owned replacements, retaining anything modified concurrently for manual recovery. Unresolved rollback is clearly BLOCKED, not PASS.
- Successful apply advances the standalone components state. No automatic workflows, migrations, profile switches, host SDK changes, publishing, or release claims.

## Limitations

MVP is a synchronous local filesystem operation; it does not provide a Windows Job Object, global multi-process transactions, or guaranteed crash-atomic commits across arbitrary game files. Concurrent editing during apply is unsupported; retained backup archives are not automatically cleaned and can grow over time. A crash can leave a lock and staged backup requiring owner inspection. External catalogs are still local-only and explicitly selected. Do not run this command against the frozen legacy games.

## Acceptance

New Studio projects declare managed template file hashes; preview is mutation-free; changed files block the entire transaction; clean higher-version updates succeed and record new hashes; same-version drift, downgrade, collisions, symlink traversal, stale plans and injected apply failure fail safely; tests and CLI documentation cover these cases.
