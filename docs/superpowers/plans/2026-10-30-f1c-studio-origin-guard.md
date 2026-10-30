# F1c Studio-origin AI Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent every native AI mutation on a project that lacks an independent, verified Studio host registration, without breaking legitimate dirty/unversioned Studio games or read-only diagnostics.

**Architecture:** Extract the existing `component-trust.mjs` host registry verbatim into a narrow `@ludory/studio-trust` workspace package with only the existing Core dependency, re-export it from Studio, and add a shared read-only Studio-origin verifier. AI consumes only that verifier and enforces it both when planning mutations and immediately before commit/host execution. Preserve the existing registry format, source pinning, CLI behavior, and read-only commands.

**Tech Stack:** Node.js >=22, ESM, native `node:test`, SHA-256, `@ludory/core` physical-root check, existing npm workspaces and GitHub CI.

**Spec:** `docs/superpowers/specs/2026-10-30-f1c-studio-origin-guard-design.md` (approved by owner 2026-10-30).

## Global Constraints

- F1c worktree `/.worktrees/f1c-ai-origin-trust/` begins at accepted `main` `468bbfa4`; no modifications to CEOS, Starter Kit or frozen production games.
- New Studio game sources may be dirty or unversioned. The three pinned Studio files require byte-identical, safe regular files; ordinary source changes do not revoke trust.
- A missing host trust record blocks mutation. No silent enrollment, cross-host restore, upgrade, or migration.
- No API/provider calls, platform publication, fake Web/ImageGen/Release PASS or unauthorized merge.
- Tests run with the ephemeral `LUDORY_STUDIO_TRUST_DIR` configured by `packages/studio/test/setup-trust-env.mjs`.

## File map

- Create `packages/studio-trust/package.json` and `packages/studio-trust/src/index.mjs`: unchanged v1 host registry ownership + new `verifyStudioOrigin(projectDir): {ok:boolean,code:string,project:string}` read-only verifier; exact existing registry serialization.
- Modify `packages/studio/src/component-trust.mjs`: compatibility re-exports; `packages/studio/package.json`, `packages/ai/package.json`, root `package-lock.json` dependency wiring (no new third-party packages).
- Modify `packages/ai/src/executor.mjs`: `hasStudioCreationReceipt` uses `verifyStudioOrigin` (no marker-only trust); `packages/ai/src/workflows.mjs`: mutation checks on planning and apply.
- Modify test fixtures in `packages/ai/test/helpers/` and affected AI/Studio tests to register *real* Studio game provenance for positive paths; retain truly foreign fixtures for negative paths.
- Create `packages/ai/test/f1c-origin-guard.test.mjs`; add regressions to `packages/studio/test/native-workflow-cli.test.mjs` and Studio component trust tests; update CLI guidance and F1 evidence index.

## Review Focus (input classes requiring explicit tests)

1. Foreign project with copied/forged `ludory.studio.json` → all mutation previews/apply are blocked; no new `.ludory` namespace. Task 2.
2. Previously trusted plan, then receipt/state/host pin is changed before apply → reject without writing or starting Codex/Web. Task 3.
3. Project directory swapped to a symlink or an inode-changed folder → refuse, never write through replacement. Tasks 1 and 3.
4. New Studio-created project with no Git, or with modified/untracked source files → native start and safe manual event continue to work. Task 4.
5. A pre-existing foreign run has recognized crash remnants → `recover-storage` inventory is read-only, but apply is forbidden even with confirmation. Task 3.

---

### Task 1: Shared host trust without registry format changes

**Files:** Create `packages/studio-trust/package.json`, `packages/studio-trust/src/index.mjs`, test `packages/studio/test/f1c-studio-origin.test.mjs`; modify `packages/studio/src/component-trust.mjs`, package manifests and lockfile.

**Interfaces:** Export `registerComponentTrust(project, expected)`, `assertComponentTrust(project, expected)`, `advanceComponentTrust(project, expected, nextStateSha256)`, `hostTrustDigest(bytes)`, `isMissingHostTrust(error)` unchanged. Add `verifyStudioOrigin(projectDir)` returning a stable `{ok, code, project}` value without modifications; `code` distinguishes missing registry, changed pinned data and unsafe path. Define a single bounded, `O_NOFOLLOW`, identity-checked byte reader for the three project files. Use `canonicalPhysicalDirectory` from Core to validate root and `dev:ino` via `lstat` BigInt.

- [ ] Write test `real Studio creation verifies against its independent record` using `planCreate/applyCreatePlan`; first import of new verifier should fail before implementation.
- [ ] Write test `local forged receipt, missing trust record, changed managed state, unsafe linked receipt, symlink root, swapped root` returning non-OK and no disk writes; verify source tree digest.
- [ ] Run `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/f1c-studio-origin.test.mjs` and confirm RED due to missing verifier.
- [ ] Move trust functions byte-for-byte to the new package, make Studio re-export, implement `verifyStudioOrigin` using the existing trust pin and the three bounded files; update workspace dependencies and `package-lock.json` with package-lock-only install (no unrelated dependency upgrades).
- [ ] Run focused tests and existing `packages/studio/test/component-updates.test.mjs`, expecting green; commit `refactor(f1c): share Studio host trust with AI`.

