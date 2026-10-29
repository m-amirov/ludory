# F1b — Codex-native AI reliability and evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and, where broken, repair the native Studio+AI development cycle without fabricating host execution, altering frozen games or requiring an HTTP AI service.

**Architecture:** Exercise existing `planWorkflow`/`executeWorkflow`, route, Web DEV, ImageGen handoff, narrative/art review and Quality receipt boundaries on **new** Studio-created fixtures. Add negative/fault tests for missing and interrupted capabilities; make the smallest root-cause repair in the owning AI/Studio module. Produce an evidence index separating local contracts, actual host observations and missing external gates.

**Tech Stack:** Node 22+ ESM, `node:test`; `@ludory/ai` sources and Studio CLI; existing test helpers under `packages/ai/test/helpers/` and `packages/studio/test/`.

**Spec:** `docs/superpowers/specs/2026-10-30-ludory-v1-completion-design.md` §4 F1. Requires completion of F1a before the final combined F1 acceptance, but code tasks here must remain independent of F1a internal functions.

## Global Constraints

- Native development only: no CEOS executor, `.codex-os`, OpenAI API key, paid runtime AI or mandatory server.
- All mutation tests use new Studio-created fixtures; no frozen game, user asset or real platform SDK writes.
- The CLI cannot spawn Codex subagents or call session-only `$imagegen`: packet plus `NEEDS_AGENT_ACTION` is the honest contract.
- Web DEV must be observed as `chatgpt-web/gpt-6-sol`, reasoning high, with source-bound and authenticated host evidence. Historical or simulated helper replies cannot count as fresh live PASS.
- Missing review/attachment/host capability remains `BLOCKED`/`NEEDS_USER_ACTION`; no synthetic `PASS_ART`, narrative `ACCEPT`, Quality/Release PASS, or fake SDK publication claims.
- Preview operations perform no writes; replay and recovery must not overwrite existing receipts or implicitly retry a potentially charged external action.
- Use `npm test`, `npm run check`, `node examples/core-session.mjs`; require Linux/Windows CI at exact candidate HEAD.

## Review Focus

1. A timed-out external call may have completed after the parent lost contact: recovery must not silently duplicate a billable/irreversible operation (Task 2).
2. A source file changes between preview and external handoff: the old packet must fail closed and must not receive the new source's attribution (Task 1).
3. Fake `modelObserved`, browser image attachment or verdict injected by caller: never elevated to host-observed approval (Task 1).
4. Dirty/unversioned new-game Git working tree and multiple active runs: allow development but never select the wrong run or mutate frozen games (Task 2).
5. Human chooses not to enable a real Web DEV/helper/agent: produce actionable blocker codes and a complete local contract evidence matrix without invented success (Task 3).

---

### Task 1: Capability routing and source-bound receipt invariants

**Files:** Extend `packages/ai/test/task-routing.test.mjs`, `packages/ai/test/dev-host.test.mjs`, `packages/ai/test/art-review.test.mjs`, `packages/ai/test/narrative-review.test.mjs`; modify only the failing implementation owners among `packages/ai/src/capabilities.mjs`, `task-routing.mjs`, `dev-host.mjs`, `draft-tasks.mjs`, `image-tasks.mjs`, `art-review.mjs`, `narrative-review.mjs`.

**Interfaces:** Existing `planTaskRoute(projectDir, options, deps)`, `planArtReview`, `executeArtReview`, `planNarrativeReview`, `executeNarrativeReview` and `workflow image` `manualPacket` stay backward compatible; no new host protocol invented in this phase.

- [ ] **Step 1:** Add a table-driven negative test matrix asserting exact existing result categories: no helper/profile, broken auth/entitlement, wrong model, no binary-upload proof, stale/changed text and image digest, fake host verdict, unsupported session ImageGen agent and malformed host result. Explicitly assert no `READY`/`ACCEPT`/`PASS_ART` without witnessing prerequisites.
- [ ] **Step 2:** Run targeted `node --test` for the four AI test files; expected RED for a newly observed missing invariant; if all already pass, document `NO_CHANGE_NEEDED` with output and do **not** introduce a speculative patch.
- [ ] **Step 3:** Fix only verified root causes in the appropriate module with a failing regression test preserved; preserve existing source-bound JSONL/receipts and upgrade compatibility.
- [ ] **Step 4:** Rerun targeted tests; expected GREEN and no unauthorized host invocation in preview.
- [ ] **Step 5:** Commit `test(ai): lock down routing and host evidence boundaries` (and `fix(ai): ...` only when a defect was proven).

