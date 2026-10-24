# `@ludory/studio` — metadata-only foundation

Node.js 22+. Run `node packages/studio/bin/ludory.mjs help` from this repository.

## Versioned manifest

Studio creates `ludory.project.json` in a game root using exactly the Core v1 definition:

```json
{
  "schemaVersion": 1,
  "id": "winter-story",
  "version": "1.2.3",
  "title": { "ru": "Зимняя история" },
  "engine": "phaser",
  "targets": ["yandex-games"]
}
```

`init`: existing **empty** target directory only. `migrate`: existing Starter Kit
`game-spec.yaml` schema 2 and `package.json` version. `inspect`: read-only view.
All commands default to preview; `--apply` exclusively creates a manifest.

Exit codes: `0` for successful read/preview/application; `1` for invalid arguments or operational errors; `2` for an explicit `BLOCKED`/`CONFLICT` plan.

## Migration guarantees and limitations

To apply to a mature game, both legacy metadata files must be tracked in HEAD,
have ordinary Git index flags (no `skip-worktree` / `assume-unchanged`) and be on
a clean worktree according to Git's checkout-filter-aware checks. The new manifest
cannot be ignored by Git. Changes between preview and apply are rechecked. Existing
manifest, SDK settings, game code, assets and saves are never rewritten.

The final exclusive write is bound to the validated directory through a
temporary process working-directory switch, with directory-identity checks
before and after creation. `applyPlan()` is synchronous and must not run
concurrently with code that changes the process working directory.

The strict YAML subset rejects ambiguous, missing or unsupported project
metadata (including scalar continuations, alternate key forms and nested
project structures outside `title`). Root document separators, quoted/explicit
root keys and continuations of `schemaVersion` are also blocked. Extra gameplay sections are ignored and
left unmodified. A blocked
case requires a manual decision; no inference of additional platform targets.

This slice is **not** the Starter Kit updater, a CEOS orchestration replacement,
a runtime, or a release/publishing pipeline. Those features require separate
behavioral parity validation before migration.
