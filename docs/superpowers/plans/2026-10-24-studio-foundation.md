# Ludory Studio Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a safe metadata-only Studio CLI and close the source feature inventory.

**Architecture:** A new Node ESM workspace package consumes Core validation. Planning is pure/read-only; applying revalidates source and Git state and creates one manifest exclusively.

**Tech Stack:** Node >=22, built-in `node:test`, Git CLI for local safety, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-24-studio-foundation-design.md`

## Global Constraints

- Preserve all existing project-owned files and legacy configs, including `src`, `public`, media, saves and `AGENTS.md`.
- Dry-run is the default; only `--apply` may write `ludory.project.json` and never overwrite it.
- No claims about SDK, runtime, upstream behavior parity, platform compliance or release.
- All new behavior requires failing-first tests and green complete suite.

## Review Focus

- Existing target file, symlink and conflicting manifest never overwritten — Task 2.
- Dirty/non-Git mature game never mutated — Task 2.
- Ambiguous YAML/duplicate keys and version/target inference fail closed — Task 1.
- Changed source bytes or Git HEAD after plan blocks apply — Task 2.
- Invalid CLI args and default dry-run produce no project writes — Task 3.

### Task 1: Project manifest and deterministic legacy extraction

**Files:** `packages/studio/src/legacy.mjs`, `packages/studio/test/legacy.test.mjs`, `packages/studio/package.json`.

**Interfaces:** `readLegacyGameSpec(projectDir): {manifest, sources:[{path, sha256}]}`. Consumes `defineGame` and git-independent file reads.

- [ ] Add tests for canonical Starter schema-2 fixture, quoted/localized values, missing/duplicate fields, malformed/ambiguous YAML, version/target absence.
- [ ] Run targeted test to see RED.
- [ ] Implement strict subset extraction and Core validation.
- [ ] Run targeted test to GREEN.

### Task 2: Preview and guarded one-file application

**Files:** `packages/studio/src/projects.mjs`, `packages/studio/test/projects.test.mjs`.

**Interfaces:** `planMigration(projectDir)`, `planInit(projectDir, data)`, `applyPlan(plan)`; plans report `status`, `conflicts`, `writes`, `sources`, `manifest`.

- [ ] Add temp fixture tests for no-write preview, clean Git apply, idempotency, conflict/dirty/non-Git/symlink/source-change/HEAD-change blocks, new empty init.
- [ ] Observe RED.
- [ ] Implement readonly planner + exclusive manifest create, with all guards checked before the write.
- [ ] Run targeted and full suite GREEN.

### Task 3: CLI + docs + CI

**Files:** `packages/studio/bin/ludory.mjs`, `packages/studio/src/cli.mjs`, `packages/studio/test/cli.test.mjs`, root `package.json`, CI, README.

**Interfaces:** `ludory init|inspect|migrate|help` with `--project`, `--json`, `--apply` and init metadata flags.

- [ ] Add child-process CLI tests for help, dry-run, apply, invalid args and exit codes; observe RED.
- [ ] Implement CLI, wire workspace and document commands and non-goals.
- [ ] Run `npm ci --offline`, `npm test`, `npm run check`, Core example, CLI fixtures.
- [ ] Open feature PR and verify remote Node 22/24 CI. Do not merge without explicit owner direction.

### Task 4: Source inventory closure evidence

**Files:** `docs/migration/source-closure.json`, `docs/migration/CAPABILITIES.md`, `packages/studio/test/inventory.test.mjs`.

- [ ] Add test requiring pinned SHAs, unique source paths, 398 mapped blobs and no missing destination.
- [ ] Observe RED then commit the enumerated source closure and functional matrix.
- [ ] Re-run full suite and verify no parity claims are made prematurely.
