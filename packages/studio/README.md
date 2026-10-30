# `@ludory/studio` — metadata, templates, profiles and native AI workflows

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

The legacy metadata `migrate` command is retained for compatibility; the owner has frozen all existing game projects, so do not run it against them during Ludory development. No CEOS state/history importer is planned.

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

The legacy metadata-only `migrate` slice is **not** the Starter Kit updater,
a CEOS orchestration replacement, a runtime migrator or a release/publishing
pipeline. Studio's separate `runtime-basic` template is for **new** games only.
Those features require independent validation before any legacy adoption.

## Safe managed component updates (new Studio games only)

Every `create --apply` now writes a dedicated `ludory.components.json` ownership
record for eligible Studio-generated template assets. It excludes
`package.json`, `AGENTS.md`, `game-spec.yaml`, `ludory.project.json`,
`ludory.studio.json`, `.ludory/**`, hidden paths (`.env`, `.github/**`),
`rights/**`, `saves/**`, `evidence/**`, user config and transaction metadata.
The older creation receipt is informational **and cannot grant update ownership**.
The updater additionally verifies the new state against the narrow original
receipt and retained `component-transition.json` proofs. **Authority comes
from a Studio-controlled host trust registry outside the game directory.**
It pins the exact game path, directory identity, creation receipt, original
manifest and latest component state SHA-256, and advances only on successful
Studio updates. Forging a project-local archive and state cannot add ownership
without matching this independent pin. This protects against *project-only*
tampering, not a process with write access to the user's host state directory.
By default the registry is under `%LOCALAPPDATA%/ludory/studio/component-trust-v1`
on Windows and `$XDG_STATE_HOME/ludory/studio/component-trust-v1` (or
`~/.local/state/ludory/studio/component-trust-v1`) on Unix. A host-configured
`LUDORY_STUDIO_TRUST_DIR` may override that location; a path inside the game
is refused. If the registry is missing or altered, updates fail closed.
Treat archive corruption as a stop condition.
Games created
before this dedicated record existed, including frozen projects, are `BLOCKED`;
there is no implicit adoption or bulk migration.

```sh
# Read-only, including for a dirty or unversioned new game:
node packages/studio/bin/ludory.mjs components status --project /path/to/new-game --json
node packages/studio/bin/ludory.mjs components update --project /path/to/new-game --json

# After examining the exact changed-file list and any conflict:
node packages/studio/bin/ludory.mjs components update --project /path/to/new-game --apply --json

# On another PC/host, after inspecting every listed managed path and its bytes:
node packages/studio/bin/ludory.mjs components trust --project /path/to/copied-game --json
# Copy the exact stateSha256 from the preview; acceptance is not automatic:
node packages/studio/bin/ludory.mjs components trust --project /path/to/copied-game --accept-state-sha256 <exact-64-hex-from-preview> --apply --json
```

`components trust` is an explicit owner grant on a new host, **not** proof that
copied project metadata is authentic. Review the source and all listed managed
paths before accepting. An existing host pin cannot be replaced through this
command, including if the pin disagrees with the game. A crash between game
publication and host registry publication may require operator recovery; never
automatically re-anchor a mismatched host pin.

Use `--catalog /path/to/catalog` for an explicitly installed local catalog.
Only a strictly newer compatible template can be applied; same-version drift,
downgrades, removed paths, unsupported profile/engine/targets, edited or missing
managed files, symlinks, hardlinks, new-path collisions and a stale preview
block the operation. Existing owner files and author-owned assets are not
updated during honest operation. Even valid changes to the game manifest are
conservatively blocked until its creation-time compatibility can be reviewed;
Studio never reclaims project-owned metadata. The command never performs a
three-way merge, deletion or `--force`.

