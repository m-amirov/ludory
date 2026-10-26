# GPT Image Provider — Slice C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Terra/SOL image-author identity gate with the approved source-aware art-brief → independent GPT Image production path, with real OpenAI Images API integration and fail-closed review receipts.

**Architecture:** Web DEV, when genuinely available with selected story/style references, writes reviewable art briefs; the task's primary model can write the same brief when Web DEV is unsuitable. The generation adapter is a separate, explicit GPT Image provider: `auto` selects quality-first Sunburst, with optional Flare pin; native image requests record *requested* provider model without falsely claiming an *observed* effective model. Keep legacy image events readable, guard paid calls, and reuse immutable image storage, manual import and pending recovery.

**Tech Stack:** Node.js 22/24, native `fetch` (injected in tests), `sharp`, `node:test`, Ludory AI native append-only journal.

**Spec:** `docs/superpowers/specs/2026-10-25-ai-task-routing-design.md` §3–4 and Slice C, updated 2026-10-26.

## Global Constraints

- Frozen games and CEOS are read-only; no runtime image placement, art acceptance, rights acceptance or Release PASS in this slice.
- No paid generation in tests; any real invocation needs `--apply`, configured `OPENAI_API_KEY` and explicit `LUDORY_IMAGE_ALLOW_PAID=1` opt-in.
- One journaled request → at most one provider call; errors/timeouts preserve uncertain pending state and never retry automatically.
- Store SHA-256 of original bytes, verify format and complete JPEG/WebP/PNG decode, keep review-only status.
- Do not pass secrets or raw provider HTTP errors into journals or logs.
- No unproven effective GPT Image model attestation; store selected/requested model distinctly from observable server fields.

## Review Focus

1. API key absent or paid opt-in absent → no request and no false READY; tests in Task 1 and Task 3.
2. Provider HTTP 4xx/5xx, truncation or malformed JSON/base64 → journal remains pending or fails closed with no fake image; tests in Task 1 and Task 2.
3. Tampered source/brief between preview and apply → no HTTP call; test in Task 2.
4. Image bytes invalid or output directory replaced → no trusted receipt or offscope write; tests in Task 2 (existing regression preserved).
5. Historical Terra/SOL event ledger and manual import remain readable; tests in Task 2.

---

### Task 1: Image provider adapter

**Files:** `packages/ai/src/image-host.mjs`, `packages/ai/test/image-host.test.mjs`, new `packages/ai/test/openai-image-provider.test.mjs`.

**Interfaces:** `createOpenAIImageHost({ apiKey, allowPaid, fetchImpl, quality, size } = {})` returns `{ probe(), generate({model, prompt, maxImages, signal}) }` or `null`; `discoverImageHost(host)` returns validated `{ imageGpt, imageTerra, imageSol }` for new/old clients.

- [ ] Test absent key/authorization, Sunburst default, pinned Flare and no paid call during discovery. Run `node --test packages/ai/test/openai-image-provider.test.mjs`, confirm RED.
- [ ] Implement strict provider adapter using `POST https://api.openai.com/v1/images/generations`, explicit GPT image model, bounded payload, `b64_json`, no automatic retry, no credential logging; run test, confirm GREEN.
- [ ] Test malformed body, wrong/missing bytes, API errors, canceled request and unavailable host; RED then GREEN.
- [ ] Commit provider and tests with `git diff --check` passing.

### Task 2: Journal-bound GPT Image workflow

**Files:** `packages/ai/src/image-tasks.mjs`, `packages/ai/src/store.mjs`, `packages/ai/src/index.mjs`, `packages/ai/test/image-tasks.test.mjs`, `packages/ai/test/store.test.mjs`.

**Interfaces:** `planImageTask(project, {run, brief, model='auto'}, {discover})`; `executeImageTask(plan,{apply,host})`; request schema for GPT path `{taskKind:'image', route:'gpt-image', requestedModel:'auto'|'sunburst'|'flare', modelRequested:'gpt-image-2.5-*', modelObserved:null, brief}`. Legacy Terra/SOL ledger reads stay supported.

- [ ] Tests verify GPT Image selected independently of brief-author model; stale/tampered plan blocks; authenticated API response yields immutable review-only original with nullable observed model; run targeted test, confirm RED.
- [ ] Integrate GPT route with existing one-call journal, byte verification and source checks. Run targeted test, confirm GREEN.
- [ ] Tests verify manual import and preexisting historical events, timeout, invalid image, symlink/collision guards; RED where behavior changes, then GREEN.
- [ ] Commit task/journal change and tests.

### Task 3: CLI routing and documentation

**Files:** `packages/ai/src/task-routing.mjs`, `packages/ai/src/capabilities.mjs`, `packages/studio/src/cli.mjs`, `packages/ai/test/task-routing.test.mjs`, `packages/studio/test/image-cli.test.mjs`, `packages/studio/test/task-routing-cli.test.mjs`, `docs/superpowers/specs/2026-10-25-ai-task-routing-design.md`, CLI user guide/README.

**Interfaces:** `workflow image --model auto|sunburst|flare --apply`; `workflow draft --task art-concept --source ...` already handles optional Web DEV creation of source-aware brief, with primary-model fallback as explicit authoring/handoff when no trusted primary-model runtime hook exists.

- [ ] Tests verify new default route and model pins, CLI wire-through of real adapter only on `--apply`, key/budget gate, truthful text output, and no false art PASS. Run targeted CLI tests, confirm RED.
- [ ] Update router/capability discovery and CLI with env-configured production adapter; run tests, confirm GREEN.
- [ ] Align spec/usage/README with two distinct roles and remaining runtime limitation, document optional model pin, costs, budget opt-in, manual fallback and review gates.
- [ ] Run `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`, plus smoke on Node 22 and 24 where available. Commit on feature branch; do not push/merge or perform a real paid generation without explicit authorization.