### Task 2: Start/continue/recover interruption and non-destructive behavior

**Files:** Extend `packages/ai/test/workflows.test.mjs`, `packages/ai/test/store.test.mjs`, `packages/studio/test/native-workflow-cli.test.mjs`; selectively modify `packages/ai/src/workflows.mjs`, `packages/ai/src/store.mjs`, `packages/ai/src/executor.mjs` or `packages/studio/src/cli.mjs` when a test demonstrates a root cause.

**Interfaces:** Existing `planWorkflow(projectDir, operation, options)` / `executeWorkflow(plan, {apply, executor})`, `readNativeRun`, `planNativeEvent`, `commitNativeEvent` and `workflow recover --confirm-no-executor --apply` remain the contract.

- [ ] **Step 1:** Add failing negative/integration tests for `start` preview no writes, duplicate apply/stale plan, continue during pending external review, crash between request/result, failed Codex execution and explicit retry, old process not confirmed stopped, altered run/event hash, multiple active runs, dirty/unversioned new Studio game, and frozen/non-Studio game blocked.
- [ ] **Step 2:** Run `node --test packages/ai/test/workflows.test.mjs packages/ai/test/store.test.mjs packages/studio/test/native-workflow-cli.test.mjs`; expected RED only for genuinely uncovered behavior; already passing cases recorded as existing coverage.
- [ ] **Step 3:** Implement the smallest repair of any observed incorrect transition. Require explicit recover confirmation; append failed/blocked receipts rather than erasing requests; never relaunch a host implicitly or auto-advance a checkpoint on successful subprocess exit.
- [ ] **Step 4:** Rerun targeted tests; expected GREEN; verify wrong-run/frozen fixtures' hashes and file trees are unchanged.
- [ ] **Step 5:** Commit `test(ai): cover native interruption and recovery states` (plus narrowly scoped bugfix commit where justified).

### Task 3: Fresh Studio fixture, capability evidence and operator handoff

**Files:** Create `docs/audits/2026-10-30-f1-ai-acceptance.md` and `packages/studio/test/f1-ai-fixture.test.mjs`; update `packages/studio/README.md` and F1 acceptance references.

**Interfaces:** `ludory create`, `workflow doctor/start/status/next/route/continue/recover`, `workflow draft`, `workflow image`, `workflow narrative-review`, `workflow art-review`, and `quality` use their existing CLI contracts. Evidence record fields: tested commit, OS/Node, fixture ID, exact command, source hash, outcome class (`CONTRACT_PASS` / `HOST_OBSERVED_PASS` / `BLOCKED`), receipt path or blocker reason.

- [ ] **Step 1:** Add a failing `packages/studio/test/f1-ai-fixture.test.mjs` with `test('a fresh Studio game reports native AI readiness and honest host blockers without touching a foreign tree', ...)`: create a distinct temporary Studio game, assert doctor/route/start previews, immutable unrelated-tree checksum and explicit absence of falsely accepted external outcomes. Its yet-unimplemented fixture runner/import is initially RED.
- [ ] **Step 2:** Run `node --test packages/studio/test/f1-ai-fixture.test.mjs`; expected RED. Implement the test-only fixture runner using current Studio APIs, then rerun the same command; expected GREEN, with no external paid calls or mutation outside the fixture.
- [ ] **Step 3:** Run a separate current-host discovery/probe **only where supported and expressly authorized**; never send sensitive references or launch paid image/review actions just to fill an evidence table. Record `BLOCKED` with exact cause for unavailable sessions, authenticated Web visual helper, real subagent or missing tool. Do not treat contract fixtures as live host evidence.
- [ ] **Step 4:** Document one-command/new-game operator workflow, safe recovery, how to distinguish evidence kinds, PR #5/#11 comparison against current merged code (without merging/closing those drafts), and exact Windows limitations.
- [ ] **Step 5:** Run `npm test`, `npm run check`, `node examples/core-session.mjs` and Linux/Windows CI on exact candidate commit; expected zero new failures and honest deferred host gates. Commit `docs(ai): record F1 capability and recovery acceptance`.

## Completion / handoff

Review the entire AI+Studio branch independently with attention to host-spoofing, source binding, save/recovery state and customer file safety. Combined **F1** cannot be called accepted until F1a safe update round-trip, this plan's evidence matrix and all required technical/CI gates are checked at the accepted HEAD. Any real-host gate that cannot be exercised is explicitly `BLOCKED` and does not turn into an automatic art or Release PASS. Do not merge without owner approval.
