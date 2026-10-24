# Native Ludory AI Foundation Implementation Plan

> **UPDATE:** The native foundation tasks were delivered in Draft PR #6. The originally planned historical CEOS importer and restrictive Git/source-binding model are superseded by [the owner's simplified native development decision](../specs/2026-10-24-native-dev-workflows-simplification-design.md). Do not execute the obsolete importer task below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the external CEOS workflow CLI adapter with a minimal, safe, independently tested native `@ludory/ai` workflow engine and the same Ludory Studio CLI surface, without requiring CEOS to be installed.

**Architecture:** A new `@ludory/ai` workspace package owns versioned pipeline definitions, source/evidence checks, immutable runs and append-only checkpoint events. Studio maps allowlisted commands to typed native methods. This first independently releasable foundation intentionally does **not** import historical CEOS data, trigger external AI agents or certify release PASS; those follow in separate parity-gated plans from the approved spec.

**Tech Stack:** Node.js >=22 ESM (`fs`, `path`, `crypto`, `child_process` for read-only Git only), npm workspaces and `node:test`. No new external runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-native-ai-and-one-time-ceos-migration-design.md` (approved by owner on 2026-10-24). This plan covers **native AI foundation only**. CEOS archive/import, agent routing, remaining C01–C15, Starter S01–S14 and host pilot/release gates are separate projects and remain visibly incomplete.

## Global Constraints

- No runtime or test invocation of installed `codex-engineering-os`, no npm-global CEOS discovery, no `ceos` subprocess and no arbitrary shell forwarding. A native run works when no CEOS is on PATH.
- Do not modify `.ceos-runs`, `.codex-os`, `game-spec.yaml`, `AGENTS.md`, game source/assets/saves/rights or SDK settings. Writes are solely under Ludory-owned `.ludory/ai/` after explicit `--apply`.
- Preserve distinction between planning, human/agent action requests, actual verified checkpoints, and release PASS; do not synthesize evidence or promote BLOCKED to PASS.
- Require a valid existing `ludory.project.json`, source Git provenance and stable directory identity before actions. Revalidate before publishing.
- Keep `@ludory/core` platform-neutral; `@ludory/ai` is Node-side development orchestration, not game runtime.
- The draft PR #5 is not a dependency and must not merge into main; native branch starts at clean main. Any unmerged PR #5 code reused must be edited to remove CEOS transport.
- Windows and host-running AI/CEOS imports remain BLOCKED until actual tests; Node 22/24 CI on exact PR HEAD is required.

## Review Focus

1. **Interrupted write / partial checkpoint**: readers never treat missing commit marker or partial event bytes as active/verified (Task 3 tests).
2. **Source swap and symlink**: original directory identity, manifest and Git head must revalidate between plan and apply; no redirected write (Tasks 2/3/4 tests).
3. **Misleading `PASS` or agent execution**: positive result requires a separate Release verifier; `continue --apply` must never imply a real agent ran (Tasks 1/4/5 tests).
4. **Two concurrent/incompatible runs**: `latest` is rejected as ambiguous when multiple active runs; duplicate/replayed event rejected (Tasks 3/4 tests).
5. **CEOS unexpectedly required**: all six CLI commands operate with `LUDORY_CEOS_ENTRY` unset and no globally installed CEOS; old adapter code not shipped in this PR (Task 5 tests and final audit).

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/ai/package.json`, `packages/ai/src/index.mjs` | Native AI workspace package and stable public exports |
| `packages/ai/src/pipelines.mjs` | Frozen 0.5.40-derived versioned stage graphs and legal transition decisions |
| `packages/ai/src/source.mjs` | Canonical project/manifest/Git preflight, safe artifact hashes and source binding |
| `packages/ai/src/store.mjs` | Append-only run/event storage with exclusive commit markers, idempotence/conflicts and replay integrity |
| `packages/ai/src/workflows.mjs` | Typed six-operation planner and explicit apply boundary, no external AI invocation |
| `packages/ai/test/{pipelines,source,store,workflows}.test.mjs` | True behavior and fault-injection regressions |
| `packages/studio/src/cli.mjs`, `packages/studio/test/cli.test.mjs` | Unified CLI to native AI with predictable JSON/status/exit behavior; preserve existing commands |
| `packages/studio/src/{ceos-bridge,workflows}.mjs`, CEOS fake tests | Not included in native branch; from unmerged draft PR #5 only |
| `package.json`, `README.md`, `packages/studio/README.md`, `docs/ROADMAP.md` | Test script, usage, staged feature status and non-parity caveats |

