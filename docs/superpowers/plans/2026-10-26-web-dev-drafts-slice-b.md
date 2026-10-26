# Web DEV Narrative Drafts — Slice B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invoke a verified, user-authorized Web DEV host for episode scripts and art concepts, preserving reviewable draft bytes and honest native evidence; fall back to an explicit manual packet/import when the host cannot be verified.

**Architecture:** Keep `workflow route` read-only and add a separate, explicitly applied draft action. A narrow in-process DEV host adapter discovers the isolated browser-helper and processes one bounded turn; no CEOS runtime import or generic broker. The native run ledger records intent before external execution and a bound result afterward. Generated text is staged outside gameplay pending a separate consistency/integration gate.

**Tech Stack:** Node.js >=22 ESM, `node:test`, Ludory native AI/Studio packages; no new runtime dependency. Windows DEV browser-helper is an optional *host installation*, never bundled or copied into Ludory.

**Spec:** `docs/superpowers/specs/2026-10-25-ai-task-routing-design.md` — approved 2026-10-25, Slice B only. Slice C has its own plan.

## Global Constraints

- `episode-script` and `art-concept` only; Codex and image routes stay unchanged. Existing `workflow route` remains read-only with no `--apply`.
- Inspect only an explicitly selected isolated DEV profile and its documented launcher descriptor. Do not import CEOS, copy cookies/tokens, inspect Stable profiles, scrape CDP, or pass local tools to Web DEV.
- A descriptor, configured model string, successful helper launch, or submitted turn alone is **not** entitlement/model evidence. An executable route must be attested by the installed helper's actual host-side selected model and authenticated transport. Missing attestation means no automatic `READY`/acceptance.
- Requests are bounded and source-bound: active native run, game ID/source fingerprint, stage, task kind, brief/reference file hashes, approved output schema. Reject escaped, linked, changed or oversized files.
- Source text arrives as untrusted bytes. Save new reviewable draft/receipt inside the active native run only, not directly into scenes/game code; never grant narrative PASS from model assertions.
- One pending host invocation blocks a duplicate and checkpoint. On timeout/crash, retain a pending/unknown state until explicit recovery that acknowledges possible in-flight execution. Do not auto-retry or switch models.
- Manual packets/imports identify provenance as `USER_DECLARED`; only a helper-observed attempt can say `HOST_OBSERVED`. Manual import never masquerades as an executed DEV session.
- Do not modify CEOS, Starter Kit, frozen games, component updater PR #10 or current PR #11. This branch is stacked on PR #11; no merges to `main`.

## Review Focus

1. Missing/modified DEV descriptor or mismatched Stable path → unavailable, zero spawn; test Task 1.
2. Host helper accepts prompt but does not attest selected effective model → not verified and no accepted automatic draft; test Task 2.
3. Exit/timeout after a submitted request → durable pending state; no silent second invocation; test Task 3.
4. Source/attachment symlink or changed hash between preview and apply → block without any off-root write; test Task 2.
5. Forged imported metadata or changed draft bytes → never promoted to HOST_OBSERVED or narrative PASS; test Task 4.

## File responsibilities

- `packages/ai/src/dev-host.mjs`: isolated profile/descriptor discovery, bounded browser-helper protocol, host-observed transport/model evidence; no direct game writes.
- `packages/ai/src/draft-tasks.mjs`: source-bound task preview, request envelope, text validation and draft receipt orchestration.
- `packages/ai/src/store.mjs`: versioned pending DEV request/result/artifact event support and recovery guards, reusing native locking and hash chaining.
- `packages/ai/src/index.mjs`: exports for the new task interface.
- `packages/studio/src/cli.mjs`: separate `workflow draft` preview/apply and `workflow draft-import` explicit manual path (syntax below), preserving `workflow route`.
- `packages/ai/test/dev-host.test.mjs`, `packages/ai/test/draft-tasks.test.mjs`, `packages/studio/test/draft-cli.test.mjs`: protocol, provenance, CLI and negative regression tests.
- `packages/studio/README.md`, `package.json`: scope and check wiring.

## Task 1: Trust boundary and real DEV profile discovery

**Interfaces:** `discoverDevHost({ devHome, stableHome, spawnImpl } = {})` returns a bounded unavailable cause or an adapter with `probe()` and `turn(request)`. Probe reports only *actually witnessed* entitlement, selected route/model and callable protocol; a local descriptor is insufficient.

