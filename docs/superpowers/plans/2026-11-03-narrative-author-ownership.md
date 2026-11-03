# Narrative Author Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate author-controlled narrative content from managed Ludory components, including safe migration of already-created games.

**Architecture:** Add explicit authorFiles to trusted template metadata and schema-2 component ownership state. Use exact-path eligibility checks and the existing transaction/recovery model to migrate legacy state through explicit confirmation; unchanged managed bytes retain strong SHA protection.

**Tech Stack:** Node.js ESM, `node:test`, Studio catalog/scaffold/component-update/CLI, SHA-256 and filesystem inode protections.

**Spec:** `docs/superpowers/specs/2026-11-03-narrative-author-ownership-design.md`.

## Global Constraints

- Never author-own `src/main.js`, `src/entry.js`, `index.html`, `assets/ludory-narrative.js` or Studio receipts.
- Never waive protected-file digests to achieve IN_SYNC.
- No direct rewrite of host trust registry, metadata or receipt without a vetted transaction.
- Preserve all old component state/archives, durable rollback and exact owner confirmation.
- Make default new template version 1.2.2 after PR #82 title template 1.2.1.

## Review Focus

1. Malicious template metadata attempts to designate launcher or runtime bundle as author-owned.
2. Modified protected file is concealed by a legitimate authored-file update.
3. Same path is in both managed and authored sets, or a new component collides with existing owner data.
4. A source/manifest file or parent changes between preview and apply; TOCTOU must fail closed.
5. Legacy game with modified story and removed unused art must migrate without overwriting any author bytes, including backup failure recovery.

---

### Task 1: Catalog ownership declaration and fresh creation

**Files:** `packages/studio/src/catalog.mjs`, `packages/studio/src/scaffold.mjs`, `packages/studio/catalog/templates/narrative-interactive/template.json`, `packages/studio/test/catalog.test.mjs`, `packages/studio/test/scaffold.test.mjs`, `packages/studio/test/component-updates.test.mjs`.

- [x] Add failing tests: template declares authorFiles; invalid launcher path rejected; generated component manifest has disjoint managed/author sets.
- [x] Run RED with expected missing field or schema mismatch.
- [x] Implement template authorFiles validation and new state representation while preserving v1 reads.
- [x] Run GREEN targeted tests and verify new creation provenance.

### Task 2: Explicit legacy adoption transaction

**Files:** `packages/studio/src/component-updates.mjs`, `packages/studio/src/cli.mjs`, `packages/studio/test/component-updates.test.mjs`, `packages/studio/test/cli.test.mjs`.

- [x] Tests RED: v1 modified story reports needs action, stale/mismatched consent rejects, successful adoption leaves exact authored hashes, modified launcher rejects.
- [x] Implement `components adopt` read-only plan and dual SHA-confirmed apply using existing anchored atomic update/backup/recovery infrastructure; don't invent a second unsafe write path.
- [x] Verify archive provenance forward/backward, repeated idempotent status, trust transfer explicitness, apply rollback and malicious paths.
- [x] Run targeted tests GREEN, commit isolated adopt slice.

### Task 3: Managed-only updates and host trust

**Files:** `packages/studio/src/component-updates.mjs`, `packages/studio/src/component-trust.mjs`, tests.

- [x] RED tests: new template update preserves author assets including deletion; clone must request explicit trust; launcher modification blocks status and trust.
- [x] Update planner/apply to use managed set only and prevent author collisions with new files. Validate authored proof separately.
- [x] Integrate ownership transition with host trust and existing recovery, test fail-closed after a simulated interruption.
- [x] GREEN targeted tests, then full `npm test`, `npm run check`; record real browser QA separately as NOT_RUN when unavailable.

### Task 4: Existing game's adoption and PR

- [x] From updated Ludory, rehearse M2 S01 project adoption on an isolated disposable clone/snapshot; prove story/media preserved by hashes.
- [ ] Publish Ludory PR stacked on PR #82 and leave Draft until security-sensitive review gates pass. No automatic merge.
- [ ] After accepted Ludory merge, refresh the game branch and rerun full S01 tests and local derivation; keep game PR Draft until browser QA.
