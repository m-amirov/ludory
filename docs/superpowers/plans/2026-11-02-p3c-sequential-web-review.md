# P3c.2 Sequential Web Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, source-bound five-image Web DEV QA review with V2 upload checks, durable audit records and safe recovery to PR #64.

**Architecture:** Keep `@ludory/release`'s P3c.1 handoff pure/read-only. Implement a Studio-private QA review contract, journal and host orchestrator; every `host.turn` submits exactly one already-hashed image to the existing trusted Web DEV adapter. Expose preview/apply/status/restart through Studio CLI; JSON on disk is never fresh attestation.

**Tech Stack:** Node.js 22+ ESM, `node:test`, existing `@ludory/release` handoff and `@ludory/ai` DEV host, built-in `fs`, `crypto`, `path`.

**Spec:** `docs/superpowers/specs/2026-11-02-p3c-sequential-web-review-design.md`

## Global Constraints

- The only Web reviewer model is `chatgpt-web/gpt-6-sol-instant`, `low` reasoning; the adapter backend ID `gpt-5.6-sol` stays untouched.
- Ordered images: `desktop-1000x720`, `mobile-390x844`, `landscape-667x375`, `icon`, `cover`.
- A preview has zero file writes and zero Web calls; live transmission requires explicit `--apply` and a verified isolated DEV host.
- Original ZIP, receipts, metadata, screenshots and promo files are read-only. No Docker, external API, new dependencies, platform submission or publication.
- Every status retains `releaseReady:false`, `publicationAllowed:false`, `actualModeration:'NOT_RUN'` and preserved P3b `captureStatus`.
- A local journal is untrusted historical audit data; recovery is a fresh five-turn run with full input revalidation, new output and `--confirm-reviewer-stopped`, never selective skip from editable JSON.
- The PR stays Draft; no merge without owner approval and independent review.

## Review Focus

1. Input file replaced after preview or between two turns: refuse further uploads, leave recovery state (Task 3 test).
2. Writable local JSON with recomputed hash chain: status must label it a recorded claim, never genuine host attestation; restart must re-evaluate real inputs (Tasks 2/3 tests).
3. Untrusted policy citations or prompt injection in listing content: no release-policy PASS or instructions executed from task data (Task 1 test).
4. Symlink ancestor, output target overlap, output race: fail closed without modifying source or following unsafe path (Tasks 1/2 tests).
5. Partial/failed host turn after an intent record: never retry automatically; no aggregate reviewed verdict from four images (Task 3 test).

---

### Task 1: Five-image contract and strict result validation

**Files:**
- Create: `packages/studio/src/qa-review-contract.mjs`
- Create: `packages/studio/test/qa-review-contract.test.mjs`
- Reference: `packages/release/src/qa-review-handoff.mjs`, `packages/release/src/archive.mjs`, `packages/ai/src/art-review.mjs`

**Interfaces:**
- Consumes `prepareQaReviewPacket(options)` from `@ludory/release`.
- Produces `planQaWebReview(options)` returning `READY|BLOCKED|ISSUES_FOUND`, source `packet`, `captureStatus`, ordered `images: [{id,kind,file,sha256,size,mimeType,ref}]`, source paths and fail-closed release flags.
- Produces `readQaImage(image)` returning a safely reopened Buffer after checking ancestry, regular-file inode/size/hash and image format; throws `QA_REVIEW_IMAGE_*` on mismatch.
- Produces `qaImagePrompt(plan,image)` bounded to 64 KiB, with data-vs-instruction boundary and source hashes.
- Produces `parseQaImageVerdict(text, image)` returning `REVIEWED|ISSUES_FOUND|BLOCKED`, bounded P0/P1/P2 findings, source-unverified policy labels.
- Produces `verifyQaImageObservation(response,image,traceId)` boolean validating `HOST_OBSERVED`, `web-dev`, `gpt-6-sol-instant`, `low` V2 upload/chip/trace/ref/digest/bytes.

- [ ] **Step 1:** Write tests: both platform handoff fixtures give five fixed ordered images; unchanged originals; 3 screenshot PNG and 2 declared promo bytes; a symlinked or hash-changed image fails `readQaImage`; model text claiming visible without host observation is not accepted; malicious policy sources stay unverified; wrong effort, model, chip, processing event, trace/ref/hash/bytes are rejected.
- [ ] **Step 2:** Run `node --test packages/studio/test/qa-review-contract.test.mjs` and observe missing exports/failing assertions.
- [ ] **Step 3:** Implement the five functions and immutable status/prompt structures above, reusing verified P3c.1 packet data without modifying Release behavior.
- [ ] **Step 4:** Run `node --test packages/studio/test/qa-review-contract.test.mjs`; expect all PASS.
- [ ] **Step 5:** Commit `feat(qa): validate five source-bound Web review images`.

### Task 2: Exclusive append-only audit journal, never an authority

**Files:**
- Create: `packages/studio/src/qa-review-journal.mjs`
- Create: `packages/studio/test/qa-review-journal.test.mjs`

