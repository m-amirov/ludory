# F6e security inventory implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Generate and verify an honest, reproducible package/notice/asset evidence snapshot while closing the observed `fflate` advisory.

**Architecture:** A small Node ESM inventory command reads immutable tracked inputs; it never resolves rights automatically. Versioned machine evidence and one read-only precheck protect against unnoticed drift. The online advisory scan remains separately observable.

**Tech Stack:** Node.js 22+ ESM, npm lockfile 3, CycloneDX 1.5, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-f6e-security-inventory-design.md`

## Global constraints

- No game/legacy source writes, no Docker, no network-required CI gate, no new production dependency, no 1.0 tag.
- A local technical integrity PASS never means rights/legal or supply-chain provenance PASS.
- Preserve explicit real-host, real-SDK and owner release blockers.

## Review focus

- A missing vendored mandatory package must fail the inventory check.
- Tampered or missing vendored legal notice bytes must fail with an actionable error.
- A newly added, unlisted template graphic must not silently disappear from the ledger.
- Edited template SVG bytes must fail against the existing SHA-bound ledger.
- A partial/vulnerable npm dependency upgrade must remain observable in the online audit.

## Tasks

### Task 1 — Deterministic inventory and rights boundary

**Files:** Create `scripts/f6e-inventory.mjs`, `scripts/test/f6e-inventory.test.mjs`,
`docs/evidence/f6e-components.cdx.json`, `docs/evidence/f6e-template-asset-rights.json`.

- [x] Write fixture tests for current root + six vendored packages, SHA-512
      conversion, missing/mismatched vendor manifest package, altered prebuilt
      and runtime bytes, tampered notices, missing/changed/new template media
      (including GIF), and stale committed BOM.
- [x] Run tests RED against absent generator and asset ledger.
- [x] Implement `createF6eInventory(rootDir)`, `verifyTemplateAssetLedger(rootDir)`
      and `checkF6eInventory(rootDir)` with deterministic JSON and explicit
      `RIGHTS_BLOCKED` output. Add CLI `--write`/`--check` with no side effects
      in check mode.
- [x] Generate the tracked inventory and run targeted tests GREEN.
- [ ] Commit evidence and tests together.

### Task 2 — Advisory remediation and checks

**Files:** Modify `package.json`, `package-lock.json`; create a report
`docs/audits/2026-11-03-f6e-security-license-assets.md`; update roadmap.

- [x] Record the `fflate@0.8.2` online npm advisory as the RED security scan;
      inspect exact advisory and scope of ZIP parsing in this repo.
- [x] Update the pinned dev package to `0.8.3`, regenerate lockfile using npm,
      and rerun the **online** advisory scan. Never replace it with offline PASS.
- [x] Add `check:security-inventory` to the existing `precheck` sequence and
      document exact inventory counts, licenses/asset blockers and scan status.
- [x] Run `npm test`, `npm run check`, candidate checks, `git diff --check`.
- [ ] Request read-only review, publish PR and wait exact-HEAD Ubuntu Node22/24
      and applicable Runtime browser CI before integration into `main`.

## Integration gate

Full local suites green, independent reviewer resolved, GitHub exact-HEAD
required CI green. No production release, `1.0.0` tag or rights clearance.