## Task 1 — Native Pipeline Contracts

**Interfaces:** `getPipeline(id): {version:1,id,stages:[{id,requiresArtifacts,finalReview}],maxCyclesDefault:3}`; `nextStage(pipeline,currentStage): string|null`; `checkTransition(pipeline,stage,outcome,{hasEvidence,hasPositiveReleaseEvidence=false}): {ok,code,nextStage?,terminal?}`.

- [ ] RED: `pipelines.test.mjs` validates exact six stages of each of `audit-repair-loop` and `production-art` from approved source, unknown IDs blocked, illegal jump rejected, `REAUDITED PASS` without an independent positive verifier blocked, terminal verdict cannot be reused.
- [ ] Run `node --test packages/ai/test/pipelines.test.mjs`; expected FAIL (`ERR_MODULE_NOT_FOUND`).
- [ ] GREEN: implement frozen stage definitions and transition guard; `CONTINUE` advances sequentially, `PASS` is fail-closed until Release parity is integrated, `BLOCKED`/`ESCALATE` terminal, stage-limited `FAIL` matches CEOS source. Keep the API purely functional.
- [ ] Rerun targeted tests (PASS); include workspace package in `npm test`, and run full suite (PASS).
- [ ] Commit `feat(ai): add native versioned workflow stage contracts` (or record a GitHub snapshot ruling if no local Git metadata).

## Task 2 — Source and Artifact Preflight

**Interfaces:** `inspectNativeProject(projectDir): {project,rootIdentity,manifest,manifestSha256,gitHead,gitClean}`; `verifyNativeSource(binding): {ok,code?}`; `snapshotArtifact(project,relativePath): {path,sha256,size}`. Fail closed; no writes.

- [ ] RED: `source.test.mjs` covers valid canonical manifest+clean Git, dirty HEAD, invalid/missing manifest, symlinked root/artifact, absolute/path traversal, changed artifact hash, and Windows-style escape strings. Ensure read-only inspection leaves files unchanged.
- [ ] Run `node --test packages/ai/test/source.test.mjs`; expected FAIL for absent exports.
- [ ] GREEN: implement source pin with `@ludory/core` definition, project inode/canonical root (reuse Studio safety only if no circular package dependency), `git -C ... rev-parse` and safe worktree status; exclude **only** `.ludory/ai/` from Git provenance fingerprint; reject symlinked artifact parents and output paths.
- [ ] Targeted and full tests green; `npm run check` green. Commit or ledger ruling.

## Task 3 — Append-Only Native Store

**Interfaces:** `planNewRun(project,definition): RunPlan`; `commitNewRun(plan): NativeRun`; `readNativeRun(project,runRef='latest'): {run,events,integrity,nextStage,status}`; `planNativeEvent(project,runRef,event): EventPlan`; `commitNativeEvent(plan): NativeRun`. Stored files: `.ludory/ai/runs/<runId>/run.json`, `commit.json`, `events/000001.json`, ... with SHA-256 previous-event chain and immutable records. `commit.json` marks run visibility; event files are fully written to uniquely named temp paths then published exclusively. Do not use a mutable `latest.json` pointer.

- [ ] RED: `store.test.mjs` asserts no directories after plan, one committed native run after explicit commit, deterministic read replay, duplicate/conflicting/out-of-order checkpoint rejection, two active runs causing `latest` conflict, tampering and truncated event detection, uncommitted runs invisible, injected failure preserving original files; lost locks block rather than auto-delete.
- [ ] Run `node --test packages/ai/test/store.test.mjs`; expected FAIL for missing module.
- [ ] GREEN: implement lock/transaction semantics inside verified `.ludory/ai/`, exclude symlinks and foreign existing files, strictly source-bound plan fingerprints and append-only receipts. Never rewrite a committed event; incomplete unactivated debris remains detectable for manual recovery.
- [ ] Targeted and full tests green; `npm run check` green. Commit or ledger ruling.

## Task 4 — Native Workflow Controller

