# Ludory Skills Gap Audit — 2026-10-28

## Scope and evidence

Read-only comparison of repository-owned Codex skill entrypoints (files named `SKILL.md`) at exact Git commits. The audit does **not** install skills, copy code, modify old games, run external services or assert execution parity.

| Repository | Pinned Git commit | First-party skills observed |
| --- | --- | ---: |
| [CEOS](https://github.com/m-amirov/codex-engineering-system) | `c8cc13bd3852409be93097ee823e9cd35e512b73` (0.5.40) | 15 under `skills/` |
| [Starter Kit](https://github.com/m-amirov/starter-kit-yandex-games) | `7595fefe4e125c37c57a830d9bce60deda083489` (0.5.15) | 15 under `.codex/skills/` |
| [Ludory](https://github.com/m-amirov/ludory) | `3382691ea60ec854eddfa49ab7bc4049a7cb847e` (`main`) | 2 under `.agents/skills/` |

The three recursive Git trees were inspected with `truncated=false`; all **30 upstream entrypoints** and both Ludory entrypoints were read at the pinned commits. The source inventories in [SOURCE_INVENTORY](../SOURCE_INVENTORY.md) and [CAPABILITIES](../migration/CAPABILITIES.md) classify code capabilities, **not** skill implementation parity. Vendored Playwright `SKILL.md` files under `packages/ai/vendor/.../node_modules` are third-party assets and are excluded from Ludory first-party skill counts.

Observed Ludory skills:

- [`ludory-engineering-quality`](../../.agents/skills/ludory-engineering-quality/SKILL.md): opt-in test-first development and quick/deep quality evidence for new Studio games. The external Crapper/Dryer/Mutator requirement is not satisfied by the existence of this text file; the current acceptance audit reported those integrations blocked.
- [`ludory-narrative-review`](../../.agents/skills/ludory-narrative-review/SKILL.md): source-bound narrative review; actual independent Web DEV review depends on a verified authorized route. The current audit reported this route blocked.

The native Studio/AI workflow already implements *some* behavior from prior skills (Codex executor, bounded cycle, narrative-review request, image handoff). A native workflow result of `EXECUTED_UNVERIFIED`, a manual ImageGen handoff, or a skill file alone is **not** proof of finished QA, actual pixels, platform readiness or release authorization.

## Disposition legend

- **CREATE**: a new Ludory-owned skill is warranted, with actionable triggers, inputs, fail-closed gates and independently checkable evidence.
- **MERGE**: preserve distinct safeguards in an existing/new skill or native workflow; do not make a second overlapping entrypoint.
- **NATIVE**: the relevant responsibility belongs in Ludory Studio/AI/Runtime/Connect/Release code and tests; a legacy orchestration skill should not be copied.
- **DEFER**: useful for later optional genres, devices or Release, after its implementation prerequisites exist.
- **REFERENCE**: retain the old instructions read-only as engineering history, with no default Ludory installation.

## CEOS — all 15 skill entrypoints

| Upstream skill (`skills/<name>/SKILL.md`) | Disposition | Proposed Ludory owner / acceptance boundary |
| --- | --- | --- |
| `audit` | CREATE / P0 | `ludory-audit`: inspect in read-only mode; findings cite source, tests and evidence gaps. |
| `audit-repair-loop` | MERGE / P0 | `ludory-fix` + native AI bounded cycle; preserve scope lock, independent verification and explicit `EXECUTED_UNVERIFIED` until proven. |
| `ceos-continue` | NATIVE | Existing Studio/AI `workflow continue` semantics, without CEOS sessions, `.codex-os` or legacy checkpoints. |
| `fix` | CREATE / P0 | `ludory-fix`: reproduce → root cause → RED/GREEN regression → scoped check → handoff. |
| `incident-analysis` | DEFER / P1 | `ludory-incident-analysis`: timeline, source-bound logs and correlation, distinguish fault from secondary fallout. |
| `narrative-continuity-engine` | DEFER / optional narrative | `ludory-narrative-continuity`: authored graph versus real reachable runtime paths; never infer full route coverage from a manuscript. |
| `narrative-dialogue-editor` | DEFER / optional narrative | `ludory-narrative-editor`: speaker voice, localization, route conditions and exact excerpt evidence without changing author canon. |
| `prod-check` | DEFER / Release | Read-only live-platform inspection, distinct from deployment or moderation submission; no implied authorization. |
| `production-art` | CREATE / P0 | `ludory-production-art`: source-bound briefs, real ImageGen original, import receipt, separate visual assessment; no CEOS capability challenge. |
| `reader-experience-review` | DEFER / optional narrative | `ludory-reader-experience`: bounded blind first-read assessment independent of continuity checks. |
| `release` | MERGE / Release | `ludory-release-audit`: versioned target gates, frozen candidate identity; never infer release PASS from local tests. |
| `romance-narrative` | DEFER / optional narrative | `ludory-romance-narrative`: consented genre profile; not a universal requirement for all games. |
| `verification` | CREATE / P0 | `ludory-verification`: criterion→test→artifact matrix and scoped `PASS`/`FAIL`/`BLOCKED`. |
| `video-production` | DEFER / Release/media | `ludory-video-production`: original gameplay evidence must remain separate from promotional edits; verify exported bytes. |
| `visual-qa` | CREATE / P0 | `ludory-visual-qa`: real current-runtime pixels, dimensions, viewport/state/HEAD and independent image-received evidence. |

## Starter Kit — all 15 skill entrypoints

| Upstream skill (`.codex/skills/<name>/SKILL.md`) | Disposition | Proposed Ludory owner / acceptance boundary |
| --- | --- | --- |
| `asset-provenance-and-rights` | CREATE / P0 | `ludory-asset-rights`: source, licence, SHA-256, transformations and approval ledger; art quality does not prove rights. |
| `codex-engineering-system` | REFERENCE | Do not reinstall CEOS globally or recreate its hooks/skill root; Ludory remains standalone. |
| `game-accessibility` | DEFER / Runtime | `ludory-game-accessibility`: touch/keyboard/focus/contrast/reduced motion/locale checks based on actual runtime. |
| `game-audio-quality` | DEFER / Runtime | `ludory-game-audio`: browser unlock, pause/resume, ads integration later via Connect, no duplicate playback. |
| `game-feel-polish` | DEFER / Runtime | `ludory-game-feel`: measured action→feedback, animation, reduced motion and mobile performance. |
| `game-performance-budget` | DEFER / Runtime | `ludory-performance`: project-declared budgets and measured production-build evidence, no invented thresholds. |
| `implementation-cycle` | MERGE / P0 | Existing `ludory-engineering-quality` + `ludory-fix`; no duplicate mandatory entrypoint or blanket visual gate for nonvisual edits. |
| `level-design-quality` | DEFER / optional genre | `ludory-level-design`: solver/runtime semantics, reproducible seeds, solvability and difficulty evidence. |
| `mobile-game-ux` | DEFER / Runtime | `ludory-mobile-ux`: real touch, safe areas, scroll, orientation and actual visual pixels on supported viewports. |
| `product-quality-review` | DEFER / post vertical slice | `ludory-product-review`: first minute, core loop, clarity, progression and actual player scenarios; no design-doc-only PASS. |
| `project-termination` | REFERENCE | A separate owner decision to stop/archive a **new** project would be required; frozen games are not targets. |
| `release-audit` | MERGE / Release | `ludory-release-audit`, with independent Yandex and VK gates, source/ZIP identity and real platform evidence. |
| `visual-quality-gate` | MERGE / P0 | `ludory-visual-qa` + `ludory-production-art`; screenshot visual gate requires actual screenshots, not DOM/filename assertions. |
| `web-game-playtest` | DEFER / Runtime | `ludory-web-playtest`: cold/throttled load, focus/pause/resume, transitions, browser error/asset/leak evidence. |
| `yandex-release-validation` | DEFER / Connect+Release | `ludory-release-yandex`: live authoritative Yandex rules, current package evidence and owner-controlled submission. |

`ludory-release-vk` is a **new, separately scoped capability** implied by Starter Kit's optional VK adapter and Ludory's Connect/Release plan; there is no dedicated upstream VK `SKILL.md` in this pinned 30-skill sample. VK Games and VK Play must not be conflated.

## Findings

1. **Coverage gap is real:** 30 pinned upstream skill entrypoints versus 2 current first-party Ludory entrypoints. This is an inventory count, **not** a target count: many upstream skills are intentionally merged, deferred or replaced with tested native code.
2. **P0 engineering gap:** `audit`, `verification` and `fix` need dedicated Ludory-facing Codex recipes with independent outcomes, even though AI already has a bounded execution mechanism.
3. **P0 visual/provenance gap:** image-generation handoff is insufficient without current-runtime pixel acceptance, asset source/rights tracking and actual independent review evidence.
4. **P1 Runtime dependency:** mobile, audio, accessibility, browser playtests and performance require a working Runtime and realistic browser/device fixtures before claiming behavioral coverage.
5. **Release dependency:** Yandex and VK skill wrappers cannot declare platform readiness while Connect/Release are absent.
6. **Legacy traps:** copying CEOS `ceos context`, capability challenge, session/worktree binding, global hooks or `.codex-os` would violate Ludory's approved independence and frozen-game constraints.

## Decision and next gate

Adopt [the separate Skills & Failure Prevention roadmap](../skills/ROADMAP.md) **in parallel with** Runtime R1. No source skill is approved for unmodified copying. The first skill implementation PR is an isolated, non-release change and must not alter Core, frozen games, Yandex/VK SDKs, or the ongoing Runtime contract branch. No feature parity is claimed by this audit.
