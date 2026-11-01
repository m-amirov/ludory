# Ludory Simulated Moderation QA B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simulate per-platform moderation with observed technical/browser and independent experiential review; when expressly authorized, Codex automatically repairs and reinspects the new game at most twice.

**Architecture:** New `@ludory/ai` QA modules pin source/build/checklist and append immutable evidence, while Studio CLI exposes plans, runs and reports. A Codex-owned controller executes bounded source edits and external DEV review packets; Node validates returned host observations but never fakes agent/browser/moderation approval. QA does not modify Release's real platform moderation gates.

**Tech Stack:** Node.js 22+ ESM, Studio trust, `@ludory/ai` source/quality receipts and host-attestation patterns, Playwright fixtures, `node:test`; no OpenAI API or runtime AI dependency.

**Spec:** `docs/superpowers/specs/2026-11-01-ludory-pre-f5-qa-lan-portrait-design.md` §5–§6. Depends on P1 preview's build digest/served bytes and P2 portrait browser matrix.

## Global Constraints

- One owner opt-in (`--repair --in-scope ... --mutation-boundary ... --apply`) authorizes **maximum two** bounded Codex repair-and-independent-review rounds on a trusted **new** game; limits and allowlist persist across recovery.
- `plan` is read-only; unavailable authenticated reviewer/actual screenshot upload/browsers/portal/physical devices must not become PASS.
- `QA_SIMULATION_PASS` never equals official Yandex/VK approval; `platformModeration: NOT_RUN` persists in every local receipt. Preserve Release's SDK/rights/console gates.
- No writes to frozen games, user-managed/protected files, third-party SDK settings, or other repos. Unexpected edits remain preserved for owner inspection; no destructive auto-rollback.
- Yandex and VK have separate rule sources and reports; outdated/unverified VK guideline wording stays `RULE_SOURCE_UNVERIFIED`, not an invented rule.
- Do not embed API credentials in game output or use a hidden paid API; Web DEV needs actual attestation of GPT-6 Sol(Web), fresh images and independent review.
- Isolated P3 PR(s), actual negative/regression tests, `npm test`, `npm run check`, Core example, browser smoke, independent review and owner-approved merge.

## Review Focus

1. Reviewer replies `PASS` without verifiable screenshot upload/model/session attestation: reject as `BLOCKED` (Task 3).
2. Source/build or checklist changes between screenshot and review: reject stale response (Tasks 1, 3).
3. Interrupted round with uncertain external helper or Codex process: no blind retry or third round (Task 4).
4. Concurrent QA runs and forged/partial receipt entries: detect and fail closed without overwriting history (Task 2).
5. A repair changes an unapproved file or fixes one target but breaks the other: escalate or independently recheck both targets, never carry an old PASS (Task 4).

---

### Task 1: Rules, plan and observed technical checks

**Files:**
- Create: `packages/ai/src/moderation-qa-policy.mjs`, `packages/ai/src/moderation-qa-checks.mjs`
- Test: `packages/ai/test/moderation-qa-checks.test.mjs`
- Modify: `packages/ai/src/index.mjs`

**Interfaces:**
- Produces `planModerationQa(projectDir, { targets = ['yandex','vk'] } = {}) -> { status:'READY'|'BLOCKED',project,targets,sourceDigest,buildSha256?,checklistDigest,checklistRevision,rootIdentity,reasonCode? }`.
- Produces `evaluateModerationChecks(plan, observedEvidence) -> { status:'PASS'|'FAIL'|'BLOCKED', targets:{yandex?,vk?}, checks:Check[], findings:Finding[] }` where each `Check` holds `id,target,status,reasonCode,observed,artifactSha256,environment,sourceDigest` and `Finding` holds `id,target,severity:'P0'|'P1'|'P2',category,evidenceIds`.

