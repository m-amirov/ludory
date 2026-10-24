# LUDORY consolidation roadmap

## Guiding rules

- One monorepo and one product CLI, but independently testable packages. Do not combine unrelated systems into one enormous module.
- One authoritative configuration per new project; introduce a migration layer for `game-spec.yaml` and CEOS manifests instead of silently changing their meaning.
- Keep game code, SDK adapters, AI orchestration and release certification separate.
- Existing games, especially mature Phaser and visual-novel projects, remain **project-owned**. No silent overwrites.
- Adopt capability flags and target-specific outputs. VK Games and Yandex Games builds, SDKs, save payloads and publication gates must remain independent.
- No platform acceptance without observed evidence, actual device/browser checks and the required platform-specific gates.

## Phases and release gates

| Phase | Delivery | Required acceptance |
| --- | --- | --- |
| **0. Inventory (structural closure complete)** | Pin source SHAs, map CEOS/Starter Kit ownership, enumerate features and conflicts | 398 tracked files and 29 capability groups mapped; runtime parity not yet verified |
| **1. Core foundation (now)** | `@ludory/core`: validated definition, state snapshot, lifecycle, tests, basic example | Node tests and syntax checks green; no SDK/DOM/storage coupling |
| **2. Studio (profiles/templates in progress)** | Unified `ludory` CLI, manifest, safe metadata adoption and versioned profiles/templates for new projects; later ownership-aware updater | Preview/manifest creation and new-project scaffold covered by tests; mature-project update/rollback parity still pending |
| 3. Runtime | Engine-agnostic host contract and optional Phaser integration, lifecycle, persistence, responsive UI, audio | Desktop/mobile behavior, persistence round trip, zero regressions in existing games |
| 4. Connect | `@ludory/connect-yandex`, `@ludory/connect-vk`, feature/capability detection and per-platform entrypoints | SDK integration tests; isolated builds; real platform runtime observations |
| 5. AI (native foundation in progress) | Native run/event store and CLI first, then complete state/evidence/agents/skills/capability/art parity without CEOS executable | Native tests without installed CEOS; imported-run and full CEOS parity still pending, no false PASS |
| 6. Release | Consolidate updater/build validation, compliance, artifact/signature checks and publication workflows | Independent Yandex and VK gates, real uploaded builds, publish requires owner authorization |
| 7. Migration | One-time CEOS history/checkpoint import and resumable state, side-by-side project pilots, then legacy sunset | Two production game pilots, verified old-run replay, no lost state/assets/rights/evidence, documented rollback |

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

1. **Behavioral parity:** snapshot-source commit hashes and run contract tests before migration; compare old and new on shared fixtures.
2. **Conflict between `game-spec.yaml` and CEOS profiles:** define a single versioned future project manifest with explicit translators and fail-closed conflicts.
3. **Platform leakage:** forbid VK/Yandex imports in `@ludory/core`; injection only from Connect and Runtime.
4. **Existing project corruption:** initially read-only migration preview; no automatic overwrite of owned assets or `AGENTS.md`.
5. **Premature release claims:** tests/builds do not replace live platform and human QA; retain independent gates and evidence.

## Not included in Phase 1

No CEOS code migration, UI editor, universal game renderer, platform SDK, authentication, monetization, deployment, publishing or official compliance certification.
