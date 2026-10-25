# Native AI Task Routing — Slice A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Ludory Studio explain which executor would handle each of the five approved game-development tasks, with trustworthy capability preflight and no execution or project mutation.

**Architecture:** Introduce a small read-only planner in `@ludory/ai`, separate from executor invocation and ledger mutation. Expose it as `ludory workflow route` without changing `workflow start/continue/cycle`; later slices will reuse its task kinds and decisions when they add actual Web DEV and image-generation adapters.

**Tech Stack:** Node.js >=22, ESM, `node:test`, existing `@ludory/ai` and `@ludory/studio` workspaces.

**Spec:** `docs/superpowers/specs/2026-10-25-ai-task-routing-design.md` (this plan implements **Slice A only**; Slices B–D each require a separate plan and host verification).

## Global Constraints

- Route contracts: `mechanics → codex`, `episode-script → web-dev`, `art-concept → web-dev`, `image → Terra then SOL if unpinned`, `functional-check → codex`.
- `READY`, `NEEDS_USER_ACTION`, `BLOCKED` have distinct meanings; never claim an available Web DEV, Terra, SOL, or Image Gen host without host-observed capability evidence.
- Terra→SOL fallback is **preflight-only** and only for `model=auto`; pinned `terra` or `sol` may not be replaced. If no verified image route exists, offer manual handoff.
- Preview is always mutation-free and does not run a model, create run/receipt files or mutate game source. `--apply` is forbidden for the new read-only command.
- Codex tasks retain the current Studio-created-game protection and `EXECUTED_UNVERIFIED` semantics; no release PASS or checkpoint promotion.
- Frozen existing games, CEOS state and legacy Starter Kit config remain untouched. No runtime CEOS imports, new orchestrator, secret discovery, credential scraping, or background service.
- The independent PR #10 Windows component updater is not part of this branch; do not merge or touch it in Slice A.

## Review Focus

1. **Unknown task/model strings:** fail with explicit, stable errors; do not silently default to Codex or Terra (Task 1).
2. **Missing or forged capability:** never report `READY` for DEV or Image Gen based only on a model name/config flag; require structured positive discovery evidence (Task 2).
3. **Pinned versus automatic image routing:** an unavailable pinned Terra must not fall back to SOL, while unpinned may select SOL before generation (Task 2).
4. **Preview on frozen/unversioned projects:** frozen game can be inspected but not marked executable; a valid fresh Studio game needs no Git repository (Tasks 1, 3).
5. **Read-only CLI confusion:** reject `--apply`, repeated/unknown flags and unsupported model selections; leave `.ludory/ai` and game SHA unchanged (Task 3).

---

## File responsibilities

- Create `packages/ai/src/task-routing.mjs`: versioned task-kind identifiers, typed route planning, result normalization; no persistence or process spawning.
- Create `packages/ai/src/capabilities.mjs`: bounded, inspectable host capability discovery interface. Initial production implementation may probe Codex `--version` through the existing checker; DEV and Image Gen remain unverified until future adapters expose real host evidence.
- Modify `packages/ai/src/index.mjs`: export only the public task-route planner and discovery function.
- Modify `packages/studio/src/cli.mjs`: accept `workflow route --project ... --task ... [--model auto|terra|sol] [--json]`, with no `--apply`, and print manual next steps.
- Modify `packages/studio/README.md`, `packages/studio/src/cli.mjs` help text and root `package.json` check script: document the feature and syntax-check the new modules.
- Add `packages/ai/test/task-routing.test.mjs` and `packages/studio/test/task-routing-cli.test.mjs`: pure and CLI regressions.

## Task 1: Deterministic, safe task contract

**Files:**
- Create: `packages/ai/src/task-routing.mjs`
- Test: `packages/ai/test/task-routing.test.mjs`
- Modify: `packages/ai/src/index.mjs`

