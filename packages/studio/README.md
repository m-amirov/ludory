# `@ludory/studio` — metadata, templates, profiles and CEOS workflow adapter

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

## Profiles and templates (new projects only)

Profile declarations specify a web engine, allowed targets and compatible templates.
Built-in profiles are `web-game` and optional `narrative-game`; built-in templates
are `web-basic` and `narrative-basic`. The demos work in a regular browser but
do **not** contain VK/Yandex SDK integrations or claim host compatibility tests.

```sh
node packages/studio/bin/ludory.mjs profiles list --json
node packages/studio/bin/ludory.mjs templates show --name narrative-basic

# Preview: creates nothing.
node packages/studio/bin/ludory.mjs create --project /path/to/empty-dir \
  --id my-story --title 'Моя история' --lang ru \
  --profile narrative-game --template narrative-basic --targets yandex-games,vk-games

# Only after reviewing the preview:
node packages/studio/bin/ludory.mjs create --project /path/to/empty-dir \
  --id my-story --title 'Моя история' --lang ru \
  --profile narrative-game --template narrative-basic --targets yandex-games,vk-games --apply
```

`create` requires an **existing empty** directory. It writes
`ludory.project.json`, template files and `ludory.studio.json`, a receipt
containing source versions and output SHA-256 hashes. It never updates an
existing game. Previews are read-only, and apply rechecks directory identity,
catalog source checksums and output collisions. In-flight failures trigger
best-effort rollback only of unchanged files created by the current command.

External local catalogs are explicit with `--catalog /path/to/catalog`, and
must contain `profiles/<id>.json` and `templates/<id>/template.json` plus
static assets named in the template descriptor. JSON schema version is `1`.
The CLI validates references, paths, uniqueness and symlinks, and external
catalog entries cannot replace built-ins. Nothing is downloaded or executed
while browsing templates. The receipt is **not** an updater authority.

## Applying profiles to existing games

Existing games with a valid `ludory.project.json` can opt into a compatible
profile without modifying the game itself. The profile must explicitly match
the game's engine and support all its target platforms. The built-in profiles
are for `web` games; existing `phaser` projects need an explicitly selected,
compatible external profile until Phaser profiles are delivered.

```sh
# These first commands are read-only previews.
node packages/studio/bin/ludory.mjs profiles apply \
  --project /path/to/existing-web-game --name narrative-game --json

# After reviewing READY, make exactly the profile-management changes.
node packages/studio/bin/ludory.mjs profiles apply \
  --project /path/to/existing-web-game --name narrative-game --apply --json

# Inspect managed state, check whether a newer catalog version is available.
node packages/studio/bin/ludory.mjs profiles status \
  --project /path/to/existing-web-game --json
node packages/studio/bin/ludory.mjs profiles update \
  --project /path/to/existing-web-game --json

# Only for a higher compatible profile version and after reviewing READY:
node packages/studio/bin/ludory.mjs profiles update \
  --project /path/to/existing-web-game --apply --json
```

For an external profile, append `--catalog /path/to/catalog` consistently to
`apply`, `status` and `update`. A missing profile, incompatible engine or target,
unexpected file, modified managed state, same-version content change or
downgrade blocks application. There is no `--force` or automatic conflict
resolution. Stop and inspect the stated conflict before trying again.

Profile management stores **only** declarative state in `.ludory/profiles/`:
the initial `active.json`, SHA-256-addressed immutable `snapshots/`,
append-only `revisions/00000001.json`, `00000002.json`, ... and retained
previous states in `history/`. **The latest validated revision is authoritative**;
`active.json` alone shows only the initial installation after upgrades.
Writes use exclusive file creation, recheck project and catalog bytes before
publication, and atomically link a complete new revision **without replacing
any existing filename**. This requires hard-link support on the project
filesystem (for example NTFS); a filesystem lacking that capability fails
closed. During a write, `.lock` blocks other Studio operations.
If the process crashes and leaves a lock, incomplete file
or inconsistent state, Studio blocks until the owner investigates; it never
blindly adopts or removes the residue. Use the Git history and/or an intact
`.ludory/profiles/history/<previous-state-sha>.json` to recover the previous
pointer after verifying the state and stopping other writers.

