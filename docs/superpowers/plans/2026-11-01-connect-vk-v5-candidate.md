# Connect VK V5 Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic local VK candidate packaging and an independent read-only candidate/receipt check without granting release authority.

**Architecture:** A VK-specific builder validates a new Studio game's trusted source and packages a strict allowlist of bytes. The existing narrow stored-ZIP reader gains a VK profile; a Release check compares independently observed ZIP entries to a saved builder receipt and carries explicit `NOT_RUN` platform gates.

**Tech Stack:** Node.js 22+ ESM, `fflate`, `parse5`, Studio origin trust and Release ZIP parser.

**Spec:** `docs/superpowers/specs/2026-11-01-connect-vk-v5-candidate-design.md`

## Global Constraints

- No writes to CEOS/Starter Kit or existing games; never import their history.
- No publishing, real Bridge or device acceptance. All release-authority booleans false.
- No force push or automatic merge; GitHub PR and independent CI gates remain separate.

## Review Focus

- A copied project's forged receipts must fail registration checks.
- HTML script hiding/duplication and `<base>` redirection must fail admission.
- Symlinks, Windows reserved names and case-colliding asset paths must not enter ZIP.
- A corrupted stored ZIP or mismatched saved receipt must not yield local PASS.
- Candidate output inside the project or an existing owner output must never be overwritten.

---

### Task 1: Candidate admission and deterministic ZIP

**Files:** Create `scripts/build-vk-candidate.mjs`, `packages/studio/test/vk-candidate.test.mjs`; extend `packages/connect-vk/README.md`.

**Interfaces:** `buildVkCandidate({projectDir,outputZip}): Promise<{archivePath,sha256,files}>`; `validateVkCandidatePath(name): string`; CLI `node scripts/build-vk-candidate.mjs --project <game> --output <new.zip>`.

- [x] Write failing tests for trustworthy Studio creation; exact ZIP entries/hashes; reproducibility; untrusted copy, target mismatch, changed Bridge/license, HTML injection, symlink, invalid names, existing/in-root output.
- [x] Run `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/vk-candidate.test.mjs` and confirm missing builder failure.
- [x] Implement VK-only admission, strict HTML/JS module parse, local bundle/hash snapshot checks, safe reads and deterministic exclusive ZIP write.
- [x] Re-run focused tests and verify 0 failures; run Yandex builder tests to protect existing path.
- [x] Commit Task 1.

### Task 2: Independent verifier and command-line check

**Files:** Modify `packages/release/src/archive.mjs` and `packages/release/src/index.mjs`; create `packages/release/src/vk-check.mjs`, `packages/release/test/vk-check.test.mjs`; modify `packages/studio/src/cli.mjs`, `packages/studio/test/release-cli.test.mjs`.

**Interfaces:** `inspectVkArchive(archivePath)`; `checkVkCandidate({archivePath,receiptPath}) -> {status,gates,releaseReady:false,publicationAllowed:false}`; `ludory release vk-check --archive <zip> --receipt <json> [--json]`.

- [x] Write failing tests for VK ZIP accepted, wrong target/missing license/corrupt ZIP rejected, changed/partial receipt blocked or failed, and CLI read-only behavior.
- [x] Run the focused release tests and confirm the new interfaces are absent.
- [x] Add parameterized VK profile to stored ZIP reader without changing Yandex defaults; implement read-only receipt check and CLI dispatch.
- [x] Re-run Release checks, Studio CLI tests and Yandex archive tests.
- [x] Commit Task 2.

### Task 3: CI and end-to-end acceptance

**Files:** Modify `package.json`, `.github/workflows/runtime-browser.yml`, `packages/connect-vk/README.md`.

- [x] Add syntax and local build/check command validation to CI and path filters.
- [x] Exercise a fresh Studio VK game fixture from creation through ZIP and `PASS_LOCAL`; assert `releaseReady=false` and `publicationAllowed=false`.
- [x] Run `npm test`, `npm run check`, `npm run check:vk-template`, `node examples/core-session.mjs`, `git diff --check` and record exact outcomes.
- [x] Commit Task 3; prepare PR against `main`, leaving merge for owner approval.

## Verification and independent review

- Baseline `main`: 823 pass, 13 skip, 0 fail; quality integration 18 pass.
- V5 final local suite after independent review fixes: 842 pass, 13 skip, 0 fail; quality integration 18 pass.
- `npm run check`, `npm run check:vk-template`, `npm run check:v5-scripts`, Core example, focused VK/Yandex/Release tests and `git diff --check`: pass.
- Independent read-only review identified four Important faults: validation-to-ZIP TOCTOU, commented/remote JS+HTML bypasses, swapped/symlinked output parent, and incompatible ZIP/receipt/count bounds. The six added regression cases were RED before fixes and GREEN afterward; all original tests remain green. No second reviewer run is claimed.
- Real VK SDK, physical-device checks, live ads, moderation, publication and Release PASS: **NOT_RUN**. CI on the PR's actual remote HEAD is still a separate gate.
