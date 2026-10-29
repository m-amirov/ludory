# LUDORY consolidation roadmap

## Guiding rules

- One monorepo and one product CLI, but independently testable packages. Do not combine unrelated systems into one enormous module.
- One authoritative configuration per new project. Existing games are frozen; no old CEOS history or project migration is planned during Ludory development.
- Keep game code, SDK adapters, AI orchestration and release certification separate.
- Existing games, especially mature Phaser and visual-novel projects, remain **frozen and project-owned**. No development, automatic overwrites, CEOS checkpoint import or host testing in them.
- Development checks must tolerate a dirty or unversioned working tree and normal source edits. Keep strict hash/host compliance evidence for Release only; never recreate nested CEOS session or worktree binding.
- Adopt capability flags and target-specific outputs. VK Games and Yandex Games builds, SDKs, save payloads and publication gates must remain independent.
- No platform acceptance without observed evidence, actual device/browser checks and the required platform-specific gates.

## Phases and release gates

| Phase | Delivery | Required acceptance |
| --- | --- | --- |
| **0. Inventory (complete)** | Source/capability inventory and CEOS/Starter Kit ownership map | 398 tracked files and 29 capability groups mapped; parity is not claimed |
| **1. Core foundation (complete)** | `@ludory/core`: validated definition, state snapshot, lifecycle, tests, basic example | Current Node tests, syntax checks and example are green; Core remains platform-neutral |
| **2. Studio foundation (partially complete)** | Unified `ludory` CLI, manifests, templates, profiles and new-project scaffold | New Studio game creation/inspect/doctor verified; managed component updater from PR #10 is not in `main` |
| **3. AI controlled workflows (partially complete)** | Native run/event store, Codex executor, bounded cycle, routing, Web/ImageGen handoffs, narrative/art/Quality gates | Bounded new-game Codex E2E passed; a historical PR #13 run completed Native ImageGen → Web Art Review with `PASS_ART`, but fresh Web route and external Quality tools were unavailable in the 2026-10-28 audit environment |
| **4. Control acceptance (parallel gate)** | Repeatable fresh-game E2E for Studio/Core/AI with source-bound receipts and explicit blocked outcomes | Keep Web DEV/StoryScope, ImageGen/art and Quality as `BLOCKED` for the current environment until retested; do not confuse historical PASS with fresh evidence, and do not block independent Runtime R1 on host availability |
| **5. Runtime MVP (in progress; R1–R3 in main, R4 in review)** | Engine-neutral host, Core session binding, bounded variable tick, normalized input, manual save/restore, responsive desktop/mobile, audio, independent Phaser adapter | R1–R3 contracts/host/input/viewport are merged; R4 explicit persistence, browser storage/environment and basic audio are isolated changes pending acceptance. R5 Phaser, R6 browser/mobile and R7 acceptance remain pending per [specification](superpowers/specs/2026-10-28-runtime-mvp-design.md) and [plan](superpowers/plans/2026-10-28-runtime-mvp.md) |
| **6. Connect Yandex** | Independent Yandex adapter, capability detection, platform entrypoint and isolated build | SDK contract tests plus real Yandex runtime observation; never infer from Runtime-only tests |
| **7. Release MVP** | Build/release validation, compliance, artifact/signature checks and owner-authorized publication workflow | Independent Yandex evidence and release gates; no publish without owner authorization |
| **8. Connect VK** | Independent VK Games adapter, capability detection and isolated VK build | VK-specific SDK/build/runtime evidence; do not reuse Yandex PASS |
| **9. Studio updates and optional fresh adoption (later)** | Review PR #10 managed updates; optional owner-selected attachment of an old game without CEOS history import | Explicit consent, read-only preview, frozen old source intact, rollback; no adoption while games are frozen |

The 2026-10-28 foundation baseline is in [the foundation audit](audits/2026-10-28-foundation-acceptance.md). R1–R3 are in `main`; the audit predates them. R4 adds a candidate manual persistence/audio slice without modifying Core. Node/fake browser adapter tests do not prove real browser/mobile operation, platform SDK compatibility, Runtime MVP or Release PASS.

## Source mapping

| Existing component | Destination | Notes |
| --- | --- | --- |
| CEOS `src/execution-engine.mjs`, continuation, capabilities | Ludory AI | Preserve checkpoint and evidence semantics; do not import into Core |
| CEOS skills, profiles, orchestration CLI | AI + Studio | Deduplicate task coordination without changing project ownership |
| CEOS verification/evidence contracts | AI + Release | Independent PASS/BLOCKED/FAIL status and source-bound attestations |
| Starter Kit project init, ownership-aware updater, manifests | Studio | Keep semantic merges and mature-project protections |
| Starter Kit Yandex audits, SDK validator, evidence gates | Connect Yandex + Release | Keep authoritative rules versioned and target-specific |
| Starter Kit optional VK adapter and validation | Connect VK + Release | VK Games ≠ VK Play; keep VK and Yandex builds independent |
| Starter Kit narrative-game profile and visual acceptance | Studio profiles + AI + Release | Optional; do not impose narrative conventions on all games |
| Project-owned Phaser, VN UI, artwork and assets | Runtime adapters / individual game repositories | Do not vendor entire games into Core |

## Major risks and mitigations

1. **Useful parity, not bureaucracy:** reproduce proven game-development behavior in new Ludory-owned test games, but never import old CEOS sessions or require nested parent/capability/worktree identity for daily development.
2. **Legacy configuration:** treat `game-spec.yaml` and CEOS profiles as read-only historical references; do not force a translator into frozen games.
3. **Platform leakage:** forbid VK/Yandex imports in `@ludory/core`; injection only from Connect and Runtime.
4. **Existing project corruption:** frozen games receive no writes; any future voluntary adoption requires separate authorization, preview and ownership checks.
5. **Premature release claims:** tests/builds do not replace live platform and human QA; retain independent gates and evidence.

## Current technical-debt decisions

- PR #5 (CEOS adapter) is obsolete relative to the native workflow and the frozen-CEOS boundary; owner action is still required to close/archive it.
- PR #11 (routing preflight) is functionally superseded by merged PR #12 and the code is present in current `main`; owner action is still required to close/archive the duplicate draft.
- PR #10 (managed component updates) remains an independent open draft and is not silently treated as merged or required for Runtime MVP.
- Web Helper v2 source rebuild is not byte-reproducibility-verified; vendored artifact integrity and live browser capability remain separate gates.

## Not included in Phase 1

No CEOS code migration, UI editor, universal game renderer, platform SDK, authentication, monetization, deployment, publishing or official compliance certification.