**Interfaces:**
- Produce: `planTaskRoute(projectDir, { taskKind, model = 'auto' }, { discover } = {})`. Task 1 uses an internal fail-closed discovery default; Task 2 replaces it with `discoverTaskCapabilities` without changing the public signature.
- Return an object containing `engine: 'ludory-ai'`, `operation: 'route'`, canonical `project`, `taskKind`, `requestedModel`, `preferredRoute`, `selectedRoute`, `status`, `reasonCode`, `nextAction`, `writes: []`, `conflicts: []`. Use `selectedRoute` from `codex`, `web-dev`, `image-terra`, `image-sol`, `manual`, or `null` (blocked), and preserve the preferred executor independently. The plan must have no `apply` method or writable native plan.
- Canonical taskKind values: `mechanics`, `episode-script`, `art-concept`, `image`, `functional-check`; valid model values: `auto` for all tasks, plus `terra`/`sol` **only** for `image`.

- [ ] **Step 1: Write failing tests** in `task-routing.test.mjs` for the five fixed mappings, unknown task, non-image `model=terra`, invalid option properties, and frozen-project refusal. Use a stub discovery hook; assert no `.ludory` directory appears.
- [ ] **Step 2: Run focused test:** `node --test packages/ai/test/task-routing.test.mjs`; expect failure because the planner is not exported.
- [ ] **Step 3: Implement minimal `planTaskRoute`** using `inspectNativeProject()` and `hasStudioCreationReceipt()`. Frozen-project result is `BLOCKED` with `reasonCode: 'AI_ROUTING_STUDIO_GAME_REQUIRED'`; don't invoke `discover` when blocked. Validate every option before capability lookup.
- [ ] **Step 4: Run focused test:** same command; expect PASS. Confirm a fresh Studio game without Git can be routed using the existing game-creation test helper or a bounded fixture.
- [ ] **Step 5: Commit:** `git add packages/ai/src/task-routing.mjs packages/ai/test/task-routing.test.mjs packages/ai/src/index.mjs && git commit -m "feat(ai): define deterministic task routing contract"`.

## Task 2: Honest preflight, Terra→SOL and manual fallback

**Files:**
- Create: `packages/ai/src/capabilities.mjs`
- Modify: `packages/ai/src/task-routing.mjs`
- Modify: `packages/ai/src/index.mjs`
- Test: `packages/ai/test/task-routing.test.mjs`

**Interfaces:**
- Produce: `discoverTaskCapabilities(project, { checkCodex = checkCodexAvailable, hostProbe = null } = {})` returning a bounded capability record for `codex`, `webDev`, `imageTerra`, `imageSol`.
- `codex` capability shape: `{ available: boolean, reasonCode: string }`, derived from `checkCodexAvailable`. Host capability shapes: `webDev: { available: true, transportVerified: true, entitlementVerified: true, routeObserved: 'web-dev', modelObserved: <nonempty host-observed ID> }`, `imageTerra: { available: true, transportVerified: true, entitlementVerified: true, modelObserved: 'gpt-5.6-terra', imageGenCallable: true }`, and corresponding `imageSol` with `modelObserved: 'gpt-6-sol'`. Image model IDs must match the trusted native `gpt-<major>[.<minor>]-terra|sol` family, not a suffix alone. Missing fields, unknown model, nonboolean flags or negative results are unavailable, not verified. `hostProbe` is a trusted future host-adapter injection, not a user-supplied CLI JSON flag.
- Only a genuine host adapter's *positive observed* evidence can set `webDev` or an image producer to ready; when `hostProbe` is absent, all of those remain unavailable with an explicit reason. A model-name string alone does not suffice.
- Consume: `discover` from Task 1. A Codex check is limited to the existing `--version` path with `cwd=project` and does not execute a model; tests inject `checkCodex` and `hostProbe` to avoid real executables or accounts.