- [ ] **Step 1: Write failing tests** for trusted new/frozen/forged origins; absent target, foreign SDK, missing source hash, bad asset/entrypoint, failed reload/audio/ad/save/resize, honest mock SDK evidence and separate Yandex/VK checklists. A stale checklist or unverified VK official source must not grant full pass.
- [ ] **Step 2: Run** `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/ai/test/moderation-qa-checks.test.mjs` → FAIL for missing functions.
- [ ] **Step 3: Implement** target-specific versioned rule/check metadata with official source URLs, explicit out-of-scope console/rights/device requirements and deterministic technical verifier over **actually observed** build/Playwright artifacts. Reuse `snapshotQualitySource`, `verifyStudioOrigin`, Studio P1 build SHA and existing Release checks; never synthesize browser outcomes. Do not change existing `quality check` meanings.
- [ ] **Step 4: Rerun** targeted tests → PASS with `BLOCKED`/`FAIL` preserved and source-pinned subreports.
- [ ] **Step 5: Commit** `feat(ai): plan source-bound simulated moderation checks`.

### Task 2: Append-only QA evidence and status reporting

**Files:**
- Create: `packages/ai/src/moderation-qa-store.mjs`
- Test: `packages/ai/test/moderation-qa-store.test.mjs`
- Modify: `packages/ai/src/index.mjs`

**Interfaces:**
- Produces `beginModerationQa(plan, { apply = false, repairAuthorization = null } = {}) -> QaRun` with immutable ID and pinned source, build, targets, allowlist/mutation boundary and repair budget (zero or two).
- Produces `appendModerationQaEvent(project, runId, event) -> QaRun`, `readModerationQaRun(project, runId) -> QaRun`, `moderationQaEvidence(project, runId) -> Report` with tamper-evident receipt chain; state is `NOT_RUN|REWORK|BLOCKED|ESCALATE|QA_SIMULATION_PASS`.

- [ ] **Step 1: Write failing tests** for read-only preview, no older run overwritten, forged runId/path, concurrent append collision, tampered receipt, truncated write, stale source and protected-dir symlink swap; every report includes `platformModeration:'NOT_RUN'` and exact build digest.
- [ ] **Step 2: Run** `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/ai/test/moderation-qa-store.test.mjs` → FAIL.
- [ ] **Step 3: Implement** exclusive append-only events in `.ludory/qa-moderation` only for verified Studio games; reuse secure-store file primitives or equivalent inode/hash checks, atomic `wx`/fsync commits, bounded file counts/sizes, source-linked parent receipt IDs, no silent recovery after partial write.
- [ ] **Step 4: Rerun** test → PASS, including an intentional altered event that returns `BLOCKED` instead of PASS.
- [ ] **Step 5: Commit** `feat(ai): persist tamper-evident moderation simulation receipts`.

### Task 3: Independent experiential review packet and attestation

**Files:**
- Create: `packages/ai/src/moderation-qa-review.mjs`
- Test: `packages/ai/test/moderation-qa-review.test.mjs`
- Modify: `packages/ai/src/index.mjs`

**Interfaces:**
- Produces `planModerationExperienceReview(run, evidence) -> {status:'READY'|'BLOCKED'|'NEEDS_AGENT_ACTION',packet?,reasonCode?}` binding fresh screenshots, navigation trace, source/build SHA and per-platform intent.
- Produces `acceptModerationExperienceReview(run, observedHostReceipt) -> {status:'PASS'|'REWORK'|'BLOCKED',findings,hostAttestationDigest?}`; it can accept PASS only after independent authenticated `chatgpt-web/gpt-6-sol` with actual image upload/observation attestation.

- [ ] **Step 1: Write failing tests** for valid bounded finding IDs/P0/P1/P2, mismatched screenshot SHA, text-only review, unobserved model identity, spoofed `imageVisible`, self-review, missing upload, stale source/round and arbitrary instructions inside review content. `P2` does not block simulated result but remains recorded.
- [ ] **Step 2: Run** `node --test packages/ai/test/moderation-qa-review.test.mjs` → FAIL.
- [ ] **Step 3: Implement** minimal reviewed-source/asset packet and strict host-receipt contract, reusing existing `art-review` observed upload/capability principles without claiming the currently unmodified helper can attest image observation. If real helper lacks capability, return `BLOCKED`/`NEEDS_AGENT_ACTION`, do not substitute primary model prose or fake receipts.
- [ ] **Step 4: Rerun** tests → PASS; document one owner-run Web host smoke as external `NOT_RUN` when not actually observed.
- [ ] **Step 5: Commit** `feat(ai): verify independent moderation-experience reviews`.

