# Release MVP R1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide read-only, hash-bound local Yandex ZIP, SDK evidence and rights checks, with no path that can certify or publish a game.

**Architecture:** New `@ludory/release` package reads untrusted local inputs and returns a deterministic gate report. Studio exposes `ludory release check` as a read-only command. The verifier intentionally does not trust C5 mock SDK evidence as real platform proof.

**Tech Stack:** Node.js >=22 ESM; built-in fs/path/crypto; Node test runner; no additional production dependency.

**Spec:** `docs/superpowers/specs/2026-10-31-release-mvp-r1-design.md`

## Global Constraints

- No writes to games, legacy projects, SDKs, artifacts or network; no release authorization generated.
- Reject unsupported ZIP formats rather than decompressing unchecked data; C5's stored ZIP is the scope.
- Do not equate SHA-256 integrity with digital signature or manually supplied evidence with independently witnessed results.
- Full global `npm test`, `npm run check`, `node examples/core-session.mjs`, plus targeted tests; run with normal subprocess permissions where sandbox blocks Git/Node children.

## Review Focus

- A ZIP with duplicate paths, casefold collisions or traversal cannot be locally accepted (Task 1 tests).
- Central-directory claims that disagree with local file headers cannot smuggle extra bytes or off-bound reads (Task 1 tests).
- Evidence/rights declared for a *different* ZIP is FAIL (Task 2 tests).
- Missing or forged live-platform PASS cannot turn local C5 smoke into Release PASS (Task 2 tests).
- CLI `--apply` or partial inputs never trigger a write or misleading zero-exit (Task 3 tests).

---

### Task 1: Safe archive inspection

**Files:** Create `packages/release/package.json`, `packages/release/src/archive.mjs`, `packages/release/test/archive.test.mjs`.

**Interfaces:** `inspectYandexArchive(archivePath)` returns `{sha256,files:[{path,sha256,size}],mediaFiles:[...],projectId}`; throws `ReleaseInputError(code, message)` for malformed/untrusted input. Export `ReleaseInputError` from `src/errors.mjs`.

- [ ] Add tests using C5-style `zipSync` fixture: valid archive gives expected digest/file hashes, correct target; malformed EOCD, duplicate, traversal, spoofed central/local headers, ZIP64, compressed, copied SDK, nonregular file and symlink reject.
- [ ] Run `node --test packages/release/test/archive.test.mjs`; confirm RED from missing package implementation.
- [ ] Implement bounded stored-ZIP parser, SHA-256 evidence and manifest checks with no file writes.
- [ ] Run targeted tests GREEN, then commit the task.

### Task 2: Offline evidence/rights gates

**Files:** Create `packages/release/src/check.mjs`, `packages/release/src/index.mjs`, `packages/release/test/check.test.mjs`; document contract in `packages/release/README.md`.

**Interfaces:** `checkYandexRelease({archivePath,receiptPath,sdkEvidencePath,rightsPath})` returns `{schemaVersion:1,kind:'yandex-local-release-check', status:'PASS_LOCAL'|'BLOCKED'|'FAIL', candidateSha256, gates:[{id,status,reasonCode}],releaseReady:false,publicationAllowed:false}`. Filesystem IO read-only; corrupt inputs return FAIL report, missing files BLOCKED.

- [ ] RED tests: valid C5 receipt/evidence and complete media rights PASS_LOCAL but no release; mismatched ZIP or file hash FAIL; missing input BLOCKED; spoofed live PASS FAIL; missing media rights BLOCKED/FAIL; only declared five C5 variants pass.
- [ ] Run targeted test RED; implement input validation, field allowlists, exact SHA comparisons and aggregate statuses; ensure stable reason codes.
- [ ] Run targeted tests GREEN, commit the task.

### Task 3: Studio CLI and integration evidence

**Files:** Modify `packages/studio/src/cli.mjs`, `packages/studio/package.json`, root `package.json` scripts/lockfile; create `packages/studio/test/release-cli.test.mjs`; update `docs/ROADMAP.md` and `README.md` status.

**Interfaces:** `ludory release check --archive ZIP --receipt JSON --sdk-evidence JSON --rights JSON [--json]`. Exit 0 `PASS_LOCAL`, 1 `FAIL`, 2 `BLOCKED`; no `--apply`.

- [ ] RED integration tests using actual `buildYandexCandidate` and Studio-created new Yandex fixture; check CLI output and zero writes; misuse flags rejected; positive never declares release-ready.
- [ ] Run target RED; add minimal parser/command plumbing, workspace dependency and help; update docs and local release gates.
- [ ] Run targeted GREEN, `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`; record exact counts and blockers.
- [ ] Commit Task 3; request whole-branch independent review and fix high-severity findings via RED/GREEN. Publish a PR; leave unmerged pending final review/CI.
