# Studio CEOS Workflow Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route CEOS 0.5.40 workflow inspection, scoped start, guided continuation and checkpoints through `ludory workflow`, preserving CEOS state and an explicit write boundary.

**Architecture:** Studio holds a small standalone CEOS entry resolver/transport and a pure command planner. Node invokes the inspected CEOS JS entry without a shell; CEOS owns all run/evidence semantics and outputs. Strict preview vs `--apply` prevents unintentional mutations.

**Tech Stack:** Node.js >=22, ESM, `fs`, `path`, `child_process.spawnSync`, `node:test`; no external runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-studio-ceos-workflow-adapter-design.md`

## Global Constraints

- Compatible CEOS is pinned to **0.5.40**, upstream interface source SHA `c8cc13bd3852409be93097ee823e9cd35e512b73`; do not support unknown versions without a separate parity pass.
- New UI: `ludory workflow doctor|status|next|start|continue|checkpoint --project DIR [--ceos-entry absolute-path] [--json]`; no passthrough command/option execution.
- `start`, guided `continue`, and `checkpoint` perform no CEOS mutation unless explicitly `--apply`. Read-only `next` always uses CEOS `continue --mode inspect`.
- Validated canonical `ludory.project.json` is required, but never edited. CEOS `.codex-os` and `.ceos-runs` belong to CEOS, never rewritten by Ludory directly.
- Real Node binary runs the validated absolute `bin/ceos.mjs` using `shell:false`, bounded time/memory, inherited env without printing its content. No `ceos.cmd`, no network install.
- Preserve exact CEOS JSON payload and exit code in a Ludory result envelope; never turn a CEOS blocker/error into `PASS`.
- Existing Studio commands, file ownership, profile updates, Core and release gates remain unchanged.

## Review Focus

1. **Missing/stale global CEOS shim:** test missing entry/junction, wrong package name, `VERSION` mismatch, and explicit path fallback; must block before invocation.
2. **Text that resembles CLI flags/shell:** test hostile scope/run/artifact strings passed as literal argv values, rejected identifiers and unknown flags, with `shell:false`.
3. **Misleading successful CLI result:** test valid JSON with CEOS exit 2/3, invalid/truncated JSON, timeout, overflow, and stderr; return a true blocker/error, not success.
4. **Project swapped between preview/apply:** test directory identity and manifest hash revalidation before any mutating command.
5. **Unexpected side effects during preview:** test a real fake CEOS entry writes a marker only on mutation; `start`/`continue`/`checkpoint` previews never cause markers, and `--apply` invokes exactly once.

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/studio/src/ceos-bridge.mjs` (new) | Resolve/validate CEOS installation and run a bounded argv-only subprocess, parse protocol and errors. |
| `packages/studio/src/workflows.mjs` (new) | Strict workflow command plans, supported options, read/write authorization and stale-plan protection. |
| `packages/studio/src/cli.mjs` | Add `workflow` command family while retaining established option/exit conventions. |
| `packages/studio/test/ceos-bridge.test.mjs` (new) | Temp fake CEOS packages, resolution, subprocess/error/limit tests. |
| `packages/studio/test/workflows.test.mjs` (new) | Scope-to-argv contracts, plan/revalidation and read-only/`--apply` tests. |
| `packages/studio/test/cli.test.mjs` | Real CLI entry and existing-command regression tests. |
| `README.md`, `packages/studio/README.md`, `package.json` | Usage, boundary and syntax checks. |

## Task 1 — CEOS Entry and Transport

**Interfaces:** `resolveCeosEntry({ entry, env? }): { entryPath, version }` throws typed `BLOCKED_CEOS_*` error; `invokeCeos({entryPath,project,args,timeoutMs?}): { ceosExitCode, data }` invokes only process.execPath/argv and returns parsed CEOS JSON with bounded output.

