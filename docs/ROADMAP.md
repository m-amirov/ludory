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
| **0. Inventory (structural closure complete)** | Pin source SHAs, map CEOS/Starter Kit ownership, enumerate features and conflicts | 398 tracked files and 29 capability groups mapped; runtime parity not yet verified |
| **1. Core foundation (now)** | `@ludory/core`: validated definition, state snapshot, lifecycle, tests, basic example | Node tests and syntax checks green; no SDK/DOM/storage coupling |
| **2. Studio (profiles/templates in progress)** | Unified `ludory` CLI, manifest, safe metadata adoption and versioned profiles/templates for new projects; later ownership-aware updater | Preview/manifest creation and new-project scaffold covered by tests; mature-project update/rollback parity still pending |
| 3. Runtime | Engine-agnostic host contract and optional Phaser integration, lifecycle, persistence, responsive UI, audio | Desktop/mobile behavior, persistence round trip, zero regressions in existing games |
| 4. Connect | `@ludory/connect-yandex`, `@ludory/connect-vk`, feature/capability detection and per-platform entrypoints | SDK integration tests; isolated builds; real platform runtime observations |
| 5. AI (native foundation in progress) | Portable native run/event store and CLI, then actual agent execution with one clear next action | Native tests without installed CEOS; dirty development/relocation supported, no false Release PASS |
| 6. Release | Consolidate updater/build validation, compliance, artifact/signature checks and publication workflows | Independent Yandex and VK gates, real uploaded builds, publish requires owner authorization |
| 7. Optional fresh adoption (later) | Owner-selected attachment of an old game to a new Ludory run, **without importing CEOS history** | Explicit consent, read-only preview, frozen old source intact, rollback; no adoption while games are frozen |

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

## Not included in Phase 1

No CEOS code migration, UI editor, universal game renderer, platform SDK, authentication, monetization, deployment, publishing or official compliance certification.
