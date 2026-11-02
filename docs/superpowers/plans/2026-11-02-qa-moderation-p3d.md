# P3d — Source-scoped, bounded moderation QA repair handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authorize a trusted new Studio game for at most two source-scoped Codex repair/reinspection rounds, with durable stop conditions and no fabricated moderation PASS.

**Architecture:** P3c's captured five-image review remains the source of *recorded* findings, not a standalone authenticated reviewer. A new Studio repair-scope module verifies independent Studio ownership, snapshots every non-generated file and pins exact allowed paths. A separate append-only repair journal records consent, one-time round starts and post-edit evidence; the primary Codex agent executes edits and requests a fresh P3b/P3c review outside Node. CLI wraps the packet/state transitions without spawning agents or Web calls.

**Tech Stack:** Node.js 22 ESM, Studio trust, SHA-256, exclusive filesystem creates and fsync, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-01-ludory-pre-f5-qa-lan-portrait-design.md` §5, continuing `docs/superpowers/plans/2026-11-01-ludory-moderation-qa-b.md` Task 4 after merged PRs #62–#64.

## Global Constraints

- Explicit `--repair --in-scope <paths> --mutation-boundary <text> --apply` pins two rounds; no additional implicit consent or third round.
- Only host-trusted new Studio project and existing approved regular files; deny protected metadata, credentials, rights, SDK/vendor/config and symbolic paths.
- Strict before/after source inventory must identify unexpected changes; preserve them and `ESCALATE`, never roll back without the owner.
- Every candidate change requires fresh browser capture and five-image Web reinspection bound to a **different** candidate SHA; no historical reviewer PASS can be inherited.
- Durable uncertain/in-flight state means `PENDING_RECOVERY`; no blind restart or self-attested independent PASS.
- Every result explicitly retains `actualModeration: NOT_RUN`, `releaseReady:false`, `publicationAllowed:false`.
- No source edits by the CLI, no external service, no protected branch mutation, no claims about unavailable Web/device evidence.

## Review Focus

1. A forged/stale local five-image journal must never be treated as fresh authenticated Web approval (Tasks 1, 2).
2. A copied Studio creation receipt, symlink or `../` path must not authorize mutation (Task 1).
3. Changes to an adjacent unapproved or user-managed file must preserve bytes and escalate (Task 2).
4. Interrupted first round and concurrent/forged journal events must not consume a silent retry (Task 2).
5. Two unresolved P1/P0 rounds and a newly introduced P0 must stop; new review must match target and a changed candidate SHA (Task 2).

---

### Task 1: Pin trusted source and consent boundary

**Files:**
- Create: `packages/studio/src/qa-repair-scope.mjs`
- Test: `packages/studio/test/qa-repair-scope.test.mjs`

**Interfaces:**
- `snapshotQaRepairSource(projectDir) -> {project,rootIdentity,files:[{path,sha256,size}],digest}`; scan with symlink/size/count guards, skip only generated directories.
- `planQaRepair({project,reviewOutput,inScope,mutationBoundary,outputDir}) -> {kind,status,reasonCode,source,review,authorization,outputDir,...}`; only an independently host-registered Studio game with a completed issue-bearing P3c journal can offer a packet; status is `READY_FOR_AGENT_HANDOFF`, **not** QA PASS.

- [ ] Write failing tests: untrusted/frozen origin; valid trusted game and P1 finding; no writes in preview; malicious and protected paths; symlink/oversize sources; exact hash change after editing one allowed file. Expected: `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/qa-repair-scope.test.mjs` fails for missing exports.
- [ ] Implement scope and source inventory, preserving strict `actualModeration:NOT_RUN` and explicit Web-provenance caveat.
- [ ] Targeted test passes. Commit `feat(qa): pin trusted repair scope and source snapshot`.

### Task 2: Durable two-round journal and reinspection gate

**Files:**
- Create: `packages/studio/src/qa-repair-journal.mjs`
- Test: `packages/studio/test/qa-repair-journal.test.mjs`

**Interfaces:**
- `beginQaRepair(plan,{apply})`, `inspectQaRepair(outputDir)`, `startQaRepairRound(outputDir,{apply})`, `completeQaRepairRound(outputDir,{reviewOutput,apply})`.
- Consent is an immutable session file with SHA. Every round gets one exclusive `start` receipt before Codex edits, and one exclusive `result` receipt after fresh review. Only `REWORK` can start another round; `ESCALATE|BLOCKED|PENDING_RECOVERY|RECHECK_RECORDED` never advance automatically.

- [ ] Write failing tests: preview/no writes; single consent; no double-start; two-round limit; reviewer missing/pending/mismatched candidate; unchanged candidate; out-of-scope changes; P0 regression; tampered journal; all round states still mark actual moderation NOT_RUN. Expected: `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/qa-repair-journal.test.mjs` fails for missing exports.
- [ ] Implement immutably chained receipts with safe directory handling and exact source/target/candidate verification. A complete recorded review stays `REWORK` if P0/P1, otherwise `RECHECK_RECORDED` (not authenticated QA PASS).
- [ ] Targeted test passes. Commit `feat(qa): journal at most two Codex repair rounds`.

### Task 3: CLI entry points and truthful operator docs

**Files:**
- Modify: `packages/studio/src/cli.mjs`, `packages/studio/README.md`, `package.json`
- Test: `packages/studio/test/qa-repair-cli.test.mjs`

**Interfaces:**
- `ludory qa repair --project <new-game> --review-output <P3c-journal> --output <new-session-dir> --in-scope <relative;paths> --mutation-boundary <text> [--apply] [--json]` (requires explicit `--repair` consent for apply).
- `ludory qa repair-status --output <session-dir> [--json]`, `qa repair-next --output <session-dir> [--apply]`, `qa repair-record --output <session-dir> --review-output <fresh-P3c-journal> [--apply]`.

- [ ] Write failing CLI tests for no-write preview, required consent, invalid flags, status/recovery, round limit and never calling Web.
- [ ] Wire commands and human-readable warning; document Codex-agent handoff and mandatory *fresh* `qa capture` + `qa review --apply` after each source patch. No Node-based automatic execution.
- [ ] Run targeted tests, `npm test`, `npm run check`, `node examples/core-session.mjs` and an available browser smoke; report any unavailable host/physical-device checks as NOT_RUN.
- [ ] Commit `feat(studio): expose bounded P3d repair handoff` and open a PR for owner review; **no merge without separate approval**.