Apply uses an exclusive `.ludory-components.lock`, same-filesystem staging and
physical-path checks. Original file inodes are retained under
`.ludory-components-backup-*` **even after a successful update**, because an
editor may still hold an open file descriptor. Do not delete these archives
until edits through old handles have been reconciled; newer component status
also depends on the archived ownership chain. Stage files and receipts are
flushed with `fsync` on writable file descriptors. On POSIX, affected directory
entries are also `fsync`ed, and errors block apply. Node does not reliably
support directory `fsync` on Windows, so this additional directory flush is
not attempted there; NTFS power-loss durability of directory entry changes is
not independently established. State/pin mismatch after interruption must
block future updates until inspected. On an incomplete rollback
the lock and archive remain for human recovery; inspect `backup-index.json`,
affected paths and any quarantine entries before correcting state. On Windows,
all archive slots are flat files (`new-0`, `backup-0`, `quarantine-0`, etc.)
under a Win32-native protected archive directory because NTFS permits moving
some normally-open child directories; on POSIX, use the `new/`, `backup/`,
`quarantine/` directories. Windows apply requires a native N-API module built
with `npm run build:windows-pin` (Node 22.9+ for node-gyp 12.4, MSVC build
tools including Visual Studio 2026). The general Ludory runtime permits older
Node 22 releases, but Windows native component apply does not. The
module now requests read-only sharing, denying both directory writes (including
in-place reparse-point creation) and delete sharing. This stricter setting is
under native CI verification for legitimate child operations. Without a
successfully loaded and identity-checked module, Windows
apply must refuse the operation; ordinary Node directory descriptors do not
pin NTFS pathnames. The Windows native build is an explicit prerequisite and
is run in GitHub CI, not automatically installed on unverified hosts.
Codex can check the native capability without modifying the game or building
code: `ludory components native --json` returns `READY` only after acquiring
and releasing a real native directory handle, `BLOCKED` with a precise build
command if Windows setup is missing, or `NOT_REQUIRED` off Windows. Build
once from the trusted Ludory checkout using `npm run build:windows-pin`, then
repeat the doctor. The loader requires `pinContractVersion=3` on every use;
stale `.node` files from earlier metadata-only builds fail closed even if
they still load and expose the same functions. Rebuild after updating the
native source. Do not use a downloaded or unverified `.node` binary;
automated signed/prebuilt distribution is **not yet supported**.
Never force-remove a lock while another update may still be running. Disk-full,
file-sharing, unsupported hardlink/rename and other filesystem failures are
visible blockers, not successful updates. On Windows, inspect the actual CI
result before relying on NTFS behavior; Linux-only checks do not certify it.

Exit code: `0` successful preview/IN_SYNC/apply; `2` explicit conflict/blocker;
`1` invalid command or unrelated operational failure. JSON preserves status,
planned paths, conflict details and the backup directory on success.

## Profiles and templates (new projects only)

Profile declarations specify a web engine, allowed targets and compatible templates.
Built-in profiles are `web-game` and optional `narrative-game`; built-in templates
are `web-basic`, `narrative-basic`, opt-in `narrative-interactive` and `runtime-basic`.
The basic story is a standalone click-through; `narrative-interactive` bundles
the complete N1/N2 graph engine and DOM Runtime with local art, photo/keepsake
interactions, finite guided messages, authored reactions, delayed echoes,
relationships, route locks, endings, RU/EN, journal, save/restore and replay.
It uses no backend, runtime AI or external CDN. `runtime-basic` uses the locally
bundled `@ludory/runtime` Core host, with browser-smoke coverage. None contains VK/Yandex SDK integrations
or proves platform compatibility.

To create an interactive story, use `--profile narrative-game` and
`--template narrative-interactive` for preview, then add `--apply` after checking the file
list. Serve the generated directory through local static HTTP or VK/Yandex
hosting, not `file://`: the browser loads the Studio-generated
`ludory.project.json` from the same origin. Edit `src/story.js` and provide
actual local images, then revalidate scenario logic before release. The
source-bound `narrative-assets.json` proof is produced at template-build time
and checked by Studio before preview/apply; it binds the authored source and
the local image hashes without executing the template code during creation. All
messages are authored combinations, not free-form player input. The sample
art is only a demo; custom projects must review their own rights, content and
age ratings. `npm run check:narrative-template` checks that the source-bound
bundle committed to this repository is current. No existing game is rewritten.

```sh
node packages/studio/bin/ludory.mjs profiles list --json
node packages/studio/bin/ludory.mjs templates show --name narrative-basic
node packages/studio/bin/ludory.mjs templates show --name narrative-interactive

# Preview: creates nothing.
node packages/studio/bin/ludory.mjs create --project /path/to/empty-dir \
  --id my-story --title 'Моя история' --lang ru \
  --profile narrative-game --template narrative-interactive --targets yandex-games,vk-games

# Only after reviewing the preview:
node packages/studio/bin/ludory.mjs create --project /path/to/empty-dir \
  --id my-story --title 'Моя история' --lang ru \
  --profile narrative-game --template narrative-interactive --targets yandex-games,vk-games --apply
```

`create` requires an **existing empty** directory. It writes
`ludory.project.json`, template files and `ludory.studio.json`, a receipt
containing source versions and output SHA-256 hashes. It never updates an
existing game. Previews are read-only, and apply rechecks directory identity,
catalog source checksums and output collisions. In-flight failures trigger
best-effort rollback only of unchanged files created by the current command.

