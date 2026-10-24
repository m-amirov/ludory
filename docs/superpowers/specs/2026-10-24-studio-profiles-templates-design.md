# Ludory Studio: game profiles and templates — design

## Intent

Introduce predictable, versioned game profiles and reusable starter templates for **new games**, with a single Studio CLI and an explicit dry-run/apply boundary. Existing games, the CEOS adoption contract, Starter Kit's updater, and platform release checks remain outside this phase.

## Approaches considered

1. **Chosen: staged catalog and new-project scaffolding.** Built-in and explicitly selected local catalogs describe profiles/templates; `create` produces a new project only in an already existing empty directory. Low-risk, independently testable, with receipts for a future updater.
2. Full installation/update of profiles into mature projects. Deferred until ownership-aware file merging, rollback, and CEOS/Starter Kit behavioral parity are implemented.
3. Metadata-only profile selection. Rejected as insufficient: it would not give a developer reusable runnable project templates.

## Terminology and boundaries

- **Profile:** versioned declarative game type and allowed engine/target/template combinations. Initial built-ins: `web-game` and optional `narrative-game`. Profiles express local capabilities, **not** host certification.
- **Template:** versioned deterministic set of project files. Initial built-ins: `web-basic` (minimal browser interaction), `narrative-basic` (minimal browser-based branching dialogue). Both are local web demonstrations; they do not claim SDK, advertisement, monetization, or marketplace readiness.
- The canonical `ludory.project.json` remains exactly the existing Core v1 manifest: no breaking `profile` or `template` fields are added.
- A separate `ludory.studio.json` records profile ID/version, template ID/version, catalog provenance and managed-file SHA-256 hashes. This is an informational **creation receipt**, not yet authority to update or overwrite those files.

## CLI interface

- `ludory profiles list [--catalog <directory>] [--json]`
- `ludory profiles show --name <id> [--catalog <directory>] [--json]`
- `ludory templates list [--catalog <directory>] [--json]`
- `ludory templates show --name <id> [--catalog <directory>] [--json]`
- `ludory create --project <empty-dir> --id <slug> --title <name> --lang <locale> --profile <id> --template <id> --targets <ids> [--version <semver>] [--catalog <directory>] [--apply] [--json]`

The existing `init`, `inspect`, `migrate` CLI contracts are preserved; `create` alone scaffolds files. All listing/inspection operations are read-only; creation is a dry run unless `--apply` is specified. A `--catalog` directory is explicitly selected and never implicitly discovered from a game project. An external catalog may **add** IDs but must not override built-ins. No download, package installation, code execution or arbitrary template scripting occurs during catalog reading or creation.

## Data and compatibility

- Catalog schemas are versioned JSON and strictly validated: unknown fields, malformed IDs, conflicting IDs, duplicate output paths, unsupported engines/targets, missing files and ambiguous template/profile combinations fail closed.
- Profiles and templates each declare compatible engine, targets and profile IDs. `create` validates the entire combination before planning writes and does not silently add a platform target. Template content is static, with user values written only to structured JSON output through JSON serialization (not interpolated into executable code or HTML).
- Generated paths are relative, normalized and confined to the project root. Reject symlinks, absolute paths, parent traversal, reserved `ludory.project.json` and `ludory.studio.json` collisions, and links escaping an external catalog. All source file hashes are captured before apply and rechecked.
- Built-in templates are deliberately small, dependency-free, and usable as local browser demos. Games need a later Connect/Runtime/Release phase before they can be certified for VK or Yandex.

## Safety and failures

- New projects only: existing real empty directory required; non-empty roots, symlinks, changing root identity, source changes and any output collision are blocked.
- Preview outputs complete file list, compatibility decision, and blockers without writing; `--apply` revalidates the plan, creates files exclusively, and reports exact results.
- On an apply failure, roll back **only** files created by that invocation whose content hashes are unchanged, and report any unrecoverable residue. Do not touch project-owned files or attempt to mutate Git repositories, legacy configurations, or release state.
- Template receipts capture exact generation hashes; later ownership-aware updater behavior is a separate feature and release gate.

## Acceptance checks

1. Profiles/templates can be listed and inspected deterministically, including optional local catalogs, without writes.
2. A matching profile/template creates a runnable minimal example, canonical Core v1 manifest and creation receipt; preview writes nothing.
3. Invalid profile/template/targets combinations, malformed catalogs, traversal/symlinks, non-empty roots, changed sources and destination collisions block before writing.
4. Existing Studio commands and metadata-only migration remain backward-compatible; tests cover failure rollback and CLI exit codes.
5. `npm test`, `npm run check`, `node examples/core-session.mjs` and Node 22/24 CI pass. No platform or release certification is inferred.
