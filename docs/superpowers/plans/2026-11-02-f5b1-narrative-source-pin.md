# F5b1 Narrative Dual-Target Source Pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit and pin a single trusted Studio narrative source for subsequent independent Yandex/VK export, rejecting stale or incompatible sources before any derived project or ZIP is written.

**Architecture:** A Studio-internal module composes the existing secure preview snapshot lifecycle. Planning checks the native Studio template/profile/targets and returns `READY_TO_DERIVE` with source digest and file hashes; materializing the pin rechecks the exact source using `buildPreview` and returns an owned temporary immutable snapshot with explicit cleanup. No SDK archive is built in F5b1.

**Tech Stack:** Node 22+ ESM, Studio trust, Node test, Core game schema.

**Spec:** `docs/superpowers/specs/2026-11-02-f5b-narrative-platform-export-design.md` and `docs/superpowers/specs/2026-10-30-ludory-v1-completion-design.md`.

## Global Constraints

- New, host-trusted `narrative-interactive` / `narrative-game` Studio project only, both `yandex-games` and `vk-games` declared.
- Preserve original bytes, dirty/unversioned author files and frozen games. No CEOS import, platform publication or SDK impersonation.
- Use `planPreviewBuild`/`buildPreview` immutable content snapshot; never trust caller-supplied mutable plan fields to invent a source digest.
- F5b1 status `READY_TO_DERIVE` only, not a candidate, release readiness, live SDK or dual-platform acceptance.
- Do not loosen current Yandex/VK template provenance, archive allowlist or Release checkers.

## Review Focus

1. Target omission or mixed target declaration: reject before producing snapshot (Task 1 tests).
2. Non-Studio, copied, or symlinked source: fail closed through native trust and preview admission (Task 1 tests).
3. Author file added/changed after plan: stale plan blocked with no temporary snapshot leaked (Task 1 tests).
4. Forged `sourceDigest`, file array or source path in a caller-supplied plan: rederive and compare all fields against the original plan identity (Task 1 tests).
5. Accidental presentation of `READY_TO_DERIVE` as a validated ZIP/release: explicit no-archive/no-live fields in the pin result (Task 1 tests).
6. Metadata swapping between trust and template reads, or Windows native path aliases: bind the bytes actually parsed to host-trust and canonicalize physical identity (Task 1 regression tests).

---

### Task 1: Source-bound narrative export admission

**Files:**
- Create: `packages/studio/src/narrative-platform-export.mjs`
- Create: `packages/studio/test/narrative-platform-export.test.mjs`
- Modify: `package.json` (syntax check only)

**Interfaces:**
- Export `planNarrativePlatformExport(projectDir)` returns `{ mode: 'narrative-platform-export', status: 'READY_TO_DERIVE', project, sourceDigest, files, sourcePlanId, targets, writes: [] }` or `{ status: 'BLOCKED', reasonCode, writes: [] }`. `sourcePlanId` binds an in-memory plan to the original secure preview plan and prevents forged/ad hoc fields from being replayed.
- Export `materializeNarrativePlatformSource(plan)` returns `{ status: 'SOURCE_PINNED', root, sourceDigest, files, cleanup, targets, publicationAllowed: false }` or `{ status: 'BLOCKED', reasonCode, writes: [] }`. The caller must invoke `cleanup` after its own read; no target ZIP or derived Studio project exists in this task.

- [ ] **Step 1:** Write failing tests that create fresh narrative, Yandex-only, generic runtime, copied and symlinked fixtures; assert only valid dual-target narrative produces `READY_TO_DERIVE` and zero writes. Assert `SOURCE_PINNED` source digest equals secure preview, all files hashed and original unchanged; mutation/addition after planning returns `BLOCKED`; forged plan root/digest/files/mode and repeated cleanup cannot claim successful pin or escape source checks.
- [ ] **Step 2:** Run `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/narrative-platform-export.test.mjs` and observe expected RED before implementation.
- [ ] **Step 3:** Implement smallest composition of secure preview snapshot with a private in-process plan token/identity; only trusted root/receipt/template/profile and both target declarations allowed. No additional copy mechanism.
- [ ] **Step 4:** Re-run targeted tests, `npm test`, `npm run check`, `node examples/core-session.mjs`; compare outputs to expected green.
- [ ] **Step 5:** Commit Task 1. Record F5b2 platform bootstrap and F5b3 browser checks as **not implemented**; leave branch for a separate bounded PR and review.