To exercise the Runtime MVP in a new **web** game, preview and apply with
`--profile web-game --template runtime-basic` instead of the narrative example.
Serve the resulting directory over HTTP, not `file://`. `runtime-basic` ships
its own local browser ESM file; `create` does not install packages or fetch a CDN.
It demonstrates manual save/restore, normalized input, audio and lifecycle, but
is not a Phaser game or a platform SDK integration. See
[`@ludory/runtime` setup](../runtime/README.md) and the
[R7 technical acceptance](../../docs/audits/2026-10-29-runtime-r7-acceptance.md).

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

## Native workflows through the unified CLI

The `ludory workflow` family executes through `@ludory/ai` **inside Ludory**. It neither searches for CEOS nor invokes an external CEOS executable. A valid `ludory.project.json` is required; Git is optional for development. Native runs and SHA-bound append-only checkpoint events live exclusively under `.ludory/ai/`. Existing games are frozen and must not be connected yet.

| Command | Native behavior | Execution semantics |
| --- | --- | --- |
| `workflow doctor` | Manifest + optional Git diagnostics | Immediate, read-only, works on dirty/unversioned projects |
| `workflow status [--run ID]` | Native run replay and integrity; list active IDs when ambiguous | Immediate, read-only |
| `workflow next [--run ID]` | Next stage/action or blocker | Immediate, read-only |
| `workflow start` | New scoped `audit-repair-loop` or `production-art` | Plan; `--apply` creates run |
| `workflow continue [--run ID]` | Manually request the next stage action | Plan; `--apply` records `ACTION_REQUESTED` |
| `workflow continue --executor codex [--run ID]` | Run one Codex CLI task in a **new Studio-created game** | Preview has no effects; `--apply` runs Codex and records execution result, never Release PASS |
| `workflow cycle --test src/main.test.js [--repairs 0\|1\|2] [--run ID]` | Bounded Codex task + sandbox-observed Node test, max two retries | Preview only by default; `--apply` appends a request/result pair per attempt; no automatic stage advancement |
| `workflow recover [--run ID]` | Resolve an interrupted pending Codex request | Preview only until `--confirm-no-executor --apply`; appends a failed `EXECUTOR_INTERRUPTED` result |
| `workflow checkpoint --stage STAGE [--run ID]` | Append user-supplied artifact snapshots | Plan; `--apply` appends one event (blocked during pending Codex execution) |

```sh
node packages/studio/bin/ludory.mjs workflow doctor --project /path/to/game --json
node packages/studio/bin/ludory.mjs workflow start --project /path/to/game \
  --pipeline audit-repair-loop --target 'EP3 QA' \
  --in-scope 'src;tests' --acceptance 'Scope verified' \
  --mutation-boundary 'Report evidence only' --json
# Review READY, then repeat the same command with --apply to persist a new run.
node packages/studio/bin/ludory.mjs workflow status --project /path/to/game --run latest --json
node packages/studio/bin/ludory.mjs workflow next --project /path/to/game --run latest --json
node packages/studio/bin/ludory.mjs workflow continue --project /path/to/game --run latest --json
# Once the evidence file really exists, preview then apply its checkpoint:
node packages/studio/bin/ludory.mjs workflow checkpoint --project /path/to/game \
  --run latest --stage EVIDENCE_COLLECTED --artifact 'reports/qa.json' --outcome CONTINUE --json
```

Read-only operations reject `--apply`. All other workflow mutations require it, with current manifest/inode and new evidence hash revalidation. Git edits and new commits do not block development or destroy historical run state. Run/event receipts are append-only through Ludory's API; changing source or art afterward does not retroactively corrupt their recorded SHA-256, but a privileged writer could rewrite the entire unauthenticated chain. Unknown flags and former `--ceos-entry` are rejected. JSON reports `engine: ludory-ai`, status, run ID and the next action, never CEOS exit codes. Exit code `0` means a successful inspection/preview/native operation, `1` an invocation error, `2` a native blocker. Multiple active runs are listed by `status`; specify `--run ID` to advance exactly one.

**Executor MVP:** Add `--executor codex` to `workflow continue` to opt into one real, non-interactive Codex task. `--apply` first checks the Studio creation marker (not cryptographic provenance), probes the installed Codex executable, then records an executor-specific request, runs Codex with `--sandbox workspace-write` and persists a result bound to that request (exit code and JSONL hash, not the transcript). While this request is pending, checkpoints are blocked and `next` shows `AWAIT_EXECUTOR_RESULT`. If the parent crashes before recording a result, `workflow recover` previews and, only after `--confirm-no-executor --apply`, appends a failed `EXECUTOR_INTERRUPTED` result; the operator must establish that no old Codex process can still write the project. A successful process is `EXECUTED_UNVERIFIED`; attach real checkpoint evidence separately. If the executor fails after starting and its receipt is recorded, the run may be retried. This execution can modify files anywhere inside the Codex workspace sandbox: `--in-scope` is a task instruction **not a filesystem-enforced allowlist**; preserving `.ludory/ai` is also presently an instruction, not hard isolation. Review changes; use only on new test games and never frozen historical projects. Direct Codex execution through Studio was verified on Windows/NTFS; descendant-process cleanup after forced parent termination remains unverified.

