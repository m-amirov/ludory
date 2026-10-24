# Existing Game Profile Adoption and Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Ludory Studio to apply and update versioned profiles in existing games while preserving every project-owned file.

**Architecture:** Extend Studio with a separate profile-management module that produces read-only, revalidated plans and stores its only managed outputs below `.ludory/profiles/`. Content-addressed immutable profile snapshots and append-only, exclusively published numbered revisions prevent concurrent pointer overwrites and allow recovery without touching runtime/template files. Add three operations to the existing CLI, preserve its preview-by-default contract, and test conflicts and fault injection.

**Tech Stack:** Node.js >=22, ESM, built-in `fs`, `path`, `crypto`, `node:test`; existing Core `defineGame` and Studio catalog. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-studio-existing-game-profiles-design.md`

## Global Constraints

- Existing games require `ludory.project.json`; profile `engine` must equal manifest `engine`; each manifest target must be supported by profile.
- Never modify `ludory.project.json`, `ludory.studio.json`, `AGENTS.md`, `game-spec.yaml`, `package.json`, `src/**`, `public/**`, assets, SDK, saved games or evidence.
- No source/template file adoption based solely on the PR #3 creation receipt; no changes to Core/Runtime/Connect/Release.
- All writes are opt-in `--apply`, no executable catalog hooks, no `npm install` or external network activity.
- Default deny on any unowned `.ludory/profiles` path, unexpected symlink/reparse path, mismatched source hash, stale plan, directory swap or managed drift.
- Reject same-version changed source and downgraded profile; do not infer or switch profile identities.
- Deliver observable `READY`, `IN_SYNC`, `BLOCKED` or `CONFLICT` states, explicit conflicts and `--json` reports.
- Final gates: `npm test`, `npm run check`, `node examples/core-session.mjs`, GitHub CI Node 22 and 24; no host/runtime/release PASS inferred.

## Review Focus

1. Manifest updated between preview/apply: test that `applyProfilePlan` blocks before writes.
2. Previously untracked `.ludory/profiles` folder/file collision: test preserving foreign bytes and no ownership takeover.
3. Mutable local catalog version/SHA after preview: test recomputed plan rejects the stale one.
4. Windows paths and symlinked ancestor / swapped root: test fail-closed, no writes outside canonical project.
5. User edits to active state or snapshot: test `CONFLICT` without replacing user changes.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/studio/src/profile-state.mjs` (new) | Canonical active-state schema, hash verification, safe path/read helpers and immutable snapshot serialization. |
| `packages/studio/src/profile-management.mjs` (new) | Read-only `planProfileApply`, `planProfileUpdate`, `profileStatus`; transactional `applyProfilePlan`. |
| `packages/studio/src/cli.mjs` | `profiles apply/update/status` option validation, output and return codes; old commands unchanged. |
| `packages/studio/test/profile-management.test.mjs` (new) | Adoption, update, status, path safety, fault and ownership tests. |
| `packages/studio/test/cli.test.mjs` | E2E command and JSON/exit code regression coverage. |
| `packages/studio/README.md`, `README.md` | Operational examples, limitations, recovery steps. |
| `package.json` | Add `node --check` for new Studio modules. |

## Task 1: Profile State and Read-Only Planning

**Files:**
- Create: `packages/studio/src/profile-state.mjs`, `packages/studio/src/profile-management.mjs`
- Test: `packages/studio/test/profile-management.test.mjs`

**Interfaces:**
- `readProfileState(project: string): StateRead` — validates physical `.ludory/profiles/`, state schema, snapshot path and SHA; returns `missing` or valid state, throws on drift/unsafe links. The existing Studio project root validator must be reused.
- `profileSnapshot(profile: Profile): Buffer` — deterministic JSON: `schemaVersion:1`, id, version, engine, sorted supported targets and source SHA; exclude executable and filesystem pointers.
- `planProfileApply(projectDir: string, options: { name: string, catalog?: string }): Plan` — status, manifest checksum, root inode, expected absence/managed state, exact proposed hashes and paths; no writes.
- `planProfileUpdate(projectDir: string, options?: { catalog?: string }): Plan` — discover installed profile ID solely from valid managed state, compare SemVer and source SHA; no writes.
- `profileStatus(projectDir: string, options?: { catalog?: string }): Status` — report installed/current versions, hashes and drift; no writes.

- [ ] **Step 1: Write failing tests** for existing non-empty `web` game preview READY and unchanged tree; incompatible engine/targets BLOCKED; absent canonical manifest BLOCKED; existing foreign `.ludory/profiles` path CONFLICT; valid state IN_SYNC; stale/edited/invalid state CONFLICT; modified source at same version CONFLICT; newer version READY and older version CONFLICT. Use custom temporary profile catalog to simulate version bump without altering built-ins. Include `__proto__`-like JSON path/value case without prototype mutation.
- [ ] **Step 2: Run** `node --test packages/studio/test/profile-management.test.mjs`; expected FAIL (missing module/exports).
- [ ] **Step 3: Implement** pure serialization and state readers with exact shape, bounded JSON sizes and `lstat` plus `realpath`/directory-identity checks; implement read-only planners using `loadCatalog()` and existing `projectRoot()`. Compare `Buffer` hashes and reject profile identity switching.
- [ ] **Step 4: Re-run** the targeted tests; expected PASS. Existing `node --test packages/studio/test/catalog.test.mjs packages/studio/test/scaffold.test.mjs` still PASS.
- [ ] **Step 5: Commit** Task 1 files on isolated feature branch.

## Task 2: Explicit Safe Apply and Upgrade

**Files:**
- Modify: `packages/studio/src/profile-management.mjs`, `packages/studio/src/profile-state.mjs`
- Test: `packages/studio/test/profile-management.test.mjs`

**Interfaces:**
- `applyProfilePlan(plan: Plan): ApplyResult` — only READY plans; must reconstruct plan from original command/arguments and compare fingerprint, root identity, manifest/source/state hashes before opening outputs. Returns `APPLIED` or throws with preserved original state.
- Managed root: `.ludory/profiles/`, content-addressed `snapshots/<sha256>.json`, exclusive initial `active.json`, immutable `revisions/00000001.json`, `00000002.json`, ... and retained `history/` copies. No managed path outside this namespace.

- [ ] **Step 1: Write failing tests** for `--apply` equivalent application, idempotent reapply, upgrade preserving first snapshot and receipt, byte-for-byte protection of product files, catalog/manifest mutation, symlink and directory swap, previously edited active/snapshot, injected failure before commit point, collision with foreign existing target, and multi-step nested parent rename. Assert previous active revision survives and outside dir unaffected.
- [ ] **Step 2: Run** `node --test packages/studio/test/profile-management.test.mjs`; expected FAIL for missing apply behavior.
- [ ] **Step 3: Implement** exclusive creation and no-follow directory traversal, in-process root inode anchoring, private transactional staging file and atomic same-directory **hard-link commit without replacing existing paths**, committed-state fingerprinting, orphan-safe cleanup that never deletes modified user files, and retained revision history. For an unexpected collision return conflict without destructive overwrite. Document filesystem atomicity limits and manual recovery.
- [ ] **Step 4: Re-run** targeted suite; expected PASS, and read-only status reports correct installed version/source.
- [ ] **Step 5: Commit** Task 2 files on isolated feature branch.

## Task 3: CLI and Docs

**Files:**
- Modify: `packages/studio/src/cli.mjs`, `packages/studio/test/cli.test.mjs`, `packages/studio/README.md`, `README.md`, `package.json`

**Interfaces:**
- `ludory profiles apply --project DIR --name ID [--catalog DIR] [--json] [--apply]`
- `ludory profiles update --project DIR [--catalog DIR] [--json] [--apply]`
- `ludory profiles status --project DIR [--catalog DIR] [--json]`
- CLI result exit `0` for READY/IN_SYNC/APPLIED/healthy status; `2` for BLOCKED/CONFLICT; `1` for malformed arguments/errors. Existing list/show/create/migrate flows retain outputs.

- [ ] **Step 1: Write failing CLI tests** with temporary existing game for preview (zero bytes written), apply then status, version bump update, `--json` validity, wrong/missing flag, `--apply` on status forbidden, `--apply` on incompatible profile producing exit 2, existing `profiles list/show` regression.
- [ ] **Step 2: Run** `node --test packages/studio/test/cli.test.mjs`; expected FAIL for new subcommands.
- [ ] **Step 3: Wire** imports/options/output to profile-management without changing existing commands; update README with actual command examples, drift handling and explicit non-goals; add node `--check` entries for new modules.
- [ ] **Step 4: Run** `npm test`, `npm run check`, `node examples/core-session.mjs`; expected PASS (log exact test count).
- [ ] **Step 5: Commit** Task 3 files on isolated feature branch.

## Task 4: Acceptance, Review and Pull Request

**Files:**
- Modify only defects uncovered by review, and regression tests demonstrating the fix.

- [ ] **Step 1:** Independently review diff against spec and `AGENTS.md`; inspect use of destructive operations, trust boundary of receipt and foreign state, semantic versioning and write races.
- [ ] **Step 2:** Run full local gates from clean feature tree; record exact commands, exit statuses and test counts.
- [ ] **Step 3:** Publish PR to `m-amirov/ludory` targeting `main`, include spec, plan, changed-file scope, file-protection claims and unsupported migration limits. Do not merge automatically unless user explicitly asks.
- [ ] **Step 4:** Verify remote GitHub Actions run on PR head for both Node 22 and 24, and report any gates not actually observed as BLOCKED, not PASS.

## Self-Review

- Spec coverage: adoption, updater, declarative-only profile, read-only default, version rules, source drift, ownership, recovery and CLI are covered by Tasks 1–3; parity/host execution explicitly excluded.
- Potentially harmful target mutation: tests in Task 2 cover all writable paths and named dangerous inputs.
- APIs used by CLI are defined in Tasks 1–2; verification and non-merge policy in Task 4.
- The first implementation deliberately updates only Ludory-managed profile configuration, not source/template runtime files.