- [ ] Write RED tests with an actual temporary `bin/ceos.mjs`, `package.json` and `VERSION` file: explicit valid path, nonexistent path, stale directory symlink, wrong package/version, absolute-path enforcement and JSON response on all valid CEOS exit codes.
- [ ] Run `node packages/studio/test/ceos-bridge.test.mjs`; expected FAIL because exports are missing.
- [ ] Implement package/root/entry checks, explicit/env/npm-global lookup (no network), secure argv-only spawn, bounded stdout/stderr/timeout, fail-closed protocol parser.
- [ ] Run targeted suite to GREEN; run `npm test` and `npm run check`, both PASS.
- [ ] Check that `--ceos-entry` and `LUDORY_CEOS_ENTRY` have explicit, documented precedence; never write project files during discovery.

## Task 2 — Workflow Plans and Execution Boundary

**Interfaces:** `planWorkflow(projectDir, operation, options): WorkflowPlan` generates read-only plan with exact entry/version, canonical project inode/manifest hash, operation and CEOS argv. `executeWorkflow(plan, {apply=false}): WorkflowResult` revalidates source/entry/project, invokes read commands immediately; invokes mutating commands only on explicitly applied READY plans; returns `READY`, `BLOCKED`, `APPLIED` or accurately mapped CEOS outcome without synthesizing success.

- [ ] Write RED tests for all six exact CEOS argument vectors, missing/malformed required scope, unsupported pipeline, existing game files unchanged, preview marker absence, JSON/exit propagation, `--apply` exactly once, stale manifest/root and changed CEOS entry/version.
- [ ] Run `node packages/studio/test/workflows.test.mjs`; expected FAIL for missing exports.
- [ ] Implement planner with fixed allowlisted operations/options and CEOS 0.5.40 mapping; use existing `projectRoot`, `directoryIdentity`, `isOriginalDirectory`, `readSourceFile`, `defineGame` without modifying manifests.
- [ ] Implement execution boundary and original code/status forwarding; do not retry CEOS mutations after uncertain failures.
- [ ] Run targeted suite to GREEN, plus `npm test`, `npm run check` PASS.

## Task 3 — Unified CLI and Documentation

**Interfaces:** `runCli(['workflow',operation,...flags])` maps existing CLI exit codes (`0` success/preview, `1` invocation/config failure, `2` CEOS BLOCKED, `3` CEOS ESCALATE). Unknown flags/duplicates and `--apply` on doctor/status/next fail; `--json` returns Ludory envelope with exact `ceosExitCode` and `ceos` payload.

- [ ] Write RED CLI tests using a temp fixture and a spawned fake CEOS package; assert `help`, all workflow operations, JSON errors, blocked/ESCALATE, unsupported options, no writes without `--apply`, and previous init/migrate/create/profiles intact.
- [ ] Run `node packages/studio/test/cli.test.mjs`; expected FAIL for unknown workflow command.
- [ ] Wire strict new argument routing and presentation into `cli.mjs`; update both READMEs and `package.json` syntax checks.
- [ ] Run new CLI tests to GREEN; full `npm test`, `npm run check` and `node examples/core-session.mjs` PASS.

## Task 4 — Independent Review and PR

- [ ] Review every changed file against approved spec, inspect `AGENTS.md` if present, disallow shell/user command passthrough, arbitrary project mutations or CEOS verdict upcasting.
- [ ] Independent fresh reviewer assesses plan alignment, security, Windows path transport, stale-plan handling and actual test behavior. Any Critical/Important issue needs a failing regression followed by fix.
- [ ] Re-run full tests from final exact source snapshot, record output and exit counts, verify file SHAs against uploaded GitHub blobs.
- [ ] Open PR against `m-amirov/ludory:main` without merging. Require Node 22/24 CI at exact PR HEAD; report host-installed CEOS 0.5.40 execution as BLOCKED unless actually observed.

## Self-review

- Spec coverage: six commands, pin/discovery, read-only vs apply, CEOS-owned data, protocol and error handling, examples and release/host limitations each map to Tasks 1–3.
- Type consistency: Task 1 transport types feed Task 2 plan/execution; Task 3 uses Task 2 results and preserves existing `runCli` signature.
- Required failure classes in Review Focus are explicit RED tests in their owning tasks.
- Runtime/Connect/Release and native AI migration deliberately excluded; no existing-game file rewrite.