**Controlled cycle (next AI slice):** `workflow cycle --test src/main.test.js [--repairs 2]` runs Codex for the current stage and requests the exact `node --test src/main.test.js` command from **within Codex's sandbox**, avoiding unrestricted host execution of newly generated code. Test path must be a safe, relative JS test path; existing symlinked test/ancestor paths are rejected. The result must contain a completed `command_execution` event with that exact command and exit code 0. If no passing command is observed, the run records `EXECUTOR_CHECKS_FAILED` and may retry up to the declared budget (zero to two retries). Other executor failures stop immediately. No raw prompt, transcript or test output is persisted. This telemetry is **not** an independent security or correctness attestation; a passing cycle remains `EXECUTED_UNVERIFIED`, and manual checkpointing must still supply evidence. A failed-check budget exits `FAILED_CHECKS` (CLI exit 1), leaving explicit retry available. There is no background agent, added orchestrator, automatic promotion or Release PASS. Windows actual Codex command telemetry requires later host observation.

### Engineering Quality: project-scoped, opt-in

For a newly Studio-created game (not a frozen game), `quality enable --project GAME --apply` writes `.ludory/quality/policy.json` once. Repeated enable reads existing policy without overwriting it. `quality check --tier quick|deep`, `quality status`, and `quality evidence --run latest` are preview/read-only by default. `check --apply` runs inside the existing Codex workspace sandbox; Studio does not execute generated tests or tool scripts in its unrestricted process.

1. Provision Crapper, Dryer and (for `deep`) Mutator manually, outside this mode. Pin each executable's absolute `path`, `sha256`, `version` and `timeoutMs` in the project policy. Mutator's adjacent Crapper dependency must also be satisfied. Launchers that install on first run must be pre-initialized; no implicit download or installation is allowed.
2. Add behavior tests that **generate** `coverage/lcov.info` during this execution; bare `node --test` does not create LCOV itself. `quick` runs these, Crapper `--use-existing-coverage --threshold 9.999999` (exclusive CRAP < 10) and Dryer `--threshold 0.8`; `deep` adds Mutator `--use-existing-coverage --max-workers 2`. A missing test, LCOV, pinned tool or expected `.metrics/*.edn` report is `BLOCKED`, never `PASS`. LCOV must contain actual source-file/line records and be refreshed during the attempt. The EDN snapshots are parsed for CRAP scores, duplicate candidates and killed/survived/uncovered mutants; a zero tool exit without valid metrics cannot pass. Pinned `.mjs` tools are run with Node across Windows/Unix; other executables must support the native host's `shell:false` launch.
3. Inspect `quality status` and `quality evidence`. Reports and bounded coverage/metric snapshots are copied into a SHA-256-linked receipt chain under `.ludory/quality/runs/`. Evidence readers reject altered receipts or reports; source/policy drift makes the latest receipt `STALE`. Historical receipts are not cryptographically authenticated against an actor with full write access.

For an enabled game, `workflow cycle --apply` and `workflow continue --executor codex --apply` trigger exactly one `quick` check **after successful execution that actually changed source files**. `quality` appears beside the workflow result; `FAIL`/`BLOCKED` return a nonzero exit code but do not rewrite the native workflow result. A broken/unsafe existing quality policy blocks the automatic gate rather than disabling it silently. No auto-check on preview, unchanged code, disabled mode or failed executor. This is development evidence only: native result remains `EXECUTED_UNVERIFIED`, not an independent Release PASS. A Studio creation receipt is local metadata, not a cryptographic proof of creation on another machine. Real Windows Codex/test/metric adapter compatibility and full Release gates are still open.

The [repository-local Engineering Quality Codex skill](../../.agents/skills/ludory-engineering-quality/SKILL.md) captures the test-first, root-cause and handoff discipline without changing global hooks or profiles. Details and boundaries are in the [design](../../docs/superpowers/specs/2026-10-27-engineering-quality-design.md).

**Foundation limitations:** Without `--executor`, `continue --apply` still only records a manual action request. Terminal `PASS` is blocked (`EVIDENCE_VERIFIER_NOT_READY`) until native Release verification is implemented. Strict current-artifact checks belong to Release, not mutable development history. Historical CEOS runs will **not** be imported. Node and fake-project tests do not establish Windows-host, VK/Yandex runtime or release readiness.

## AI task route preview (Slice A)

The new read-only command explains which executor is eligible **before** any model execution:

