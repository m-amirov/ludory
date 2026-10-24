# Native Ludory AI and One-Time CEOS Migration — Historical Design (2026-10-24)

> **SUPERSEDED OWNER DECISION:** The one-time historical CEOS import, old-run resume and legacy project migration sections below are no longer approved. Existing games are frozen; new Ludory games use fresh native runs, and a future opt-in adoption (if requested) will not copy CEOS history. Current source of truth: [native workflow simplification](2026-10-24-native-dev-workflows-simplification-design.md). The description below documents the earlier proposal only, not an implementation mandate.

## Product decision and source baseline

**Owner-confirmed:** Ludory is the complete successor to CEOS and Starter Kit, not a permanent front end for either. Existing CEOS games must undergo **one-time, safe, non-destructive migration** that preserves historical runs, evidence and checkpoints and allows unfinished runs to continue from the last *verified and authorized* state. After migration, Ludory workflow operations require no installed CEOS package, CEOS binary, global shim or CEOS process. The old repositories remain immutable reference baselines until parity and pilot gates pass.

Sources inspected at the pinned CEOS 0.5.40 commit `c8cc13bd3852409be93097ee823e9cd35e512b73`: `src/execution-engine.mjs`, `src/continuation-controller.mjs`, `src/continuation-recovery.mjs`, `src/run-relocation.mjs`, `src/evidence-contract.mjs`, `src/source-fingerprint.mjs`; Ludory capability inventory lists all 219 CEOS and 179 Starter Kit blobs, 29 migration groups. Inspection of the source code is **not** proof of behavioral parity on the user’s Windows host.

The existing draft **PR #5** (`feat/studio): connect CEOS workflows`) delegates to installed CEOS and **does not meet the new product decision**. Do not merge it. Supersede it with native Ludory AI work, preserving the CLI grammar/tests where appropriate but removing CEOS discovery/spawn as a shipping dependency. Close the draft only after the native replacement PR or with separate owner direction.

## Goals

1. `ludory workflow doctor|status|next|start|continue|checkpoint` executes **in process through `@ludory/ai`**, with no CEOS installation requirement and a stable JSON contract.
2. Read-only plans and inspection are the defaults. Any run creation, checkpoint, retry, capability refresh or import commit needs a specific explicit `--apply`, with per-operation allowlists. No automatic recovery of terminal/ambiguous runs.
3. Native state machine, scoped operation boundaries, checkpoint/evidence integrity, Git provenance, recovery classification, agent capability routing and human gates are implemented in independently testable modules. `@ludory/core` remains SDK-agnostic and does not absorb workflow/evidence/release code.
4. **One-time importer** reads historical CEOS state directly from game files, preserving its bytes and hash provenance without running CEOS. Every supported old run is converted to an immutable imported history and a distinct Ludory-native continuation state. Unsupported/invalid runs are preserved but blocked, never silently discarded.
5. Unfinished compatible runs continue from the last valid checkpoint **only after fresh authorization/capability/source evidence**; terminal `PASS`, `FAIL`, `BLOCKED`, `ESCALATE` decisions and historical source-bound acceptance are not upgraded by conversion.
6. Existing game source, assets, save data, manifests, rights, `AGENTS.md`, platform settings, legacy `.codex-os/` and `.ceos-runs/` are never rewritten, removed, or silently reinterpreted.

## Non-goals and anti-goals

- No automated deletion of CEOS installations, historical directories or the old repos. No auto-merge, production release or moderation submission.
- No blanket claim that all CEOS versions (including historical 0.3.x or current 0.5.40) are immediately resumable. Unsupported schema variants must be accounted for explicitly and remain accessible as read-only archives with `BLOCKED_UNSUPPORTED_LEGACY_SCHEMA`.
- No fake capabilities, imported session tokens, inherited live parent IDs, reclassified historical review into current acceptance, or automatic `PASS` on incomplete evidence.
- No copying all 219 source files into an undifferentiated package, no arbitrary CEOS command proxy, and no second active project manifest with conflicting authority.
- No engine/SDK or platform acceptance parity claimed merely because workflow tests pass; Runtime, Connect, Studio updater and Release have separate gates.

## Approaches considered