**Interfaces:**
- Consumes Task 1 plan and five image descriptors.
- Produces `beginQaJournal(outputDir, plan)` -> `{sessionId,outputDir}`; creates a new safe dir, bounded versioned `session.json`, no modifications to existing files.
- Produces `appendQaJournal(outputDir, event)` -> receipt hash; sequential exclusive event files with previous hash, fsync before return.
- Produces `inspectQaJournal(outputDir)` -> `{status:'RECORDED_REVIEWED'|'RECORDED_ISSUES_FOUND'|'PENDING_RECOVERY'|'BLOCKED', recordedOnly:true, ...}`; caps count/size, validates sequence and hash chain, never returns `HOST_OBSERVED` or release PASS.

- [ ] **Step 1:** Write tests: exclusive new directory, `REQUESTED` then `OBSERVED` chain, five complete observations as `RECORDED_*` only; partial input `PENDING_RECOVERY`; edited/missing/out-of-order record `BLOCKED`; altered file with recomputed chain cannot gain live authority; output preexists, symlink ancestor or overlap with image/evidence directories refuses writes.
- [ ] **Step 2:** Run `node --test packages/studio/test/qa-review-journal.test.mjs`; expect missing exports/failure.
- [ ] **Step 3:** Implement journal I/O, strong path/sequence limits, predictable file names, atomic/exclusive durable writes. Record only digests, bounded reviewer text, paths and event metadata, not image bytes or credentials.
- [ ] **Step 4:** Run `node --test packages/studio/test/qa-review-journal.test.mjs`; expect all PASS.
- [ ] **Step 5:** Commit `feat(qa): journal observed Web image attempts safely`.

### Task 3: Explicit five-turn Web orchestration and fresh restart

**Files:**
- Create: `packages/studio/src/qa-review.mjs`
- Create: `packages/studio/test/qa-review.test.mjs`
- Reuse Task 1 and Task 2 modules.

**Interfaces:**
- Produces `executeQaWebReview(plan, {apply=false,outputDir,host}={})` async; preview returns plan; apply validates fresh plan, probes trusted `host.probe()`, starts exclusive journal and invokes `host.turn({prompt,taskId,images:[{ref,mimeType,bytes,sha256}]})` sequentially, with `REQUESTED` durable before each turn and `OBSERVED` only after Task 1 validation.
- Produces `restartQaWebReview(options, {previousOutput,outputDir,confirmReviewerStopped=false,apply=false,host}={})` async; demands all original inputs, validates previous record/bindings, full replan and new session, never skips a previous image.

- [ ] **Step 1:** Write tests with an injected fake host: preview zero calls/writes; apply five ordered image+V2 responses, exact originals and trace IDs; `captureStatus` retained and release flags false; failed probe; model mismatch; false chip; exception after `REQUESTED` leaves pending, no sixth or repeat; source replacement after first image stops; restart blocked without owner confirmation and re-uploads all five with a fresh identity, regardless of persisted JSON claims.
- [ ] **Step 2:** Run `node --test packages/studio/test/qa-review.test.mjs`; expect missing exports/failure.
- [ ] **Step 3:** Implement state machine and error boundary. Catch unknown submission outcomes as `PENDING_RECOVERY`, never auto-retry or transform it into `REVIEWED`; close owned host in `finally`; reread image bytes immediately before every call and recompute whole P3c.1 packet before final aggregate verdict.
- [ ] **Step 4:** Run `node --test packages/studio/test/qa-review.test.mjs`; expect all PASS.
- [ ] **Step 5:** Commit `feat(qa): run five explicit observed Web reviews`.

### Task 4: Studio CLI, user guidance, and regression verification

**Files:**
- Modify: `packages/studio/src/cli.mjs`
- Modify: `packages/studio/README.md`
- Modify: `packages/release/README.md`
- Create: `packages/studio/test/qa-review-cli.test.mjs`
- Reference: `packages/ai/src/dev-host.mjs`, existing `packages/studio/test/qa-cli.test.mjs`

**Interfaces:**
- Adds `qa review`, `qa review-status`, `qa review-restart` with exact flags from the spec; CLI `devHost` injection reuses `discoverDevHost` and Task 3 executor.
- Docs describe five actual Web turns, zero-effect preview, source/host provenance, local-journal limits, manual restart costs and unchanged publication gates.

- [ ] **Step 1:** Write CLI tests: valid read-only preview JSON, `--apply` calls injected host and emits bounded result, `review-status` makes no host call, recovery requires original input flags plus `--confirm-reviewer-stopped`, invalid options/output paths/partial input return nonzero and preserve source files. `help` documents the new commands.
- [ ] **Step 2:** Run `node --test packages/studio/test/qa-review-cli.test.mjs`; expect missing command/failure.
- [ ] **Step 3:** Wire CLI flags, async return handling, error codes and output, and update README docs. Do not invoke actual live host in CI.
- [ ] **Step 4:** Run `node --test packages/studio/test/qa-review-cli.test.mjs` and all Task 1–3 tests; expect all PASS.
- [ ] **Step 5:** Run `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`; read outputs and fix only regressions (RED→GREEN).
- [ ] **Step 6:** Commit `feat(studio): expose source-bound five-image Web QA review` and update PR #64 description without merging.

## Final verification

- Check the spec's bounds against the diff, all four task tests, release status and original source immutability.
- Run whole-branch fresh-context review; address Critical/Important findings with tests before shipping.
- Push/update PR #64, verify exact remote HEAD and CI; leave Draft until authentic owner-operated Web smoke, independent review and explicit approval.