- [ ] **Step 1: Add failing tests** for verified Codex, missing Codex, DEV unavailable, DEV with verified host evidence, Terra preferred when both image routes verified, SOL selected when Terra fails preflight, pinned Terra not falling back, pinned SOL, both absent -> manual, malformed/unsupported host evidence -> no false `READY`. Assert `selectedRoute` and `reasonCode` for every case.
- [ ] **Step 2: Run focused test:** `node --test packages/ai/test/task-routing.test.mjs`; expect new cases to fail.
- [ ] **Step 3: Implement `discoverTaskCapabilities`** as a bounded no-write preflight and complete the planner's status decision. Use `NEEDS_USER_ACTION` plus `nextAction.kind: 'MANUAL_HANDOFF'` when a model cannot run; return `READY` only for observed compatible routes. Do not claim `modelObserved` for manual results.
- [ ] **Step 4: Run focused tests:** expect PASS, including failure-closed bad discovery responses. Confirm no model-generation function or event commit is called.
- [ ] **Step 5: Commit:** `git add packages/ai/src/capabilities.mjs packages/ai/src/task-routing.mjs packages/ai/src/index.mjs packages/ai/test/task-routing.test.mjs && git commit -m "feat(ai): add fail-closed executor capability preflight"`.

## Task 3: Read-only Studio CLI and documentation

**Files:**
- Modify: `packages/studio/src/cli.mjs`
- Modify: `packages/studio/README.md`
- Modify: `package.json`
- Create: `packages/studio/test/task-routing-cli.test.mjs`

**Interfaces:**
- Consume: `planTaskRoute(projectDir, { taskKind: flags.get('--task'), model: flags.get('--model') ?? 'auto' }, ...)`.
- Public invocation: `ludory workflow route --project <new-studio-game> --task <task-kind> [--model <auto|terra|sol>] [--json]`.
- Exit codes: `0` for a valid read-only plan (including `NEEDS_USER_ACTION`), `2` for `BLOCKED`, `1` for invalid args/operational failure. JSON output must include the same fields as the planner; text prints requested task, chosen route or unavailable reason, and next step.

- [ ] **Step 1: Write failing CLI tests** for help discovery, all five task names, unsupported task/model, `--apply` refusal, duplicate flag, `NEEDS_USER_ACTION` exit 0, blocked frozen project exit 2, and zero before/after mutations (game files, `.ludory/ai`, total filesystem tree). Include a newly created Git-free Studio project fixture.
- [ ] **Step 2: Run:** `node --test packages/studio/test/task-routing-cli.test.mjs`; expect failure because `workflow route` does not exist.
- [ ] **Step 3: Wire the new operation** without modifying `executeWorkflow()` or existing options. Accept exactly route-specific `--task` and `--model`, reject `--apply`; preserve all existing workflow operations and output codes. Document current absence of DEV/Image Gen adapters, expected manual handoff and honest statuses. Update root `npm run check` to include both new modules.
- [ ] **Step 4: Run:** focused CLI test, then `npm test`, `npm run check`, `node examples/core-session.mjs`; all must pass. Run Node 22 and Node 24 where available; report skipped runtime explicitly.
- [ ] **Step 5: Commit:** `git add packages/studio/src/cli.mjs packages/studio/test/task-routing-cli.test.mjs packages/studio/README.md package.json && git commit -m "feat(studio): preview AI task routing from unified CLI"`.

## Final verification and handoff

- [ ] Confirm `git diff --check` and clean feature worktree after commits; review actual changed file list, ensure PR #10 files, frozen games and main are untouched.
- [ ] On Windows/NTFS test the new `workflow route` preview for five kinds, with missing DEV/Image Gen showing manual handoff and no writes. No real account-authenticated Web DEV/Image Gen generation is expected in Slice A.
- [ ] Re-run Node 22/24 CI on the exact final SHA before an MVP merge review. Do not label Web DEV/Terra/SOL integration, independent acceptance or Release PASS as implemented.
- [ ] Keep subsequent plans separate: Slice B (`Web DEV` narrative drafts/gating), Slice C (host-verifiable Image Gen), Slice D (independent QA); do not start these implicitly.
