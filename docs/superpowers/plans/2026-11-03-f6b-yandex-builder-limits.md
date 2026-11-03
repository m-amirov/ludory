# F6b Yandex Candidate Output Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject Yandex local candidates whose final ZIP or pretty-printed build receipt would be rejected by Release, before creating the output file.

**Architecture:** Keep the existing trusted Studio input admission and exclusive output writer. Add a small exported output-size guard to the builder, evaluate the actual ZIP and the exact CLI-formatted receipt before calling the writer, and test byte-accurate boundaries with lightweight in-memory doubles.

**Tech Stack:** Node.js >=22, `fflate`, `node:test`, existing Studio scaffold and Release contracts.

**Spec:** `docs/audits/2026-11-03-f6-technical-audit.md`, P2 “Yandex builder/Release size contract mismatch”.

## Global Constraints

- Maximum final ZIP: 100 MiB (Release `MAX_ARCHIVE_BYTES`).
- Maximum on-disk receipt: 1 MiB (`readRegularBytes` in Release).
- Check exact pretty JSON with trailing newline used by CLI; compare UTF-8 byte length.
- Do not overwrite existing files, create output on a failed preflight, modify frozen games, invoke Docker, publish a game, or tag a release.
- Keep Windows CI non-blocking; verify Ubuntu Node 22 and 24 after PR.

## Review Focus

- `100 MiB` exact ZIP boundary passes, one byte over fails (Task 1 test).
- `1 MiB` exact pretty receipt passes, one byte over fails (Task 1 test).
- Non-ASCII receipt text is measured in UTF-8 bytes (Task 1 test).
- Existing user-owned output remains untouched on an unrelated failure (Task 1 existing regression).
- Normal builder still emits the same repeatable ZIP and matching receipt (Task 1 existing regression).

---

### Task 1: Match Release size guards before output creation

**Files:**
- Modify: `scripts/build-yandex-candidate.mjs`.
- Modify: `packages/studio/test/yandex-candidate.test.mjs`.
- Modify: `docs/audits/2026-11-03-f6-technical-audit.md` (status/evidence only).

**Interfaces:**
- Produces: `validateYandexCandidateOutputSizes(archiveBytes, receipt)`; takes a Buffer or an object exposing `.length` for ZIP size, and the exact `{ archivePath, sha256, files }` receipt; throws for oversized artifacts.
- Retains: `buildYandexCandidate({ projectDir, outputZip })` and its receipt shape.

- [x] **Step 1: Write failing boundary tests.** Check both limits with exact equality and one byte excess; assert UTF-8 receipt byte accounting, and that a normal candidate passes the guard.
- [x] **Step 2: Run the targeted test file.** `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/yandex-candidate.test.mjs`; RED: missing export.
- [x] **Step 3: Implement guards.** Construct the receipt immediately after ZIP creation, run ZIP and CLI-serialized receipt size checks, then invoke `writePinnedOutput`.
- [x] **Step 4: Run targeted test.** Same command; 14/14 PASS.
- [x] **Step 5: Run full tests, syntax checks, diff whitespace check.** `npm test` 1037 PASS/16 SKIP, Quality 18 PASS; `npm run check`, `npm run check:c5-scripts`, `git diff --check` PASS.
- [x] **Step 6: Record audit disposition and commit.** No unverified Release PASS claim; build receipt is checked before output file creation.