### Task 4: Repair authorization, round limits and recovery

**Files:**
- Create: `packages/ai/src/moderation-qa-repair.mjs`
- Test: `packages/ai/test/moderation-qa-repair.test.mjs`
- Modify: `packages/ai/src/index.mjs`

**Interfaces:**
- Produces `planModerationRepair(run, findings) -> {status:'READY'|'BLOCKED'|'ESCALATE',round,packet?,reasonCode?}`; max round index `2`.
- Produces `recordModerationRepairOutcome(run, {beforeFiles,afterFiles,newSourceDigest,newBuildSha256,technicalReceipt,reviewReceipt}) -> QaRun`; accepts each round only after fresh **both-target** technical/browser and independent review on new source/build hash.

- [ ] **Step 1: Write failing tests** for `repairBudget=0`, auto rounds 1/2 on a single pinned consent, no round 3, P0 regression stop, missing new reviewer, source race, changed allowlist, altered user files, unexpected paths, both-target recheck and interrupted in-flight host recovery.
- [ ] **Step 2: Run** `node --test packages/ai/test/moderation-qa-repair.test.mjs` → FAIL.
- [ ] **Step 3: Implement** a Codex-orchestrator packet with allowed relative paths/mutation boundary, source-bound before/after file inventory, optional existing `workflow cycle` execution patterns, verified round transitions and durable recovery blocker. CLI/Node **does not silently start Web or spawn Codex agents**; the primary Codex session performs authorized work and reattaches actual observations. Unexpected writes preserve files + `ESCALATE`, not unsafe rollback.
- [ ] **Step 4: Rerun** tests → PASS, proving no third invocation and no inherited earlier round PASS.
- [ ] **Step 5: Commit** `feat(ai): enforce bounded moderation repair and recheck`.

### Task 5: Studio command, disposable browser fixture and operator docs

**Files:**
- Modify: `packages/studio/src/cli.mjs`, `packages/ai/src/index.mjs`, `packages/studio/README.md`, `package.json`
- Create: `packages/ai/README.md` (or extend the existing AI documentation if this file is introduced elsewhere first)
- Create: `packages/studio/test/moderation-qa-cli.test.mjs`
- Test: `packages/runtime-narrative/test/browser/studio-n3-smoke.mjs` or a new `packages/runtime-narrative/test/browser/moderation-qa-smoke.mjs`

**Interfaces:**
- Studio CLI: `ludory qa moderation plan|run|status|evidence --project <path> [--targets yandex,vk] [--run <id>] [--repair --in-scope <path;path> --mutation-boundary <text>] [--apply] [--json]`.
- Default `plan` read-only; `run --apply` starts receipt/evidence capture; `--repair` gives one narrowly scoped two-round owner opt-in and returns an executable Codex handoff only where the real agent is available.

- [ ] **Step 1: Write failing CLI/E2E tests** for help/invalid flags, no writes without `--apply`, protected paths, SDK fake only CONTRACT_PASS, observed browser screenshot checksum, portrait clipped-choice failure, audio focus leak, broken save-after-rotation, no-reward ad, P2 report, P0/P1 two repairs and escalation. Use injected fake host receipts only for contract tests, clearly labeled synthetic.
- [ ] **Step 2: Run** `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/moderation-qa-cli.test.mjs` → FAIL.
- [ ] **Step 3: Wire** CLI into Tasks 1–4, create source-bound human-readable/JSON reports, exact failure codes and a concise quickstart. Register new module syntax in `npm run check`; keep Release check behavior unchanged and show the explicit banner `SIMULATED — NOT PLATFORM APPROVAL`.
- [ ] **Step 4: Run** targeted CLI/AI tests, `node packages/runtime-narrative/test/browser/studio-n3-smoke.mjs`, `npm test`, `npm run check`, `node examples/core-session.mjs`; if actual Web DEV/physical devices unavailable, record their gates `BLOCKED`/`NOT_RUN` without downgrading test coverage.
- [ ] **Step 5: Commit** `feat(studio): expose honest moderated QA repair workflow`.
- [ ] **Step 6: Open P3 PR(s)**, independent code review, exact HEAD CI and owner-approved merge; next run F5 then F6, never tag 1.0 from simulated moderation alone.
