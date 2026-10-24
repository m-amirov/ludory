# Studio Profiles and Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe profile/template discovery and dependency-free game creation to Ludory Studio without modifying mature games.

**Architecture:** A JSON-only catalog module validates built-in and explicit external profiles and templates. A separate scaffolder plans a reproducible set of new files, revalidates on apply, and writes exclusively with rollback of owned new files. The CLI exposes catalog commands and `create` while keeping prior `init`/`migrate` unchanged.

**Tech Stack:** Node.js >=22, ESM, built-in Node modules, existing `@ludory/core` validation; zero new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-studio-profiles-templates-design.md`

## Global Constraints

- Read-only preview by default; `--apply` exclusively creates files in an existing empty real directory.
- Existing canonical Core v1 manifest, `init`, `inspect`, `migrate`, and all mature-game files remain untouched.
- Catalog files are strict JSON, templates are static text/bytes, and local external catalogs cannot override built-ins.
- Only prevalidated relative paths, no symlink-following, no arbitrary code execution while listing or planning.
- Hosts SDKs, runtime parity, updater, and publication remain out of scope.

## Review Focus

1. External catalog paths with `..`, symlinks or reserved manifest names: reject without writes (Task 1 tests).
2. Invalid profile/template/engine/target combinations: reject before application (Task 2 tests).
3. Replacing a template file between preview and apply: refuse stale plan (Task 2 tests).
4. Mid-apply `EEXIST` or I/O failure: never modify preexisting content; roll back owned new files only (Task 2 tests).
5. Input with tabs, quotes, HTML delimiters or non-ASCII titles: JSON-only serialization; no injected executable text (Task 2 tests).

---

### Task 1: Catalog definitions, validation, discovery

**Files:**
- Create `packages/studio/src/catalog.mjs`
- Create `packages/studio/catalog/profiles/{web-game,narrative-game}.json`
- Create `packages/studio/catalog/templates/{web-basic,narrative-basic}/template.json`
- Create static demo template files under each built-in template directory
- Test `packages/studio/test/catalog.test.mjs`

**Interfaces:** `loadCatalog(catalogDir?) -> {profiles:Map, templates:Map}`, `listCatalog(kind,catalogDir?) -> publicSummary[]`, `showCatalog(kind,id,catalogDir?) -> publicDescriptor`. Template objects hold static content bytes and source hashes, never executable factories.

- [ ] Write tests for built-in listing/show, external additions, duplicate IDs, malformed descriptors, incompatible paths, symlinks, and deterministic hashes.
- [ ] Run `node --test packages/studio/test/catalog.test.mjs` — expected RED because catalog module is absent.
- [ ] Implement strict catalog loader and minimal static web/narrative template files.
- [ ] Run same command — expected PASS.

### Task 2: Reproducible scaffold plan and exclusive apply

**Files:**
- Create `packages/studio/src/scaffold.mjs`
- Modify `packages/studio/src/projects.mjs` only to expose safe directory identity helpers if required
- Test `packages/studio/test/scaffold.test.mjs`

**Interfaces:** `planCreate(projectDir,{id,title,lang,version,profile,template,targets,catalog}) -> plan` and `applyCreatePlan(plan) -> result`. Plan exposes `status`, `writes`, `manifest`, `conflicts`, `rootIdentity`, `fingerprint`; output includes canonical manifest plus `ludory.studio.json` receipt with file hashes.

- [ ] Write tests for preview no-write, successful scaffold and receipt, combinations blocked, empty-root enforcement, root race, source mutation, filename collision, rollback, and unicode/HTML title preservation.
- [ ] Run `node --test packages/studio/test/scaffold.test.mjs` — expected RED because scaffolder is absent.
- [ ] Implement pure planner and revalidating apply with exclusive writes and tracked-file rollback.
- [ ] Run same command — expected PASS.

### Task 3: CLI exposure, docs, compatibility gates

**Files:**
- Modify `packages/studio/src/cli.mjs`, `package.json`, `packages/studio/README.md`, `README.md`, `docs/ROADMAP.md`
- Test `packages/studio/test/cli.test.mjs`

**Interfaces:** New `profiles list/show`, `templates list/show`, and `create`, with `--json` and existing exit status contract; no existing CLI flags removed or reinterpreted.

- [ ] Write tests for commands, unknown/duplicate flags, `--apply` only with create, end-to-end created files, and regression for migrate/init.
- [ ] Run `node --test packages/studio/test/cli.test.mjs` — expected RED on new commands.
- [ ] Wire catalog/scaffolder into CLI, update help/check/docs.
- [ ] Run targeted test — expected PASS.
- [ ] Run `npm test`, `npm run check`, `node examples/core-session.mjs` — expected PASS.
- [ ] Independently inspect the diff for security/correctness and verify the GitHub PR CI on Node 22/24; no merge without user request.
