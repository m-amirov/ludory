# F1b Art Review Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate visual browser submission after uncertain art-review outcomes.

**Architecture:** Reuse the existing SHA-chained native run events to journal art review intent and terminal outcome, retaining a separate witnessed art receipt ledger. Surface a pending request in the existing recovery CLI and require explicit confirmation.

**Tech Stack:** Node 22+ ESM, `node:test`; `packages/ai` store, art-review and workflow; Studio CLI.

**Spec:** `docs/superpowers/specs/2026-10-30-f1b-art-review-recovery-design.md`

## Global Constraints

- Fail closed without real browser evidence; no paid host calls from tests or credential access.
- No writes to frozen games; all mutation testing uses new temporary Studio-created games.
- Preserve historical run/receipt reading and append-only tamper checks; never overwrite user data.
- No merge until exact-head Linux/Windows gates and owner decision.

## Review Focus

1. Host timeout after remote submission leaves pending durable intent and no implicit retry.
2. A second invocation racing or following a pending request cannot submit another turn.
3. An already observed receipt with missing final event is recovered without downgrading or replaying it.
4. Source changes and late host responses after recovery do not create accepted receipts.
5. Missing explicit stop confirmation cannot close an uncertain browser operation.

---

### Task 1: Durable art intent and observed completion

**Files:** `packages/ai/src/store.mjs`, `packages/ai/src/art-review.mjs`, `packages/ai/test/art-review.test.mjs`

**Interfaces:** `planNativeEvent`/`commitNativeEvent` accept new `ART_REVIEW_REQUESTED` and `ART_REVIEW_RESULT`; `readNativeRun` exposes `pendingArtReview`; `recordNativeArtReview` only commits a receipt for its matching active request.

- [ ] **Step 1:** Add a failing regression: one host timeout yields a committed pending request, repeated `--apply` makes zero new host calls; ordinary witnessed success closes the request.
- [ ] **Step 2:** Run isolated art-review tests; verify RED is missing durable intent.
- [ ] **Step 3:** Implement the minimal source-bound events and safe pre-turn journal in store/art-review.
- [ ] **Step 4:** Run art-review and store tests; verify GREEN, historical receipts and old run fixtures still pass.
- [ ] **Step 5:** Commit the isolated fix and tests.

### Task 2: Owner-confirmed recovery and CLI visibility

**Files:** `packages/ai/src/workflows.mjs`, `packages/studio/src/cli.mjs`, `packages/studio/test/art-review-cli.test.mjs`, `packages/ai/test/workflows.test.mjs`

**Interfaces:** Existing `workflow recover --confirm-no-executor --apply` closes a pending art review with interrupted or witnessed outcome, never launches a host. CLI exceptions with pending request surface `PENDING_RECOVERY`.

- [ ] **Step 1:** Add failing tests for no-confirm recovery, explicit interrupted recovery, witnessed receipt without terminal event, preserved owner edits, late return after closure and visible CLI pending status.
- [ ] **Step 2:** Run targeted test files and observe RED.
- [ ] **Step 3:** Implement the smallest workflow/CLI changes and valid terminal receipt binding.
- [ ] **Step 4:** Verify targeted tests and full `npm test`.
- [ ] **Step 5:** Commit implementation, docs and evidence update.

### Task 3: Final review and publication

**Files:** `docs/audits/2026-10-30-f1-ai-acceptance.md`, `packages/studio/README.md`

- [ ] **Step 1:** Record exact local test results and remaining real-host/Windows blockers. Do not upgrade them to PASS.
- [ ] **Step 2:** Run `npm test`, `npm run check`, `node examples/core-session.mjs` and `git diff --check` on exact candidate.
- [ ] **Step 3:** Obtain independent review of the entire branch, fix Important defects, preserve clean worktree.
- [ ] **Step 4:** Push user-authorized F1b branch to `m-amirov/ludory`, open Draft PR against `main`; do not merge.