```sh
node packages/studio/bin/ludory.mjs workflow route --project /path/to/new-studio-game --task mechanics --json
node packages/studio/bin/ludory.mjs workflow route --project /path/to/new-studio-game --task episode-script --json
node packages/studio/bin/ludory.mjs workflow route --project /path/to/new-studio-game --task image --json
```

Supported task kinds: `mechanics` and `functional-check` prefer Codex CLI; `episode-script` prefers authenticated **GPT-6 Sol (Web)** DEV; `art-concept` prefers that same Web DEV **only if** the primary agent explicitly reviewed four distinct scene/character/location/style references, otherwise the primary model writes the art brief. `image` creates an agent handoff to a **separate Codex image-generator subagent**, inheriting the primary model and invoking built-in `$imagegen`. It returns `NEEDS_AGENT_ACTION`/`SPAWN_IMAGE_AGENT`, never a claimed automatic spawn or invocation. Programmatic `terra` and `sol` are retained only for explicitly pinned historical in-process adapters. Read-only routing invokes no provider.

`workflow route` never writes project files or workflow events; it rejects `--apply`. Exit code `0` covers a valid preview, including a manual handoff; `2` means the project is blocked (for example, no Studio creation receipt); `1` means invalid arguments or inspection error. Historical games stay frozen. No image, script, art review, independent acceptance, or Release PASS is produced by a route preview.
JSON previews preserve `reasonCode` and, when available, `capabilityReasonCode`. The built-in ImageGen route uses `modelSelection: provider-default`, `qualityPreference: highest-available` and `modelObserved: null`; it cannot set or attest a hidden execution model. Historical in-process routes retain their Terra/SOL evidence fields.

## Web DEV reviewable drafts (Slice B, experimental)

For `--task art-concept`, selected source text files must be distinct and labeled with the four roles `scene:path`, `characters:path`, `location:path`, `style:path` in `--source` (separated by semicolons). A role that is not applicable can have a file explaining why. After the primary agent assesses that the selected contents are sufficient, it supplies `--context-reviewed`. This is an explicit **USER_DECLARED** assessment, not automatic semantic QA; absent/duplicated roles or omitted review cause a read-only primary-model handoff and never an automatic Web DEV call. Existing `episode-script` sources remain untyped.

For a game created with `ludory create` and an active native workflow run:

```sh
# Read-only preview, including a source-hash-bound handoff packet. Does not start DEV.
node packages/studio/bin/ludory.mjs workflow draft --project /path/to/new-studio-game \
  --run RUN_ID --task episode-script --brief narrative/episode-brief.md \
  --source narrative/graph.json --json

# Explicit execution. Invokes DEV only if the installed isolated helper attests
# actual authenticated transport, effective selected GPT-6 Sol (Web), and browser-only mode.
node packages/studio/bin/ludory.mjs workflow draft --project /path/to/new-studio-game \
  --run RUN_ID --task art-concept --brief narrative/art-brief.md \
  --source 'scene:narrative/scene.txt;characters:narrative/characters.txt;location:narrative/location.txt;style:narrative/art-style.txt' \
  --context-reviewed --apply --json

# No supported DEV host? Prepare the draft yourself, then import by user declaration.
node packages/studio/bin/ludory.mjs workflow draft-import --project /path/to/new-studio-game \
  --run RUN_ID --task episode-script --brief narrative/episode-brief.md \
  --file narrative/my-draft.md --json
node packages/studio/bin/ludory.mjs workflow draft-import --project /path/to/new-studio-game \
  --run RUN_ID --task episode-script --brief narrative/episode-brief.md \
  --file narrative/my-draft.md --apply --json
```

The optional host is a separate DEV browser-helper with an isolated profile and a protocol that **observes** transport authorization and the actually selected model. Merely launching a helper, reading the configured model, or seeing it submit a prompt does not establish model provenance. Ludory does not read or copy the Stable browser profile, acquire ChatGPT cookies, or expose local tools to Web DEV. It never replaces the installed Codex Web GPT executable.

### Trusted Web helper v2 supply

Art Acceptance requires `browser_observation_v2`; the older upstream `6.1.14` helper without that feature remains valid only for compatibility-v1 text routes and is blocked for visual review. Ludory ships the approved prebuilt helper as a vendored artifact under `packages/ai/vendor/codex-chatgpt-web/`, with a versioned `manifest.json`, the pinned SHA-256, the two source commits and an auditable source patch. Upstream MIT terms and the generated third-party notices are kept beside the artifact.

Install or refresh it only in the isolated DEV profile selected by `CODEX_WEB_GPT_DEV_HOME` (or the default `~/.codex-chatgpt-web-dev` location):

```sh
node packages/studio/bin/ludory.mjs helper install --json
node packages/studio/bin/ludory.mjs helper install --apply --json
```