No code, engine configuration, browser SDK, existing template file, artwork,
save data, rights manifest, `AGENTS.md`, `game-spec.yaml`, `package.json` or
`ludory.studio.json` is modified by these commands. The PR #3 creation receipt
is historical provenance, **not** evidence of safe ownership for editing
old template files. Applying a profile does not enable its validators or
establish VK/Yandex runtime or release compliance. Replacing the Starter Kit
and CEOS updater remains a later stage requiring behavioral parity tests.

## CEOS workflows through the unified CLI

Studio has a bounded adapter to the **existing CEOS 0.5.40 CLI**. It is not a native CEOS port: the installed CEOS owns workflows, recovery, `.ceos-runs`, `.codex-os` and evidence gates. The adapter requires an already valid `ludory.project.json`; this file and all existing game files remain unchanged by Ludory workflow commands. CEOS itself may modify its run/evidence files when you authorize a mutating operation.

Every command accepts `--project DIR`, optional `--json`, and `--ceos-entry /absolute/path/to/bin/ceos.mjs`. If the entry flag is missing, Studio uses `LUDORY_CEOS_ENTRY`, then the npm-global CEOS package. It verifies the package name, `VERSION` and exact `0.5.40` pin. A missing entry, old version or stale Windows npm junction blocks execution; Studio never reinstalls or repairs CEOS automatically.

| Studio command | CEOS action | Execution semantics |
| --- | --- | --- |
| `workflow doctor` | `doctor` | Immediate, read-only |
| `workflow status [--run ID]` | `run-status ID\|latest` | Immediate, read-only |
| `workflow next [--run ID]` | `continue ID\|latest --mode inspect` | Immediate, read-only |
| `workflow start` | `run audit-repair-loop\|production-art` | Plan only; requires `--apply` to run |
| `workflow continue [--run ID]` | `continue --mode inspect` (preview), `--mode guided` (apply) | Guided mode requires `--apply`; no `auto` mode |
| `workflow checkpoint --stage STAGE [--run ID]` | `checkpoint` | Plan only; requires `--apply` to run |

```sh
# Inspect CEOS health, run state and next safe action.
node packages/studio/bin/ludory.mjs workflow doctor --project /path/to/game --json
node packages/studio/bin/ludory.mjs workflow status --project /path/to/game --run latest --json
node packages/studio/bin/ludory.mjs workflow next --project /path/to/game --run latest --json

# Bounded run: first preview; then only after explicit human decision add --apply.
node packages/studio/bin/ludory.mjs workflow start --project /path/to/game \
  --pipeline audit-repair-loop --target 'EP3 QA' \
  --in-scope 'S24;S25' --out-of-scope 'S19;S20' \
  --acceptance 'QA scope accepted' --mutation-boundary 'Evidence for S24 and S25' --json

# Continue only inspects unless --apply enables guided CEOS continuation.
node packages/studio/bin/ludory.mjs workflow continue --project /path/to/game --run latest --json

# Checkpoint preview then append --apply only with verified artifacts and outcome.
node packages/studio/bin/ludory.mjs workflow checkpoint --project /path/to/game \
  --run latest --stage QA_REVIEW --artifact 'reports/qa.json' --outcome CONTINUE --json
```

The `--pipeline` value is restricted to `audit-repair-loop` and `production-art`; `--stage`, run IDs, artifact paths and flag names are validated. Text fields are passed as literal arguments, not shell commands. Unknown flags, duplicates and `--apply` on read-only operations are rejected. CEOS produces JSON; Studio includes it unmodified under `ceos`, alongside `ceosExitCode` and `status` (`OK`, `READY`, `APPLIED`, `BLOCKED`, `ESCALATE` or `FAILED`). Exit codes: `0` for successful inspection/preview/CEOS success; `1` for invalid CLI/CEOS transport or CEOS failure; `2` for CEOS blocked; `3` for CEOS escalation. A preview `READY` is not a run or PASS. No automatic retries of potentially mutating CEOS actions.

The adapter's executable input is **trusted locally installed CEOS code**. Real CEOS still needs its own valid configuration (`.codex-os/project.yml`), which CEOS validates independently. `ludory.project.json` and that CEOS file describe different aspects of a project; no game-ID equality is inferred. Windows-host compatibility, live pinned-CEOS behavior, platform runtime and release gates still need independent real-host verification. If CEOS is unavailable, use the original CLI and do not claim the Ludory integration passed its host smoke.