- [ ] Write failing tests for missing profile/helper, Stable profile equality, unsupported/foreign descriptor, accessor/inherited capability properties, revoked Proxy, and successful witnessed helper handshake. Assert probe never reads browser secrets or launches unconfigured executables.
- [ ] Run `node --test packages/ai/test/dev-host.test.mjs`; witness expected RED.
- [ ] Implement limited profile/descriptor and helper protocol. Start the advertised helper without shell interpolation; bound startup/turn, stdout and stderr; isolate environment and force `localToolsEnabled:false`. Recognize only documented `ready`, `prepared_selected`, `send_activated`, submitted/result/error frames. Check protocol version and observed effective model where available; otherwise report `DEV_ROUTE_UNVERIFIED`.
- [ ] Run focused tests; require GREEN and no uncontrolled process left on timeout.
- [ ] Commit only Task 1 files.

## Task 2: Source-bound draft planning

**Interfaces:** `planDevDraft(projectDir, { run, taskKind, brief, sources = [] }, { discover } = {})` returns a mutation-free plan with source/hash binding, eligible host route or `NEEDS_USER_ACTION` manual packet. `taskKind` is exactly `episode-script` or `art-concept`.

- [ ] Add failing tests for both task kinds, valid Studio game with dirty/unversioned Git, foreign/frozen project, missing/oversize/binary brief, symlinked ancestors, hash mutation and forged discover results. Assert no `drafts/` or `.ludory` directory created by preview.
- [ ] Run `node --test packages/ai/test/draft-tasks.test.mjs`; witness RED.
- [ ] Implement bounded source envelopes reusing native source fingerprints and existing route eligibility; avoid embedding secrets, absolute external paths or raw model reasoning in plans.
- [ ] Run focused tests; require GREEN.
- [ ] Commit only Task 2 files.

## Task 3: Explicit automatic attempt and crash safety

**Interfaces:** `executeDevDraft(plan, { apply = false, host })` returns the preview when not applied. An applied verified plan appends one `ACTION_REQUESTED` with executor `web-dev`, then invokes the trusted DEV helper, validates returned text plus actual route observation, stages immutable draft bytes and SHA-256 receipt, and appends a paired result. No direct game-file edit.

- [ ] Add failing tests for valid host turn, rejected/unobserved model, malformed/empty/oversized output, helper timeout, repeated apply, interrupted result, stale source, concurrent run and synthetic `PASS` claim. Assert request exists before fake helper runs and failed result cannot advance stage.
- [ ] Run focused AI/store tests; witness RED.
- [ ] Extend native event schema narrowly with a typed `web-dev` executor result (`HOST_OBSERVED`, `UNVERIFIED`, `FAILED`), bound output hash and pending state. Preserve existing Codex event compatibility, locking, portable run integrity and recovery semantics.
- [ ] Run focused tests and full `npm test`; require GREEN.
- [ ] Commit only Task 3 files.

## Task 4: Manual packet/import and Studio CLI

**Interfaces:** `ludory workflow draft --project <new-game> --run <id> --task <episode-script|art-concept> --brief <relative-text> [--source <relative;...>] [--apply] [--json]`; `ludory workflow draft-import --project <new-game> --run <id> --task <...> --brief <relative-text> --file <relative-draft> [--apply] [--json]`. Manual import must never claim it was generated by Web DEV.

- [ ] Add failing CLI and import tests for preview no writes, explicit apply only, no host manual handoff, declared-provenance import, duplicate or unsafe file, preserved SHA after import, and disallowed `--apply` on `workflow route`.
- [ ] Run focused CLI tests; witness RED.
- [ ] Add CLI and narrowly scoped import: user-selected draft must be an existing safe project-relative regular file; record hash and `USER_DECLARED`, never `HOST_OBSERVED`/`PASS`.
- [ ] Add a read-only narrative gate boundary: drafts stay `PENDING_REVIEW`; no scene integration without a separate, independently verified narrative/consistency result. Do not invent a validator or write gameplay scenes in this slice.
- [ ] Run `npm test`, `npm run check`, `node examples/core-session.mjs`; require GREEN.
- [ ] Commit only Task 4 files.

## Acceptance and handoff

- [ ] Inspect diff and `git diff --check`: only AI/Studio/docs/tests, no CEOS/Starter Kit, `main`, PR #11 or frozen game modifications.
- [ ] On **real Windows NTFS with the installed authorized DEV launcher**, verify descriptor protocol and effective model observability, an episode-script and art-concept draft, SHA/receipt, no scene rewrite, handle/timeout/recovery, and missing host manual import. If the installed helper cannot attest the selected model, return `BLOCKED_DEV_ROUTE_UNVERIFIED` and treat MVP as **NOT VERIFIED**; do not weaken the contract to get green.
- [ ] CI Node 22/24 on exact final SHA; keep stacked PR Draft. No model-run success without actual host evidence, and never claim Release PASS.