| Approach | Value | Cost / decision |
| --- | --- | --- |
| **Selected: native Ludory engine + complete historical import** | No runtime CEOS dependency; can resume verified unfinished runs; preserves audit trail and original bytes | More work; versioned importer, evidence replay, old/new parity matrix, fresh capabilities required |
| Archive-only import with fresh workflow state | Simple, lower risk of invalid continuation | **Rejected by owner:** would lose ability to continue unfinished CEOS processes |
| Existing CEOS CLI adapter from draft PR #5 | Expedient unified CLI and current CEOS behavior | **Rejected as end-state:** an installed external CEOS remains mandatory |

## Module ownership and internal contracts

```text
packages/studio      ludory CLI, project selection, dry-run migrations and explicit apply
packages/ai          native execution state machine, scope, checkpoints, recovery, agents,
                     capabilities, routing, evidence relationships and legacy-run importer
packages/release     verifier contracts, source evidence replay, host/release gates
packages/core        platform-neutral game identity/state/lifecycle; no CEOS code
packages/runtime     optional game-host/runtime integration (separate phase)
packages/connect-*   VK/Yandex adapters and independent platform requirements
```

`@ludory/ai` exposes a versioned API such as `planRun`, `inspectRun`, `planNextAction`, `planCheckpoint`, `applyWorkflowOperation`, `inspectLegacyImport`, `planLegacyImport`, `applyLegacyImport`. Studio translates safe CLI flags to typed input; no internal CLI string passthrough. Release's evidence validators are pure and return explicit `PASS`, `FAIL`, `BLOCKED` and reason codes. AI cannot assert a Release PASS itself.

The existing canonical `ludory.project.json` remains the game-identity source. The importer parses `.codex-os/project.yml` as a versioned **legacy profile**, not as an invented equality check against the Ludory game ID. Conflicts in actual project root/engine/targets/gates require owner resolution in the dry-run plan. Legacy `game-spec.yaml` remains untouched until the separate Starter Kit migration contract is delivered.

## Native run model and workflow semantics

- A new Ludory run has immutable `(schemaVersion, ludoryRunId, projectId, workflowType, sourceBinding, scope, createdAt, legacyOrigin?)`, plus append-only transitions and checkpoints under a dedicated `.ludory/ai/` namespace. A legacy CEOS `runId` is stored as an origin key, **never silently reused** as a Ludory run ID.
- Supported first-class workflow types initially mirror pinned `audit-repair-loop` and `production-art` stage graphs. Native stage transition validation, retry budgets and terminal statuses are authoritative; new workflow definitions are versioned so future updates cannot reinterpret old runs.
- A checkpoint references actual artifact hashes/sizes, source binding, outcome, stage and evidence receipts. A `PASS` is accepted only after source-bound, complete positive evidence and the required independent review; terminal decisions remain terminal unless an explicit, safe recovery flow creates a linked new run.
- `doctor`, `status`, `next` are strict read-only. `continue` without apply plans the next safe action; `continue --apply` may claim or advance only a **natively authorized** action. It cannot pretend that an external Codex/Image Gen/browser task has been executed. Checkpoint and start use preview → source/inode revalidation → explicit commit.
- The capability broker re-attests AI agent/model, Image Gen, Web High and host capabilities on each new privileged action. Imported attestations and parent session IDs are history only; never authority. Missing/expired capabilities produce `BLOCKED_CAPABILITY_REVALIDATION` or `NEEDS_USER_ACTION` without burning an art attempt or retry budget.
- Recovery state tracks unique attempts/events, bounded retries, external waits and error classes separately from artistic rework budgets. Duplicate or conflicting receipts fail closed. No blind retry of non-idempotent generation or release actions.
- `@ludory/ai` is installable/runable on Node.js 22+ without CEOS code/bin/shim; external AI model calls remain optional adapters with capability and policy gates, not a required CEOS process.

## One-time import: preview, verification and commit

**Candidate inputs** (per game): existing `ludory.project.json`, `game-spec.yaml` if present, `.codex-os/project.yml`, `.ceos-runs/latest.json`, each `.ceos-runs/<runId>/run.json`, `scope.json`, `capabilities.json`, ordered `checkpoints/*.json`, referenced run evidence and project-owned artifacts. Historic source variants are discovered by schema/version, not guessed from directory naming. Checkpoints and evidence are enumerated in bounded, deterministic order; no symlink/junction traversal, traversal paths, unknown device paths or silent remote reads.