### Task 2: Block unauthorized native workflow planning

**Files:** Modify `packages/ai/src/executor.mjs`, `packages/ai/src/workflows.mjs`; create `packages/ai/test/f1c-origin-guard.test.mjs`.

**Interfaces:** `hasStudioCreationReceipt(project): boolean` becomes a compatibility wrapper around `verifyStudioOrigin(project).ok`; add optional internal `studioOriginConflict(project)` to produce stable `NATIVE_STUDIO_ORIGIN_*` conflict strings for mutating plans. Do not gate `doctor`, `status` or `next` reads.

- [ ] Write test `foreign and forged projects cannot plan start/continue/checkpoint/cycle/recover` with a raw `nativeProject(t)` and a low-level pre-existing run to exercise non-start operations; assert exact no-write snapshot and no external capability probe.
- [ ] Run the new test and confirm RED: at least foreign `start` is incorrectly `READY` on the baseline.
- [ ] Gate every mutating operation in `planWorkflow` **before** native run planning, including `recover-storage` apply rules, preserving read-only inventory/diagnostics.
- [ ] Replace marker-shape-only implementation of `hasStudioCreationReceipt` with the shared verifier, ensuring all existing AI direct routes inherit it.
- [ ] Run focused tests and document expected behavior changes; commit `fix(f1c): require trusted origin for native AI plans`.

### Task 3: Fail closed on stale apply plans and direct host execution

**Files:** Modify `packages/ai/src/workflows.mjs`, plus tests `packages/ai/test/f1c-origin-guard.test.mjs`, `packages/studio/test/native-workflow-cli.test.mjs`.

**Interfaces:** `executeWorkflow(plan, {apply,executor})` rechecks `verifyStudioOrigin(plan.project)` before any write, including `recover-storage` and `cycle` loops; AI `draft/image/import/narrative/art/quality` entrypoints must replan or recheck origin immediately before first commit or host launch. Continue honoring executor-stopped confirmation in recovery.

- [ ] Write tests `trusted preview rejects missing host pin before apply`, `changed receipt/managed state after preview`, `changed game-root inode`, `foreign orphan recovery can preview but cannot apply`; verify runner callback count zero and user bytes unchanged.
- [ ] Run focused tests, verify RED on a baseline apply bypass (including `recover-storage`).
- [ ] Implement apply-time guard before `commitNewRun`, `commitNativeEvent`, `applyNativeStorageRecovery`, and before Codex/Web helper invocation; add an internal fail-closed contract assertion where a public mutating API bypasses the shared preflight.
- [ ] Verify no synthetic review/result event or duplicate host call; run focused tests until green. Commit `fix(f1c): revalidate origin at mutation boundaries`.

### Task 4: Real Studio fixture compatibility and direct API regressions

**Files:** Modify affected test helpers (`packages/ai/test/helpers/project.mjs`, `image-game.mjs`, `quality-game.mjs`) and positive-path tests (`workflows`, `task-routing`, `draft-tasks`, `narrative-review`, `quality-policy`, `image-tasks`, and Studio CLI fixtures as required); modify `packages/ai/test/f1c-origin-guard.test.mjs`.

**Interfaces:** Introduce `newStudioAiProject(t,{git:boolean}): string` in test helpers backed by `planCreate/applyCreatePlan`; keep `nativeProject(t)` explicitly foreign for regression tests. Existing low-level native store journal tests may continue to use foreign fixtures without elevating their trust.

- [ ] Add a failing positive test: Studio-created game with no `.git` supports `start --apply`, `continue --apply` and `checkpoint --apply`; a Studio game with dirty/untracked source files also works.
- [ ] Verify RED if fixture or guard handles no-Git incorrectly; minimally refactor affected test helpers to use the *real* Studio creation path and remove fabricated receipts.
- [ ] Add cross-entrypoint tests for `route`, `draft`, `image`, `art-review`, `narrative-review`, quality enabling/check; a foreign project never sends a host request or writes, while Studio-owned plans preserve prior explicit host blockers.
- [ ] Run affected suites until green and update `packages/studio/src/cli.mjs` help for `STUDIO_ORIGIN` blocker. Commit `test(f1c): prove trusted Studio fixture and frozen-game isolation`.

### Task 5: Complete acceptance and PR handoff

**Files:** Update `docs/audits/2026-10-30-f1-ai-acceptance.md`, `docs/ROADMAP.md` only if current semantics warrant it, and operator instructions referencing `workflow start`.

- [ ] Run `npm test` (entire Node suite and Quality integration), report exact counts and every non-environmental failure; rerun with approved process capability if sandbox creates child-process `EPERM` false negatives.
- [ ] Run `npm run check`, `node examples/core-session.mjs`, `git diff --check`; audit `git status` for user files/unknown changes.
- [ ] Record `F1c CONTRACT_PASS` only for tests actually observed; real Web DEV/ImageGen/VK/Yandex/Release remains `BLOCKED/NOT_RUN`.
- [ ] Commit bounded docs and implementation; publish branch and open a PR against exact current `main` after checking remote base. Run exact-HEAD Windows/Linux CI and request independent review.
- [ ] Report PR URL, HEAD, checks/evidence, remaining risk and owner merge gate. Do **not** merge without explicit owner approval.