The command has no arbitrary destination flag. It verifies the vendored helper and the complete runtime dependency tree before installation, copies that pinned tree into the isolated DEV profile, verifies it again by file count, byte count and UTF-8-byte-lexicographic SHA-256, and writes only the DEV profile helper, manifest, runtime tree and profile helper override. It preserves the launcher executable and Stable profile. Ludory rechecks the distribution manifest, helper SHA-256 and runtime tree before every helper spawn; a missing manifest, changed helper, changed runtime file, unsupported protocol or missing `browser_observation_v2` fails closed. The older upstream `6.1.14` helper remains valid for compatibility-v1 text routes only and cannot satisfy Art Acceptance. The pinned artifact is a prebuilt: source rebuilds are currently not byte-reproducible, which is recorded as technical debt rather than claimed as a reproducible build.

An existing compatibility-v1 DEV profile without `browser-helper.manifest.json` is intentionally unsupported: discovery returns `DEV_HELPER_MANIFEST_MISSING` before spawning any helper. Do not hand-write a manifest or use the profile for Art Acceptance. The supported transition is to preserve the old profile, run the preview command above, then run `helper install --apply --json` against the same isolated DEV profile; this installs the vendored v2 helper and its verified runtime tree, writes the missing manifest, and keeps text routes available through the v2 protocol without modifying Stable. A manifestless profile cannot be silently upgraded or used as a v1 fallback.

`workflow draft` preview never writes files or starts a host. `--apply` journals an immutable `web-dev` request **before** the helper call; an observed response becomes a SHA-256-bound draft under `.ludory/ai/runs/<id>/drafts/` with `HOST_OBSERVED` provenance. Unexpected exit or timeout leaves the request pending, blocks duplicates and checkpoints, and requires `workflow recover --run RUN_ID --confirm-no-executor --apply` only after confirming that the old DEV helper is no longer active. No hidden retry or route downgrade occurs.

Only deliberately named UTF-8 `--brief` and `--source` files are sent as text to the external DEV session. The complete bounded prompt must fit 64 KiB; an oversized or binary reference blocks before any external call. Review these files for credentials and private content before using `--apply`. A helper failure *after intent was committed* is surfaced as `PENDING_RECOVERY` (CLI exit 3), not as proven non-execution. The helper runs with an allowlisted environment and strict isolation from any Stable profile path, including symlink/junction aliases.

`workflow draft-import` accepts an existing safe project-relative UTF-8 text file, records a separate `DRAFT_IMPORTED` event with `USER_DECLARED` provenance and copies immutable bytes into the native run. It never claims DEV execution. Art-concept drafts remain `PENDING_REVIEW`; an episode-script draft is instead sent for a separate narrative review when a verified Web DEV route is available. Neither route rewrites gameplay scenes, certifies platform release or automatically advances the workflow stage. Source files, symlinks, game receipts, stale hashes and pending executors are checked fail-closed. Each task kind permits a single declared manual import per run.

An interrupted import can leave an unreferenced uniquely named draft in the private run directory. It is not treated as an accepted import or used by runtime; a later explicit import may safely create a new file. Orphan cleanup is manual after inspecting provenance and contents.

### Automatic narrative review (StoryScope-inspired)

For a new Studio game, `workflow draft --task episode-script --apply` automatically makes a second **independent** GPT-6 Sol (Web) review turn after the draft has been saved. `workflow draft-import --task episode-script --apply` also requests review when the authenticated helper is available. The first call writes immutable draft bytes; the second reviews those bytes alongside the selected brief/context. There is no API key or alternate provider. The first and second turns are independently recorded as generation provenance and `NARRATIVE_REVIEW_REQUESTED` / `NARRATIVE_REVIEW_RESULT` events.

```sh
# Read-only preview; no paid/host request.
node packages/studio/bin/ludory.mjs workflow narrative-review --project /path/to/new-game --run latest --json
# Explicit review if an earlier imported draft could not access the reviewer.
node packages/studio/bin/ludory.mjs workflow narrative-review --project /path/to/new-game --run latest --apply --json
# Only after independently verifying the previous reviewer helper stopped:
node packages/studio/bin/ludory.mjs workflow recover --project /path/to/new-game --run latest --confirm-no-executor --apply --json
```

An `ACCEPT` verdict has no P0/P1 issues and makes the draft eligible for a *separate* integration decision, not a platform or Release PASS. `REWORK` identifies grounded P0/P1 defects (with exact excerpts) and requires a revised draft in a new run. `BLOCKED` means the review evidence was missing, malformed or could not be trusted. P2 cosmetic improvements do not force rewrites. Episode drafts cannot advance a native `CONTINUE` checkpoint before `ACCEPT`; an unavailable Web DEV helper leaves them `PENDING_REVIEW` instead of claiming success. On a host timeout after `NARRATIVE_REVIEW_REQUESTED`, no automatic retry is made; the explicit recovery command records `REVIEW_INTERRUPTED` as BLOCKED after the owner verifies the old helper is stopped.