1. **`ludory migrate ceos --project DIR --json` (read-only).** Inventory all runs; identify CEOS version/format, legal stage graph, terminal/outstanding state, linked-recovery relationships, original paths, source Git HEAD/ancestry and evidence hash status. Produce per-run `RESUMABLE_AFTER_REVALIDATION`, `ARCHIVE_ONLY`, `BLOCKED_INTEGRITY`, `BLOCKED_UNSUPPORTED_LEGACY_SCHEMA`, `BLOCKED_AMBIGUOUS_RUN`, etc. Never select a single `latest` without cross-checking other active/linked runs.
2. **Validated import plan.** Include deterministic source-file SHA-256 closure, filesystem identity, current Git commit/cleanliness, game ID, run order, imported checkpoint count, candidate new IDs, source byte count, exact allowed write paths and explicit conflicts. A malformed checkpoint/metadata path cannot be ignored in a claimed resumable run. Preserve all runs as historical evidence even if only some are resumable.
3. **`ludory migrate ceos --project DIR --apply --expect-plan SHA`** recomputes the complete plan and compares its fingerprint before any write. Require exclusive project-level migration lock, prohibit live CEOS writes during import, reject dirty/unresolved Git/ambiguous source bindings, and reject destination collisions. If the filesystem changes in the transaction window, block and leave immutable recoverable staging evidence; never delete user files.
4. **Archive without mutation.** Copy bounded CEOS-owned metadata and evidence to a **Ludory-owned immutable, content-addressed archive** with original relative paths, raw SHA-256, origin version/run IDs and import receipt. Large game-owned art/media are referenced by verified project-relative path/hash, not automatically duplicated or edited. Any external/unavailable reference is explicitly marked unverified and prevents resume/PASS. Import does not require the CEOS package or original runtime after source bytes are read.
5. **Native continuation projection.** Rebuild a new Ludory run from the last *consecutively verified* checkpoint chain; preserve full CEOS history as origin, but reset all session/capability authority. Projects with out-of-date source HEAD, missing artifacts, ambiguous linked recovery, blocked terminal state or unsupported transition stay archived in an explicitly blocked mode. A terminal verdict is never reopened in place.
6. **Atomic publication.** Write only under `.ludory/ai/` through exclusive, hash-verified staging, commit one immutable import receipt and an atomic activation pointer (never overwrite existing bytes). A failure before activation leaves no partially active run; retry is idempotent for matching source fingerprints and `CONFLICT` for differing bytes. Allow manual rollback to the prior *Ludory* activation pointer without altering CEOS originals.
7. **Post-import status.** `ludory workflow status/next` operates solely on the newly stored native state. Each imported run exposes its source CEOS ID/hash, verification gaps, next permitted action and explicit `MIGRATED` vs `NEEDS_REVALIDATION` vs `ARCHIVED_BLOCKED` status. CEOS is never executed during import or continuation.

### Security and integrity details

- Treat all legacy manifests, artifact paths, names, metadata and JSON as untrusted. Reject prototype keys, duplicate run identifiers, symlinks, junctions, non-regular files, excessive file/depth limits and path escapes. Maintain Windows drive/UNC canonicalization and Git worktree identity checks.
- Bind imports to actual source bytes and files using SHA-256 with a source manifest. Historical `run.scopeSha256`, `capabilitiesSha256`, sequential checkpoint indexes, artifact hashes and linked-recovery hashes are validated against upstream 0.5.40 logic and variant-specific fixtures.
- Imported absolute artifact paths must be proven to resolve to the same project-owned content; do **not** transparently rebind worktree paths. If an old path moved, require an explicit verified relocation plan or mark the run blocked.
- Never turn historical CEOS `PASS` into current Ludory release PASS. It remains `legacyVerdict: PASS` with a provenance label; host-observed Web High, rights, release and platform evidence need their own current gates.
- No implicit network access, dependency installation, privilege elevation, CEOS command, git reset, cleanup, deletion, or project-owner file rewrite.

## Incremental implementation and measurable gates