**Interfaces:** `planWorkflow(projectDir,operation,options={}): WorkflowPlan|WorkflowInspection`; `executeWorkflow(plan,{apply=false}): WorkflowResult`, with `doctor|status|next|start|continue|checkpoint` and stable `status`, `operation`, `writes`, `conflicts`, `runId`, `nextAction` JSON fields; no `ceosExitCode` because CEOS is not executed.

- [ ] RED: `workflows.test.mjs` validates all six commands, read-only doctor/status/next, scoped start preview and apply, checkpoint artifact verification and append-only receipt, continue preview vs explicit `ACTION_REQUESTED` event (not fake agent execution), stale manifest/HEAD before apply, invalid stages/options/outcomes, unsupported `PASS` blocked with `EVIDENCE_VERIFIER_NOT_READY`, terminal run blocks continuation.
- [ ] Run `node --test packages/ai/test/workflows.test.mjs`; expected FAIL for missing exports.
- [ ] GREEN: wire typed options to Task 1 pipeline, Task 2 preflight and Task 3 store; `continue --apply` may persist at most an action request awaiting real agent evidence, never advance stage by itself. Reject `--apply` on read-only operations.
- [ ] Targeted/full tests, `npm run check` green. Commit or ledger ruling.

## Task 5 — Unified Studio CLI Without CEOS Dependency

**Interfaces:** Preserve `runCli(argv,{out,err}={})` and existing Studio commands. New `workflow` route calls `@ludory/ai` in process; flags: shared `--project`, `--json`, `--apply` (mutating only), `--run`; start has `--pipeline`, `--target`, `--in-scope`, `--acceptance`, `--mutation-boundary`, optional `--out-of-scope`; checkpoint has `--stage`, `--artifact`, `--outcome`. `--ceos-entry` is rejected as obsolete rather than silently accepted.

- [ ] RED: `cli.test.mjs` proves six native operations under `LUDORY_CEOS_ENTRY=/missing` and no CEOS global; verifies no project mutation on preview, only `.ludory/ai` writes after apply, JSON errors always structured, explicit no-release-PASS, existing init/migrate/profile/create still pass, CEOS `--ceos-entry` rejected.
- [ ] Run `node --test packages/studio/test/cli.test.mjs`; expected FAIL for missing/native dispatch.
- [ ] GREEN: connect native controller to Studio CLI, delete imports/references to old CEOS adapter from shipping code, update workspaces/test/check/docs/roadmap and keep source inventory history intact. Existing PR #5 transport tests are **not** ported into the native branch.
- [ ] `npm test`, `npm run check`, `node examples/core-session.mjs` PASS; no CEOS command/package usage in shipped files (`rg` audit excludes historical docs/fixtures). Commit or ledger ruling.

## Task 6 — Independent Review and Delivery

- [ ] Review native changes vs approved spec and `AGENTS.md`; run targeted test suites with real temp projects plus a missing-CEOS environment.
- [ ] Fresh independent reviewer: stage correctness, atomic event publication, symlink/races, source/manifest provenance, CLI preview/apply, truthful no-PASS outcomes, Windows NTFS limits. Critical/Important findings get failing tests before correction.
- [ ] Run final complete suite and Node22/24 GitHub Actions at exact published commit. Verify Git object SHAs against local files and branch diff excludes CEOS adapter.
- [ ] Open a **new Draft PR targeting main** for native foundation. Do not merge it or draft PR #5. Record incomplete next phases plainly; actual Windows native host smoke remains blocked until observed.

## Deferred plans / ordering

1. **No legacy importer:** canceled by the owner. Existing games are frozen and historical CEOS checkpoints are retained only in their original repositories.
2. **Ludory AI execution:** first connect real task execution/agents and the simple `continue` experience, without new nested session/worktree contracts.
3. **New-game Runtime/Connect/Release:** use isolated Ludory test games for platform build/SDK/release gates and Windows host acceptance; no mature-game pilots while frozen.

## Self-review

- Scope is deliberately a testable foundation, **not full CEOS replacement**. Every excluded full-spec requirement is listed under Deferred plans and must remain `NOT_MIGRATED` until separately accepted.
- Five Review Focus failure classes are pinned to named tests. APIs in later tasks use exact earlier interfaces; no generic CLI passthrough.
- The sequence is test-first, no productive source changes before RED, per-task green suites, final whole-branch reviewer and Node 22/24 CI. The plan requires explicit owner execution-method choice before Task 1.
