# Web Art Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source-locked independent GPT-6 Sol Web visual assessment of imported Codex image originals.

**Architecture:** Extend the isolated DEV adapter for one bounded binary attachment and image receipt metadata. Introduce an art-review planner, strict model-report parser and append-only receipts, then expose preview/apply through Studio CLI without granting release authority.

**Tech Stack:** Node 22+ ESM, node:test, existing @ludory/core/@ludory/ai/@ludory/studio workspaces and sharp image validation.

**Spec:** `docs/superpowers/specs/2026-10-26-web-art-acceptance-design.md`

**Implementation result (2026-10-26):** Tasks 1–4 implemented in the
`feat/web-art-acceptance` branch. Final local gates: `npm test` 278 PASS,
0 FAIL, 2 SKIP; `npm run check`, `node examples/core-session.mjs` and
`git diff --check` PASS. A fresh independent review found role ordering
and changed-reference binding issues; both were fixed with RED→GREEN tests.
**Not yet verified:** authenticated Windows Codex + compatible Web DEV helper
observing a real attachment; stock upstream helper lacks the needed protocol.
Consequently no real `PASS_ART`, rights or Release PASS is claimed.

## Global Constraints

- Only new Studio games; frozen repositories and historical ledgers unmodified.
- No REST image generation, model fallback, API key or hidden Web transport.
- No positive artistic verdict without observed `gpt-6-sol` and actual image submission.
- All writes are explicit, immutable and beneath `.ludory/ai`; image originals unchanged.
- Artistic `PASS_ART` is not rights, human approval, platform or Release PASS.

## Review Focus

- Windows 8.3 aliases versus real junctions: permit normal directories, reject links (Task 2).
- Large/corrupt image data and binary changed after preview: block without host call (Task 2).
- Forged image receipt with model echo but no observed submission: block (Task 1).
- Stale or copied review ledger: verify hashes and project/run binding (Task 3).
- P2-only feedback and repeated tiny retouches: no endless REWORK (Task 3).

---

### Task 1: Extend DEV transport to send and attest one visual attachment

**Files:** Modify `packages/ai/src/dev-host.mjs`; test `packages/ai/test/dev-host.test.mjs`.

**Interfaces:**
- `host.turn({prompt,taskId,images?:[{ref,mimeType,bytes,sha256}]})` sends
  `prepared.images=[{ref,imageUrl:'data:<mime>;base64,...',detail:'high'}]`.
- A visual turn is allowed only after a witnessed capable `gpt-6-sol`
  helper; result must attest submitted image ref/hash, never rely on text.

- [ ] Test accepted binary arrives byte-for-byte to helper and model pin remains Sol Web.
- [ ] Run: `node --test packages/ai/test/dev-host.test.mjs` → RED (visual support missing).
- [ ] Implement minimal one-image transport and strict fail-closed evidence.
- [ ] Run: `node --test packages/ai/test/dev-host.test.mjs` → PASS.
- [ ] Commit transport and tests.

### Task 2: Source-bound review planning and strict report interpretation

**Files:** Create `packages/ai/src/art-review.mjs`, `packages/ai/test/art-review.test.mjs`; modify `packages/ai/src/index.mjs`.

**Interfaces:**
- `planArtReview(projectDir,{run,image,source,contextReviewed},{discover})` returns
  readonly `READY|BLOCKED|NEEDS_USER_ACTION` with hashes, visual packet and
  `runHeadSha256`.
- `executeArtReview(plan,{apply,host})` performs exactly one Web visual turn
  only after revalidating all inputs.
- `interpretArtReview(text,expected)` validates strict JSON and computes
  `PASS_ART|REWORK|BLOCKED` from P0/P1/P2 and visual evidence.

- [ ] Add tests for only imported originals, four typed text sources, corrupt/
  linked/stale inputs, read-only preview, wrong route and structured findings.
- [ ] Run: `node --test packages/ai/test/art-review.test.mjs` → RED.
- [ ] Implement planner and parser to turn tests GREEN.
- [ ] Run: `node --test packages/ai/test/art-review.test.mjs` → PASS.
- [ ] Commit planner and tests.

### Task 3: Immutable receipt, bounded cycles and CLI

**Files:** Modify `packages/ai/src/store.mjs`, `packages/ai/src/art-review.mjs`,
`packages/studio/src/cli.mjs`; create `packages/studio/test/art-review-cli.test.mjs`.

**Interfaces:**
- `recordNativeArtReview(project,run,expectedHead,receipt)` writes one
  exclusive review JSON under `reviews/` with source/image hashes and
  refuses stale or unsafe paths.
- CLI: `workflow art-review --project DIR --run ID --image REL --source
  scene:...;characters:...;location:...;style:... --context-reviewed
  [--apply] [--json]` (imported brief obtained from the native ledger).

- [ ] Write CLI/store tests for dry-run, true Web apply, receipt tampering,
  stale source, symlink substitution, P2-only review and two rework limit.
- [ ] Run: `node --test packages/studio/test/art-review-cli.test.mjs` → RED.
- [ ] Implement protected receipt and CLI to GREEN.
- [ ] Run: `node --test packages/studio/test/art-review-cli.test.mjs` → PASS.
- [ ] Commit receipt, CLI and tests.

### Task 4: Docs, compatibility and full gates

**Files:** Modify `README.md`, `packages/studio/README.md`, `AGENTS.md`,
 `package.json`; add any targeted regression tests to existing suites.

- [ ] Document Web visual evidence, blocked/unverified outcomes, max two
  reworks, Codex handoff and owner-only host smoke.
- [ ] Run: `npm test` → all tests PASS, and note skips explicitly.
- [ ] Run: `npm run check` and `node examples/core-session.mjs` → exit 0.
- [ ] Review `git diff --check` and commit.
- [ ] Fresh whole-branch code review and one RED→GREEN fix pass if needed.
- [ ] Push as PR; do not merge or call real visual/release PASS until owner
  completes authenticated Codex + Web DEV run.

