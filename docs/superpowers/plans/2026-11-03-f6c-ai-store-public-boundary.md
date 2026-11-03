# F6c AI Store Package Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public `@ludory/ai` surface match its Studio-origin trust guarantees without breaking internal Store operations.

**Architecture:** Narrow only the `index.mjs` export list and document the trust boundary. The core Store continues to serve internal modules and storage tests; high-level workflow guards remain the only supported user mutation interface.

**Tech Stack:** Node.js >=22 ESM, `node:test`, workspace `@ludory/ai`.

**Spec:** `docs/superpowers/specs/2026-11-03-f6c-ai-store-public-boundary-design.md`.

## Global Constraints

- No Studio-origin guard changes inside `store.mjs`, no migration or storage schema edits.
- No new third-party dependencies or generated output changes.
- Keep read-only public Store functions accessible.
- Run Ubuntu Node 22/24 CI; Windows is non-blocking, no Docker or release.

## Review Focus

- Public import still exposes a low-level commit function accidentally (Task 1 boundary test).
- Direct package subpath bypasses the public export list (Task 1 subpath test).
- High-level workflow functions disappear with export narrowing (Task 1 availability test).
- Internal relative imports stop resolving Store writers (Task 1 existing Store/F1c suites).
- README accidentally promises host-authenticated historical receipts (Task 1 doc review).

---

### Task 1: Restrict official package exports and explain privilege

**Files:**
- Modify: `packages/ai/src/index.mjs`.
- Create: `packages/ai/test/f6c-public-boundary.test.mjs`.
- Modify: `README.md` and `docs/audits/2026-11-03-f6-technical-audit.md`.

**Interfaces:** Public `@ludory/ai` has `readNativeRun`, `listNativeRuns`, `planWorkflow`, `executeWorkflow`; direct Store mutations continue through *relative internal* `./store.mjs` imports only.

- [x] **Step 1: Write the failing public import / package-subpath test.** Import the package root and ensure the four privileged raw Store symbols are absent and high-level/read-only API present; raw package subpath remains unexported.
- [x] **Step 2: Verify RED.** `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/ai/test/f6c-public-boundary.test.mjs` failed because `planNewRun` escaped the root.
- [x] **Step 3: Narrow `index.mjs` exports and add precise README/audit boundary language.** `store.mjs` and host verifier were unchanged.
- [x] **Step 4: Verify GREEN.** Combined targeted and existing Store/F1c tests: 42 PASS.
- [x] **Step 5: Run `npm test`, `npm run check`, `git diff --check` and commit.** Full Node+Quality suite PASS (18 Quality), syntax/check PASS, whitespace PASS; no new Release claim.
