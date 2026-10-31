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
| **5. Runtime MVP (R1–R7 merged)** | Engine-neutral host, Core session binding, bounded variable tick, normalized input, manual save/restore, responsive desktop/mobile, audio, independent Phaser adapter | R7 merged as [PR #38](https://github.com/m-amirov/ludory/pull/38). Runtime browser emulation passed; physical devices, SDK/Connect and Release are separately gated. See [R6 evidence](audits/2026-10-29-runtime-r6-acceptance.md) and [R7 acceptance](audits/2026-10-29-runtime-r7-acceptance.md) |
| **6. Connect Yandex (C1–C5 merged; live testing pending)** | Independent Yandex adapter, capability detection, saves, ads, entrypoint and isolated build | [PR #51](https://github.com/m-amirov/ludory/pull/51) merged C5 local SDK-contract/browser candidate. The recorded five-browser results were obtained against a fixture SDK; real Yandex Draft, authenticated Player, live ad inventory and physical phones remain NOT_RUN. See [C5 acceptance](audits/2026-10-31-connect-yandex-c5-acceptance.md). No platform PASS from fake-SDK tests |
| **7. Release MVP (R1 merged; R2 candidate)** | R1: read-only, SHA-bound C5 ZIP/receipt/local mock-SDK/rights consistency. R2: read-only real Yandex field-test plan and bounded self-report reconciliation | R1 merged as [PR #52](https://github.com/m-amirov/ludory/pull/52). `release check` returns at most `PASS_LOCAL`; R2 `release plan` returns at most `READY_FOR_FIELD_TEST`. Neither means live-platform acceptance. Real Draft/browser/device observations, independently validated rights and owner-authorized upload/publication remain NOT_RUN. See [R2 spec](superpowers/specs/2026-10-31-release-mvp-r2-design.md) |
| **8. Connect VK** | Independent VK Games adapter, capability detection and isolated VK build | VK-specific SDK/build/runtime evidence; do not reuse Yandex PASS |
| **9. Studio updates and optional fresh adoption (later)** | Review PR #10 managed updates; optional owner-selected attachment of an old game without CEOS history import | Explicit consent, read-only preview, frozen old source intact, rollback; no adoption while games are frozen |

The 2026-10-28 foundation baseline is in [the foundation audit](audits/2026-10-28-foundation-acceptance.md). Runtime R1–R7, Connect Yandex C1–C5, and Release R1 are in `main`; the foundation audit predates them. Runtime/browser acceptance remains emulated, not a physical-device gate. Release R1/R2 cannot make platform or rights claims from locally supplied JSON.

F1c is a separate candidate for the AI origin-trust boundary: native AI mutations are restricted to independently host-registered Studio-created games. Existing games remain read-only; modified source files and absence of Git do not revoke a genuine Studio creation pin. Local contract acceptance is documented in the [F1 AI acceptance addendum](audits/2026-10-30-f1-ai-acceptance.md); exact-HEAD CI and owner-authorized merge are separate gates.

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
