# Studio Component Host Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Tests must be observed RED before adding production behavior.

**Goal:** Anchor new Studio component ownership in a host-controlled registry outside the game to prevent project-only ownership forgery.

**Architecture:** Add a focused Studio trust-store module, record the initial generated manifest at creation, and compare the pinned state before every component preview/update. Expose a separate reviewed trust-transfer command.

**Tech Stack:** Node.js 22+ ESM, built-in `fs`, `crypto`, `path`, `os`, `node:test`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-studio-component-host-trust-design.md`

## Global Constraints

- Only new Studio projects; no migrations or frozen-game writes.
- Never authorize overwrite from a project-local receipt or history alone.
- Preserve backups and any author edits on error.
- No unapproved `main` merge or destructive cleanup.

## Review Focus

- Cross-PC relocated copies must not be trusted without explicit acceptance.
- Path/symlink substitution of host registry must fail closed.
- Host registry disk error after partial component publish must not skip rollback.
- Concurrent trust acceptance versus component update must never silently change authority.
- Windows handling of replace/fsync failure must preserve fail-closed behavior.

### Task 1: Add host pin tests and trust module

**Files:** Create `packages/studio/src/component-trust.mjs`; modify `packages/studio/test/component-updates.test.mjs`.

- [ ] Add regression tests for forged archive, missing/modified trust pin, and subsequent clean upgrades.
- [ ] Run `node --test packages/studio/test/component-updates.test.mjs`: expected security tests fail on the previous implementation.
- [ ] Implement `assertComponentTrust`, `registerComponentTrust`, `advanceComponentTrust` with canonical, no-follow and atomic file operations.
- [ ] Run component tests: expected PASS.
- [ ] Commit focused behavior and tests.

### Task 2: Bootstrap on create and ensure transactional update

**Files:** Modify `packages/studio/src/scaffold.mjs`, `packages/studio/src/component-updates.mjs`, tests for creation and fault injection.

- [ ] Add RED tests for missing trusted create receipt and failed trust publication during update.
- [ ] Register generated state on successful create; verify before preview and apply; advance after verified publication with rollback on failure.
- [ ] Run component and scaffold tests: expected PASS.
- [ ] Commit focused behavior and tests.

### Task 3: Explicit trust transfer, docs and verification

**Files:** Modify `packages/studio/src/cli.mjs`, `packages/studio/README.md`, tests and `package.json` checks if required.

- [ ] Add RED tests for review/explicit SHA acceptance on a different host and refusal to overwrite existing pins.
- [ ] Implement `components trust` preview/accept with no automatic trust reset.
- [ ] Run target tests, `npm test`, `npm run check`, and `node examples/core-session.mjs`: expect PASS.
- [ ] Request independent code review of the F1a branch; resolve Critical/Important issues with regression tests.
- [ ] Publish branch and create PR only after release checks pass; keep `main` unchanged.
