# Verified Image Production — Slice C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate real image bytes only through a host that can attest the requested Terra/SOL producer and callable Image Gen tool in one execution context; otherwise give a safe manual-generation/import workflow.

**Architecture:** Reuse the approved read-only task routing from Slice A and the bound task/request/receipt contract established by Slice B. One narrow host adapter holds model selection and Image Gen invocation together. A separate artifact validator inspects bytes, dimensions, hashes, and project scope before immutable staging; game-runtime integration and artistic approval are separate.

**Tech Stack:** Node.js >=22 ESM, `node:test`, existing native Ludory AI/Studio, no general provider orchestrator and no new dependency by default.

**Spec:** `docs/superpowers/specs/2026-10-25-ai-task-routing-design.md` — approved 2026-10-25, Slice C only; implement **after** Slice B's native request/result boundary is settled.

## Global Constraints

- For unpinned image task, preflight `Terra → SOL → manual`; pinned `terra`/`sol` never switch. **Never fallback to the other model after a generation attempt** (including timeouts and partial results).
- A caller-supplied model name, role label, static configuration, selected tool name or generated image alone cannot attest effective SOL/Terra. Require actual host-observed effective producer identity and callable Image Gen on the **same live host route** before automatic invocation.
- The ChatGPT Image Gen function currently exposed to this session has no producer-selection argument. Treat it as **unverified** for Terra/SOL routing until a trusted host supplies independent route evidence; do not claim that it runs as either model.
- No copy of authentication material, model trace secrets or raw reasoning. All host APIs are optional and explicitly authorized; do not use browser scraping or change CEOS/Starter Kit.
- No zero-byte, malformed, oversized, truncated, off-scope or replaced image may enter the run. Immutable original bytes and SHA-256; any WebP optimization/runtime conversion is a later validated action.
- Image production, rights clearance, character continuity and independent art acceptance are distinct. Preserve `PENDING_REVIEW`, not `PASS`.
- Only new Studio-created games; no frozen game edits, no direct runtime assets or source scenes overwritten, no publication or release PASS.

## Review Focus

1. No effective model proof despite available image tool → manual handoff; Task 1.
2. Terra attempt fails after start while SOL is ready → record failure without SOL attempt; Task 2.
3. Pinned Terra unavailable but SOL ready → no substitution, with specific failure cause; Task 1.
4. Valid magic but truncated image/dimensions/byte size mismatch → reject bytes and keep output untrusted; Task 3.
5. Imported file via symlink/hardlink/parent-swap, or duplicate colliding output → no write outside native run; Task 4.

## File responsibilities

- `packages/ai/src/image-host.mjs`: one host-bound callable route contract with paired effective model/Image Gen attestation.
- `packages/ai/src/image-artifacts.mjs`: bounded format/dimension inspection, SHA checks and immutable staged-original artifact receipts.
- `packages/ai/src/image-tasks.mjs`: read-only preflight, explicit generation attempt and manual handoff/import; consumes native request/result/locking interfaces from Slice B.
- `packages/ai/src/capabilities.mjs`, `packages/ai/src/task-routing.mjs`: reuse/refine existing preflight and reason codes without weakening inherited/accessor/revoked-object guards.
- `packages/studio/src/cli.mjs`: explicit `workflow image` and `workflow image-import` commands; no `--apply` on `workflow route`.
- `packages/ai/test/image-host.test.mjs`, `packages/ai/test/image-artifacts.test.mjs`, `packages/ai/test/image-tasks.test.mjs`, `packages/studio/test/image-cli.test.mjs`: TDD and integration tests.
- `packages/studio/README.md`, `package.json`: documented host requirements and check wiring.

## Task 1: Image producer capability truth

**Interfaces:** `discoverImageHost(host)` consumes a trusted in-process host (not CLI JSON) and returns verified `imageTerra` and/or `imageSol` capabilities with bounded reasons; `planImageTask(projectDir, { run, brief, model = 'auto' }, { discover } = {})` is read-only.