1. **Native AI foundation.** Add `@ludory/ai` workflow definitions, run model, transition checker, evidence/source validation and in-process Studio CLI. Replace the draft PR #5 bridge rather than retaining it as a required dependency. Contract tests use pinned CEOS fixtures but run without CEOS installed. Green gate: six commands work on a fresh Ludory-native run without `LUDORY_CEOS_ENTRY` or a global shim.
2. **Legacy inventory and import preview.** Build CEOS 0.5.40 parser/integrity replay and an explicit supported-schema registry for older CEOS 0.3.x–0.5.x as fixtures become available. Green gate: every run classified, no writes during inspect, corrupt/missing/ambiguous data blocks safely.
3. **One-time commit and continuation.** Implement content-addressed snapshot, receipt and atomic activation; map valid checkpoints to native stages with stale-session trust reset. Green gate: idempotent repeat; failure injection/rollback; hash mismatch and symlink/race tests; native `next/continue` works after removing CEOS from PATH and package resolution. No unsupported run silently marked resumable.
4. **Remaining AI feature parity.** Port C01–C15 in capability-sized increments, including agents/skills, native producer routing, Web High, art candidate/rework, narrative pipeline and recovery rules. Do not claim full CEOS retirement until all required capabilities reach parity, not just CLI parity.
5. **Studio/Starter Kit and Release parity.** Port S01–S14 updater/ownership, per-platform SDK, narrative and release evidence gates. Separate VK/Yandex binary builds, host acceptance and human release authority remain.
6. **Two mature-game pilots.** Run read-only plan, evidence manifest, import and native resume on copies of **«Поцелуй на краю света»** and **«Season of Broken Hearts»** where available, comparing source/evidence before and after; require owner signoff. Only then label CEOS/Starter Kit optional archival sources and retire their operational use.

### Required automated and host verification

- Golden fixture comparison against pinned CEOS 0.5.40: stage transitions, cycles, terminal results, checkpoint ordering, source hashes, web/capability blockers, linked recovery and error codes. Supplement fixture versions from actual game archives; no invented historical formats.
- Read-only and mutation tests on clean/dirty Git, nested Git roots, CRLF on Windows, symlink/junction and inode substitution, migrated directory, moved artifact, incomplete checkpoint, stale HEAD, lost evidence, multiple active runs, terminal BLOCKED and duplicate import.
- Fault injection at every archive/staging/activation step; imported bytes and all legacy originals must remain unchanged, and partial writes must not become active.
- Clean Node 22/24 CLI tests with CEOS absent; no direct/indirect runtime `codex-engineering-os` or global `ceos` call in shipping code, installer, `package.json` or CLI. Source fixture tests may retain names/legacy schema data without depending on the package.
- On Windows NTFS real host: migration from verified game copy, read-only preview, apply with explicit acceptance, resume after fresh host capability attestation, and owner-approved rollback; publish/log exact hashes and source HEAD. Until observed, report `BLOCKED_HOST_LEGACY_MIGRATION`, not PASS.
- Release readiness remains separately gated by real browser/device and VK/Yandex requirements; workflow tests are not release certification.

## Rollout and compatibility

- Introduce a new **native-engine branch/PR**; keep `main` and current projects functional. Draft PR #5 stays unmerged and is superseded/closed only after the native equivalent is reviewed. Avoid force-updating protected refs or silently rebasing user work.
- Version migrations with a schema registry (`ceos-0.5.40`, others after proof). Future Ludory schema migrations are append-only and independently tested.
- Existing projects with only a CEOS manifest (no `ludory.project.json`) first use Studio’s already-tested metadata-only adoption; never infer missing IDs/targets from CEOS run metadata.
- Do not retire CEOS or Starter Kit until native AI/Studio/Release parity and both game-pilot evidence gates have actually passed. Native CLI can launch earlier, but it must communicate missing capabilities honestly.

## Owner decisions still to validate in the design review

- Confirmed: full historical preservation and ability to resume unfinished compatible runs, with *fresh* capability checks.
- Implementation judgment: old run artifacts are imported as immutable raw evidence plus a separately verified native state; authority is never inherited. Missing or unsupported old runs remain available as blocked archives.
- Suggested first native workflow implementation: `audit-repair-loop` and `production-art` in that order, because they are the two explicitly declared upstream pipelines. All source groups remain tracked for full replacement.
