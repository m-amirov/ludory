# Narrative N3 Studio Template Implementation Plan

**Architecture selected:** Full graph-owning Narrative Engine (owner confirmed 2026-10-29). **Execution gate:** N1 and N2 must be verified before N3.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full graph-driven interactive novel available in an opt-in, fully offline Studio-created playable sample without affecting existing templates or projects.

**Architecture:** Add a new `narrative-interactive` static template in Studio's built-in catalog, bundle N1/N2 dependencies into its local assets, and extend existing preview/apply/versioned receipts. Retain old `narrative-basic` untouched.

**Tech Stack:** Node.js >=22 ESM, existing esbuild dev dependency and Studio catalog/scaffold, `node:test` and browser smoke.

**Spec:** `docs/superpowers/specs/2026-10-29-narrative-interactions-design.md`.

## Global Constraints

- N1 and N2 PRs must be accepted at pinned versions; generated games remain SDK-neutral until separately certified.
- Template only for new empty projects; preview has zero mutations; apply retains hash/path/symlink safeguards.
- Local assets, no CDN or external server, no `narrative-basic` breaking changes, no frozen-game adoption.
- RU/EN authored sample demonstrates canonical branching scenes, route lock, all three mechanics, delayed echoes, endings, memories, replay/save and relationship feedback.

## Review Focus

1. Studio preview on a nonempty target must not write/replace existing files — Task 1.
2. Template's local bundle must match source and contain no cross-host URL dependencies — Task 2.
3. Template update/version change must not rewrite existing game-owned source — Task 1.
4. Asset/image reference missing from package must fail author validation before creation — Task 2.
5. Generated project must run from static HTTP, replay and survive reload on portrait/wide — Task 3.

---

### Task 1: New profile-compatible catalog template

**Files:** Add `packages/studio/catalog/templates/narrative-interactive/template.json`, `index.html`, `src/main.js`, `src/story.json` (or JS-authored catalog) and assets; modify `packages/studio/catalog/profiles/narrative-game.json` and `packages/studio/test/catalog.test.mjs`.

- [ ] RED tests: `templates list/show` advertises new template without changing `narrative-basic`, wrong profile fails, profile version updates, preview remains read-only, `--apply` refuses occupied target.
- [ ] Implement minimal catalog/template inclusion and safe profile metadata; require GREEN.
- [ ] Commit as `feat(studio): register opt-in interactive-novel template`.

### Task 2: Source-bound offline bundle and integrity

**Files:** Extend `scripts/build-runtime-template.mjs` or add focused `scripts/build-narrative-template.mjs`; create `packages/studio/test/narrative-template.test.mjs`, adjust root scripts and template assets.

- [ ] RED tests for reproducible byte/hash output, missing assets, unresolved imports, forbidden external URLs, no hardcoded game-specific names in module code.
- [ ] Build pinned source-only bundle of N1 full scene engine/N2/Core/Runtime with existing esbuild; include all sample assets locally.
- [ ] Require targeted GREEN, check versioned template declaration and emitted SHA-bound create receipt.
- [ ] Commit as `feat(studio): bundle offline narrative runtime`.

### Task 3: End-to-end created game, quality and handoff

**Files:** Add end-to-end Studio fixture/test and `docs/evidence/2026-10-29-narrative-n3-acceptance.md`, update relevant README/ROADMAP.

- [ ] Test actual `create --profile narrative-game --template narrative-interactive` preview/apply in an empty temporary project; serve generated game and exercise scene branching, route lock, photo/keepsake/composer/echo, ending, journal, save/reload, RU/EN, portrait/wide.
- [ ] Run `npm test`, `npm run check`, `node examples/core-session.mjs`, browser smoke; capture exact artifacts, source HEAD and blockers.
- [ ] Independent PR review for compatibility, protected ownership, asset rights and test quality; fix any Critical/Important findings.
- [ ] Publish N3 PR, merge only with required CI/review and owner approval; never claim VK/Yandex release PASS.