- [ ] Add failing tests for absent host, mismatched model route, inherited/accessor/proxy attestation, false `imageGenCallable`, auto Terra/SOL order, and pinned model protection. Check no image call during preview.
- [ ] Run focused tests; witness RED.
- [ ] Implement capability narrowing: require simultaneous authenticated host route, observed effective `gpt-…-terra|sol` and callable Image Gen. Never infer from prompt, selected enum or cached filename.
- [ ] Run focused tests; require GREEN.
- [ ] Commit Task 1 files.

## Task 2: One bounded automatic generation attempt

**Interfaces:** `executeImageTask(plan, { apply = false, host })` commits one native image request before actual invocation, then records a result linked to its SHA, observed model identity, call status, resulting output manifest and hashes. `apply=false` returns preview unchanged.

- [ ] Add failing tests for exactly one call, failed/partial/timeout after submit, no switch to SOL post-Terra attempt, stale plan, concurrency and recovery requiring explicit acknowledgement of in-flight work.
- [ ] Run focused tests; witness RED.
- [ ] Implement the single host invocation within a bounded window; never silently retry or charge a second attempt. Record failure without fabricated artifacts and preserve uncertain/pending states.
- [ ] Run focused plus full native workflow tests; require GREEN.
- [ ] Commit Task 2 files.

## Task 3: Validated original image artifacts

**Interfaces:** `inspectGeneratedImage(bytes, { mediaType, maxBytes })` checks real content signatures, complete structure and positive dimensions for supported PNG/JPEG/WebP; `stageGeneratedImages(run, inputs)` retains immutable bytes, SHA-256, size, type, dimensions, brief/source hash and producer trace, all bound to the native run.

- [ ] Add failing tests for one real minimal valid fixture per supported format, zero/truncated/spoofed payloads, oversized data, dimension overflows, duplicate names, producer inconsistency and failed atomic publication. Assert no runtime asset is created.
- [ ] Run focused tests; witness RED.
- [ ] Implement bounded binary parsing and safe staged writes with directory identity, exclusive creation, no-follow and verify-before-commit. No generated image is treated as artistically accepted.
- [ ] Run focused tests; require GREEN.
- [ ] Commit Task 3 files.

## Task 4: Explicit manual fallback/import and Studio CLI

**Interfaces:** `ludory workflow image --project <new-game> --run <id> --brief <relative> [--model <auto|terra|sol>] [--apply] [--json]`; `ludory workflow image-import --project <new-game> --run <id> --brief <relative> --file <relative> [--apply] [--json]`. Manual results retain `USER_DECLARED` source; no fabricated Terra/SOL provenance.

- [ ] Write failing CLI tests for no host, real host, pinned failure, manual packet, safe import, bad extension/content, symlinked path, duplicate application and unchanged game SHA.
- [ ] Run CLI test; witness RED.
- [ ] Implement narrowly scoped CLI plumbing and documentation, exposing observed model, hashes, pending review and reasons without secrets.
- [ ] Run `npm test`, `npm run check`, `node examples/core-session.mjs`; require GREEN.
- [ ] Commit Task 4 files.

## Acceptance and handoff

- [ ] Node 22/24 CI on exact image-branch SHA; keep PR Draft and separate from Slice B.
- [ ] On an **actual authorized host**, capture (a) an observed Terra generation with real bytes, (b) SOL preflight fallback before any Terra attempt, (c) unavailable pinned model, (d) failed generation without secondary invocation, (e) manual import on Windows NTFS. Hash inputs and outputs.
- [ ] If no host can attest **both** effective model and callable Image Gen, mark automated acceptance `BLOCKED_HOST_CAPABILITY` even if a different image tool happens to produce bytes. This is not a failure of the manual path.
- [ ] Do not merge to `main` or claim production/release PASS without independent art, rights and platform gates.
