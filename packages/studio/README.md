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

**Foundation limitations:** Without `--executor`, `continue --apply` still only records a manual action request. Terminal `PASS` is blocked (`EVIDENCE_VERIFIER_NOT_READY`) until native Release verification is implemented. Strict current-artifact checks belong to Release, not mutable development history. Historical CEOS runs will **not** be imported. Node and fake-project tests do not establish Windows-host, VK/Yandex runtime or release readiness.

## AI task route preview (Slice A)

The new read-only command explains which executor is eligible **before** any model execution:

```sh
node packages/studio/bin/ludory.mjs workflow route --project /path/to/new-studio-game --task mechanics --json
node packages/studio/bin/ludory.mjs workflow route --project /path/to/new-studio-game --task episode-script --json
node packages/studio/bin/ludory.mjs workflow route --project /path/to/new-studio-game --task image --json
```

Supported task kinds: `mechanics` and `functional-check` prefer Codex CLI; `episode-script` prefers authenticated Web DEV; `art-concept` prefers Web DEV **only if** supplied with enough selected story/style context, otherwise the task's primary model writes the art brief. `image` creates an agent handoff to the **built-in Codex `$imagegen` skill**. It returns `NEEDS_AGENT_ACTION`/`CALL_IMAGEGEN_SKILL`, never a claimed automatic invocation. Programmatic `terra` and `sol` are retained only for explicitly pinned historical in-process adapters. Read-only routing invokes no provider.

`workflow route` never writes project files or workflow events; it rejects `--apply`. Exit code `0` covers a valid preview, including a manual handoff; `2` means the project is blocked (for example, no Studio creation receipt); `1` means invalid arguments or inspection error. Historical games stay frozen. No image, script, art review, independent acceptance, or Release PASS is produced by a route preview.
JSON previews preserve `reasonCode` and, when available, `capabilityReasonCode`. The built-in ImageGen route uses `modelSelection: provider-default`, `qualityPreference: highest-available` and `modelObserved: null`; it cannot set or attest a hidden execution model. Historical in-process routes retain their Terra/SOL evidence fields.

## Web DEV reviewable drafts (Slice B, experimental)

For a game created with `ludory create` and an active native workflow run:

```sh
# Read-only preview, including a source-hash-bound handoff packet. Does not start DEV.
node packages/studio/bin/ludory.mjs workflow draft --project /path/to/new-studio-game \
  --run RUN_ID --task episode-script --brief narrative/episode-brief.md \
  --source narrative/graph.json --json

# Explicit execution. Invokes DEV only if the installed isolated helper attests
# actual authenticated transport, effective selected gpt-*-sol model, and browser-only mode.
node packages/studio/bin/ludory.mjs workflow draft --project /path/to/new-studio-game \
  --run RUN_ID --task art-concept --brief narrative/art-brief.md \
  --source 'narrative/graph.json;narrative/character-bible.md;narrative/art-style.md' --apply --json

# No supported DEV host? Prepare the draft yourself, then import by user declaration.
node packages/studio/bin/ludory.mjs workflow draft-import --project /path/to/new-studio-game \
  --run RUN_ID --task episode-script --brief narrative/episode-brief.md \
  --file narrative/my-draft.md --json
node packages/studio/bin/ludory.mjs workflow draft-import --project /path/to/new-studio-game \
  --run RUN_ID --task episode-script --brief narrative/episode-brief.md \
  --file narrative/my-draft.md --apply --json
```

The optional host is a separate user-installed DEV browser-helper with an isolated profile and a protocol that **observes** transport authorization and the actually selected model. Merely launching a helper, reading the configured model, or seeing it submit a prompt does not establish model provenance. The older helper without a capabilities/route observation frame is unsupported and returns `DEV_ROUTE_UNVERIFIED`. Ludory does not read or copy the Stable browser profile, acquire ChatGPT cookies, or expose local tools to Web DEV. It does not bundle a DEV executable.

`workflow draft` preview never writes files or starts a host. `--apply` journals an immutable `web-dev` request **before** the helper call; an observed response becomes a SHA-256-bound draft under `.ludory/ai/runs/<id>/drafts/` with `HOST_OBSERVED` provenance. Unexpected exit or timeout leaves the request pending, blocks duplicates and checkpoints, and requires `workflow recover --run RUN_ID --confirm-no-executor --apply` only after confirming that the old DEV helper is no longer active. No hidden retry or route downgrade occurs.

Only deliberately named UTF-8 `--brief` and `--source` files are sent as text to the external DEV session. The complete bounded prompt must fit 64 KiB; an oversized or binary reference blocks before any external call. Review these files for credentials and private content before using `--apply`. A helper failure *after intent was committed* is surfaced as `PENDING_RECOVERY` (CLI exit 3), not as proven non-execution. The helper runs with an allowlisted environment and strict isolation from any Stable profile path, including symlink/junction aliases.

`workflow draft-import` accepts an existing safe project-relative UTF-8 text file, records a separate `DRAFT_IMPORTED` event with `USER_DECLARED` provenance and copies immutable bytes into the native run. It never claims DEV execution. All automatically generated or imported drafts remain `PENDING_REVIEW`; neither route advances the workflow stage, rewrites gameplay scenes, validates narrative consistency, nor establishes release readiness. Source files, symlinks, game receipts, stale hashes and pending executors are checked fail-closed. Each task kind permits a single declared manual import per run.

An interrupted import can leave an unreferenced uniquely named draft in the private run directory. It is not treated as an accepted import or used by runtime; a later explicit import may safely create a new file. Orphan cleanup is manual after inspecting provenance and contents. `workflow status/next` advertises `REVIEW_DRAFT` while review-only evidence exists; narrative review completion remains a separate future gate.

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

# Step 4: inside the active Codex session, invoke $imagegen with the packet's prompt
# and selected project references, then copy the generated original into the game.

# Step 5: preview and explicitly import the checked original as USER_DECLARED.
node packages/studio/bin/ludory.mjs workflow image-import --project /path/to/new-studio-game \
  --run RUN_ID --brief narrative/scene-art-brief.md --file art/candidate.webp --json
node packages/studio/bin/ludory.mjs workflow image-import --project /path/to/new-studio-game \
  --run RUN_ID --brief narrative/scene-art-brief.md --file art/candidate.webp --apply --json
```

`$imagegen` is a **built-in Codex tool**, not a programmatic API provided to Node.js. The CLI cannot call it directly: a live Codex agent must consume `manualPacket.prompt`, invoke the image-generation skill, preserve the generated original, and then perform the explicit import. No authentication secret, separate provider endpoint or key is required by Ludory. This integration is an **agent handoff**, not unattended generation by the CLI.

The built-in tool has no visible model/quality selection parameter. `qualityPreference: highest-available` is an instruction to pursue the best available result using a precise brief and relevant reference images, **not an SDK setting or a verified model ID**; the actual model is left unobserved. Model availability, generation limits and the ability to use references depend on the active Codex session. A text packet alone cannot assert that an image has been generated. Recheck story fidelity, composition and technical quality after seeing the output.

Imported originals are stored exclusively under `.ludory/ai/runs/<id>/images/`. Signatures, PNG integrity, JPEG/WebP structure and **full JPEG/WebP pixel decode with sharp**, dimensions, byte limits and SHA-256 receipts are verified before staging. Imports reject symlinks, hardlinks, parent aliases and content/extension mismatches; orphan files from interruptions remain untrusted. Provenance is `USER_DECLARED`: the CLI cannot independently attest that the tool ran. Neither operation publishes runtime assets, updates rights manifests or grants art/release PASS. Tests do not establish real Codex tool invocation or real Windows-host completion.
