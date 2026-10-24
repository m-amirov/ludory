# Ludory Studio foundation design

## Intent and approach

Introduce one low-risk CLI and one common game-project manifest while keeping existing CEOS, Starter Kit and mature-game runtime untouched. `@ludory/core` is the schema validator. Studio initially acts as a **metadata adoption coordinator**, not an executable replacement for upstream installers or a game renderer.

Chosen: separate `@ludory/studio` workspace package and `ludory` CLI inside the monorepo. Alternative wholesale imports of both upstream CLIs were rejected because their ownership and evidence contracts differ. Alternative in-place rewrite of old `game-spec.yaml` was rejected due to mature-project ownership and YAML complexity.

## Version-1 manifest

File: `ludory.project.json` in game project root. Fields are exactly the Core `defineGame()` fields: `schemaVersion:1`, slug `id`, SemVer `version`, localized `title`, `engine`, unique `targets`. No hidden SDK readiness or release certification flag. `game-spec.yaml` stays unchanged and authoritative for legacy game-specific settings.

## User-facing commands

- `ludory inspect --project <dir> --json`: read-only look at canonical manifest or legacy candidate and blockers.
- `ludory init --project <empty-existing-dir> --id <slug> --title <text> --lang ru --engine phaser --targets yandex-games,vk-games [--apply] [--json]`: preview by default; explicit `--apply` creates only new canonical manifest.
- `ludory migrate --project <existing-game> [--apply] [--json]`: preview legacy `game-spec.yaml` mapping; apply only on an unchanged, clean Git repository and no conflicts.
- `ludory help`: stable usage. Unknown flags and ambiguous inputs are errors.

No command writes by default. No command deletes, overwrites, checks out Git, changes remote branches, invokes platform SDKs, installs dependencies or runs release checks. All `--apply` writes use exclusive file creation and revalidation of source bytes/HEAD. `ludory init` requires an existing empty directory; `migrate` requires an existing legacy spec and does not infer unobserved VK support.

## Legacy parser boundary

Support only unambiguous Starter Kit `game-spec.yaml` schemaVersion 2 with `project.slug`, localized `project.title`, `project.engine` and `project.platform` scalar values; read project `package.json` SemVer as version. Reject missing/multiple fields, unsupported YAML constructs in these fields, missing version, conflicting canonical manifest, symbolic links, dirty/non-Git application, ignored/untracked source files, non-ordinary Git index flags (`skip-worktree` / `assume-unchanged`) and changed source/HEAD between planning and applying. Use Git's checkout-filter-aware cleanliness semantics so legitimate LF/CRLF conversion does not produce a false conflict. The newly created manifest must not be Git-ignored. Do not parse or change unrelated game content/ads/localization sections.

If a legacy spec cannot be safely mapped, return `BLOCKED` with exact reason and ask for manual manifest authoring in a later scope. `migrate` never silently invents additional targets, a game engine, a version or title.

## Compatibility and failure contracts

- The existing project and all legacy files remain byte-identical after dry-run, BLOCKED and apply; only `ludory.project.json` may be added on successful apply.
- A second run returns `IN_SYNC`; different existing canonical metadata yields `CONFLICT` and no writes.
- Reject reparse/race/symlink destinations and changed source checksum or Git HEAD between plan and apply. For the synchronous CLI, bind the exclusive write to the validated directory inode using a temporary process CWD and verify its identity before/after writing; reject unexpected directory moves without redirecting writes to a replacement symlink.
- No existing versioned project must adopt new code or rules just because its manifest was created.
- Use Node.js >=22, ESM, built-ins and local `@ludory/core`; no third-party runtime dependency.

## Acceptance

Real temp-project fixtures for clean/mature/dirty/ambiguous/symlink cases, red-green regression coverage, CLI exit codes/output, Node 22/24 CI and a clean PR. Upstream feature-parity status remains `NOT_MIGRATED` after metadata adoption.