**Limits:** The review prompt (brief, draft, selected references and review instructions combined) must fit the DEV helper's 64 KiB limit. Oversized drafts receive `REVIEW_PROMPT_TOO_LARGE` before a review request is recorded; chapter-by-chapter review requires a separate future workflow. For a manually imported draft, the automatic reviewer currently receives only the imported draft and original brief; it cannot attest to unprovided scene graphs, route variables or character canon. Add canon to the brief or treat absent evidence as `BLOCKED`. Once a run contains an episode draft, revisions belong in a new run. Narrative `ACCEPT` does not clear outstanding art/image review obligations.

This is an adaptation of [StoryScope, COLM 2026](https://arxiv.org/abs/2604.03136), **not** an AI authorship detector. The project-local [Codex skill](../../.agents/skills/ludory-narrative-review/SKILL.md) contains the review method and limitations; the Node CLI carries the operative prompt even when Codex skills are unavailable.

CLI `--apply` without an authenticated compatible DEV helper produces a manual handoff (`NEEDS_USER_ACTION`, exit 2) without game writes. In that case the **primary model already executing the task** should use the project's scene/character/style context to author the brief and supply a source-bound file; a standalone Ludory process has no truthful way to impersonate that active model. Local mock-host tests are not evidence of successful real Windows DEV model selection. Live Windows DEV host and NTFS acceptance are still required.

## Codex built-in ImageGen originals (Slice C, experimental)

These commands require an active native run in a newly created Studio game:

```sh
# Step 1: prepare a source-aware artistic brief through the preceding Web DEV draft path,
# or let the active primary task model author one from selected story/style files.
# Step 2: read-only preview. The response includes a source-bound $imagegen prompt.
node packages/studio/bin/ludory.mjs workflow image --project /path/to/new-studio-game \
  --run RUN_ID --brief narrative/scene-art-brief.md --json

# Step 3: request an agent handoff (this does not invoke any external provider).
node packages/studio/bin/ludory.mjs workflow image --project /path/to/new-studio-game \
  --run RUN_ID --brief narrative/scene-art-brief.md --apply --json

# Step 4: the primary Codex agent delegates the packet to a separate image-generator
# subagent inheriting the primary model. That subagent invokes $imagegen with the
# prompt and references, then saves the generated original inside the game.

# Step 5: preview and explicitly import the checked original as USER_DECLARED.
node packages/studio/bin/ludory.mjs workflow image-import --project /path/to/new-studio-game \
  --run RUN_ID --brief narrative/scene-art-brief.md --file art/candidate.webp \
  --handoff-sha256 PACKET_HANDOFF_SHA256 --json
node packages/studio/bin/ludory.mjs workflow image-import --project /path/to/new-studio-game \
  --run RUN_ID --brief narrative/scene-art-brief.md --file art/candidate.webp \
  --handoff-sha256 PACKET_HANDOFF_SHA256 --apply --json
```

`$imagegen` is a **built-in Codex tool**, not a programmatic API provided to Node.js. The CLI cannot spawn agents or call it directly: the primary Codex agent receives `manualPacket`, spawns a separate image-generator subagent with the inherited model, and supplies the prompt and selected references. That subagent must invoke the skill, save the original and report its location. The primary agent explicitly imports it. Missing subagent or tool access blocks generation; there is no direct-primary-agent or HTTP fallback. No authentication secret, separate provider endpoint or key is required by Ludory. This integration is an **agent handoff**, not unattended generation by the CLI.

The native Ludory `production-art` pipeline does **not** invoke or require the legacy CEOS `production-art` skill, `ceos capability-challenge`, `ceos context`, or a `.codex-os` manifest. The `manualPacket.executionContract` makes this explicit. A CEOS session/worktree binding failure is not evidence that the Codex-native ImageGen tool is unavailable. Conversely, Ludory cannot override independently mandatory rules of an active Codex session: if such a rule requires a separate challenge or forbids tool use, stop and report the external policy conflict, without bypassing it or claiming a generation. Use a correctly configured native Ludory Codex session for the next attempt. The imported original remains `USER_DECLARED`, even when the calling agent witnessed the tool invocation; the CLI cannot cryptographically attest to that session-only call.

The built-in tool has no visible model/quality selection parameter. `qualityPreference: highest-available` is an instruction to pursue the best available result using a precise brief, **not an SDK setting or a verified model ID**; the actual model is left unobserved. Model availability, generation limits and reference support depend on the active Codex session. Selected external visual references are not currently part of the image handoff hash and therefore cannot be claimed as cryptographically bound by Ludory. A text packet alone cannot assert that an image has been generated. Recheck story fidelity, composition and technical quality after seeing the output.

Imported originals are stored exclusively under `.ludory/ai/runs/<id>/images/`. Import requires `handoffSha256` from the original `workflow image` packet and rejects a changed brief, project source binding, run head or stage before staging. The native image receipt records this token as declared attribution. Signatures, PNG integrity, JPEG/WebP structure and **full JPEG/WebP pixel decode with sharp**, dimensions, byte limits and SHA-256 receipts are verified before staging. Imports reject symlinks, hardlinks, parent aliases and content/extension mismatches; orphan files from interruptions remain untrusted. Provenance is `USER_DECLARED`: the CLI cannot independently attest that the tool ran. Neither operation publishes runtime assets, updates rights manifests or grants art/release PASS. Tests do not establish real Codex tool invocation or real Windows-host completion.

## Independent Web art review (experimental)

After `workflow image-import --apply` in a new Studio game, ask the primary Codex
agent to review four selected text references and approve their sufficiency.
These are project-relative UTF-8 files, not inferred from an image caption;
an absent character or prop should be explicitly explained in its reference.

```sh
# Read-only preview: no helper launch and no writes. Copy the `image` value
# from image-import's `output.outputPath`, NOT the source candidate filename.
node packages/studio/bin/ludory.mjs workflow art-review --project /path/to/new-studio-game \
  --run RUN_ID --image .ludory/ai/runs/RUN_ID/images/IMPORTED_ORIGINAL.png \
  --source 'scene:narrative/scene.md;characters:narrative/characters.md;location:art/location.md;style:art/style.md' \
  --context-reviewed --json

# The primary Codex agent must run this in its real authenticated DEV environment.
node packages/studio/bin/ludory.mjs workflow art-review --project /path/to/new-studio-game \
  --run RUN_ID --image .ludory/ai/runs/RUN_ID/images/IMPORTED_ORIGINAL.png \
  --source 'scene:narrative/scene.md;characters:narrative/characters.md;location:art/location.md;style:art/style.md' \
  --context-reviewed --apply --json
```

Only a capability-verified isolated `chatgpt-web/gpt-6-sol` helper (`reasoning: high`)
may evaluate the image. Ludory passes the **actual PNG/JPEG/WebP bytes**, max
10 MiB, in the helper's `prepared.images` envelope and requires a witnessed
`image_attached` event plus `imageInputObserved`, image reference and matching
SHA-256 on the final result. The compatibility helper must emit `ready` with
`protocolVersion: 1`, a verified `capabilities` frame including
`imageInputVerified: true`, and those attachment observations from its browser
worker. For a visual receipt, the attachment event and result must additionally
carry the same `hostObservation` protocol v2: browser-selected `gpt-6-sol` with
`reasoning: high`, plus the attached ref, SHA-256 and byte length. Requested
model settings and helper declarations are not observations. **The upstream unmodified `codex-chatgpt-web` browser helper currently
does not supply that complete Ludory attestation protocol.** Its binary-image
support alone does not satisfy the gate. An incompatible/older helper yields
`NEEDS_USER_ACTION` or `BLOCKED`: a real Codex + DEV Web smoke is required after
installing a protocol-compatible helper. Do not report a successful real visual
test based only on the CI fake helper.

The independent model must return strict JSON with `schemaVersion: 1`,
`imageSha256`, `imageVisible`, `verdict`, `summary` and evidence-bearing findings.
P0/P1 covers wrong people, story facts, locations, important props, bad cropping
and significant composition errors and requires `REWORK`. P2-only cosmetic
notes are recorded but do not force revision. A hidden image, malformed output,
stale source, absent visual evidence or unknown model is `BLOCKED` (no acceptance).
Two serious `REWORK` receipts in the **same run** cause `ESCALATE` with no third
automatic attempt; the agent must stop and ask the owner how to proceed. The
current run schema permits only one `IMAGE_IMPORTED` original: a corrected
candidate requires a new native run, not a silent replacement of stored bytes.
The two-attempt guard is per run, not a cross-run/global scene budget.

With `--apply`, confirmed host observations are recorded in exclusive numbered
JSON and commit-hash files under `.ludory/ai/runs/<RUN_ID>/reviews/`. Existing
original image bytes and game runtime files are never rewritten; a changed
receipt/hash or symlinked review namespace fails closed. The receipt means only
`HOST_OBSERVED` Web artistic feedback. **`PASS_ART` does not confer human art
approval, asset rights, provenance of ImageGen, integration, platform release or
production deployment.** No review automatically moves the native workflow stage.
