# Release MVP R2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare a read-only, SHA-bound real Yandex field-test matrix without promoting self-reports to verified Release PASS.

**Architecture:** A new small Release planner invokes unchanged R1 verification, validates optional user-declared field outcomes and projects them into a fixed test matrix. Studio adds a read-only `release plan` command; R1's existing `release check` remains compatible.

**Tech Stack:** Node.js 22+ ESM; built-in fs; existing Release helpers and Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-31-release-mvp-r2-design.md`

## Global Constraints

- No uploads, publishing, console automation, network, game mutation or secret access.
- A self-declared real-host `PASS` cannot become platform PASS or `releaseReady`.
- Keep fixed matrix deterministic, source-bound to the verified C5 ZIP SHA and explicit about missing devices.
- Only edits in the new Release R2 worktree; no frozen game or other branch touched.

## Review Focus

- A self-reported all-PASS matrix must not certify live SDK or device readiness (Task 1).
- A field report pinned to a different ZIP must be `FAIL`, not a missing-evidence `BLOCKED` (Task 1).
- Duplicate/unknown IDs, extra authority fields and a symlink to evidence must be rejected (Task 1).
- A legitimate reported FAIL must not be hidden by other PASS rows or R1 local readiness (Task 1).
- A CLI caller cannot bypass read-only semantics with `--apply` or omit required R1 inputs (Task 2).

---

### Task 1: Offline field-test planner and strict evidence mapping

**Files:** Create `packages/release/src/plan.mjs`, modify `packages/release/src/index.mjs`, create `packages/release/test/plan.test.mjs` or reuse the R1 test fixture, update `packages/release/README.md`.

**Interfaces:** `planYandexFieldTests({archivePath,receiptPath,sdkEvidencePath,rightsPath,fieldEvidencePath?}) -> {schemaVersion,kind,status,candidateSha256,localStatus,checks,fieldEvidenceGate,releaseReady,publicationAllowed}`; `checks` have stable `id/status/reasonCode`.

- [ ] Write behavior tests on actual C5-shaped ZIP inputs: R1 PASS_LOCAL creates 13 NOT_RUN checks and READY_FOR_FIELD_TEST; input absence/tamper propagates; all self-reported PASS becomes BLOCKED; self-reported FAIL turns plan FAIL; stale SHA, fake authority, unknown/duplicate ID and symlink fail; no input writes.
- [ ] Run `node --test packages/release/test/plan.test.mjs`; observe RED due missing export/function, not fixture failure.
- [ ] Implement fixed matrix and validated user-declared evidence using bounded regular input reads. Reuse R1 archive/receipt checks via `checkYandexRelease` only.
- [ ] Run targeted tests GREEN, verify release exports and commit implementation with tests and README.

### Task 2: Studio read-only CLI integration

**Files:** Modify `packages/studio/src/cli.mjs`, `packages/studio/test/release-cli.test.mjs`, `docs/ROADMAP.md`, `README.md`; no new dependencies.

**Interfaces:** `ludory release plan` accepts the four required R1 flags plus optional `--field-evidence` and `--json`; exits 0 READY_FOR_FIELD_TEST, 2 BLOCKED, 1 FAIL.

- [ ] Extend the existing C5 builder CLI integration tests with `release plan` success, untrusted report, negative evidence, absence and `--apply` rejection; observe RED before touching CLI.
- [ ] Implement minimal `release plan` argument routing, result formatting, help and exit codes. R1 `release check` untouched.
- [ ] Run targeted GREEN, `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`, inspect worktree status and commit.
- [ ] Perform whole-branch code review, add RED→GREEN regressions for serious issues, publish separate PR to `main` as Draft until exact-head CI passes. Do not merge or publish a game without owner approval.
