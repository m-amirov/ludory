# LUDORY consolidation roadmap

> Current audited implementation snapshot: **2026-11-03**, `main` commit `a2e12b5` (PR #71). Historical specs, plans and dated acceptance reports document the state **when written**; this page and the root README are the current navigation/status entrypoints. A merged implementation and a passing mock-SDK test never establish real-platform approval.

## Guiding rules

- One monorepo and one product CLI, but independently testable packages. Do not combine unrelated systems into one enormous module.
- One authoritative configuration per new Studio project. Existing games remain frozen until an individual, explicit owner-approved migration. No old CEOS history import.
- Keep game code, SDK adapters, AI orchestration and release certification separate.
- Existing games, especially mature Phaser and visual-novel projects, remain **frozen and project-owned**. No direct migration/write/test in them without a separate scoped consent, read-only inventory and rollback plan.
- Development checks must tolerate a dirty or unversioned working tree and normal source edits. Keep strict hash/host compliance evidence for Release only; never recreate nested CEOS session or worktree binding.
- Adopt capability flags and target-specific outputs. VK Games and Yandex Games builds, SDKs, save payloads and publication gates must remain independent.
- The current owner's scope includes local browser/mock-SDK acceptance and simulated moderation QA; **real marketplace acceptance, real-device testing, official moderation and publication are not required** for the present Ludory milestone. If any are requested later, they require distinct observed evidence and authorization.
- Offline **startup** is not a project requirement. Deterministic no-server narrative interactions and safe local saves remain separate product features.

## Phases and release gates

| Phase | Delivery | Required acceptance |
| --- | --- | --- |
| **0. Inventory (complete)** | Source/capability inventory and CEOS/Starter Kit ownership map | 398 tracked files and 29 capability groups mapped; parity is not claimed |
| **1. Core foundation (complete)** | `@ludory/core`: validated definition, state snapshot, lifecycle, tests, basic example | Current Node tests, syntax checks and example are green; Core remains platform-neutral |
| **2. Studio foundation + F1a (implemented)** | Unified CLI, manifest, templates, profiles, trusted Studio-owned component updates and source-origin guard | [PR #46](https://github.com/m-amirov/ludory/pull/46) merged host-trusted component management. Legacy [PR #10](https://github.com/m-amirov/ludory/pull/10) is a separate open draft, **not** evidence that F1a is missing; no silent rewrites of frozen games |
| **3. Native AI + Quality (bounded implementation)** | Native receipts, Codex executor/cycle, Web DEV routing, ImageGen/art/narrative review and Engineering Quality | Local and historical acceptance are recorded; a configured `chatgpt-web/gpt-6-sol-instant` (`low`) is not proof of observed Web selection. Text-only v2 helper support and live external-host receipts remain explicitly gated. See [AI acceptance](audits/2026-10-30-f1-ai-acceptance.md) |
| **4. Narrative + Runtime (implemented)** | N1–N3 narrative engine/browser renderer, photo/keepsake/message interactions, R1–R7 Core host/Phaser, audio, Back/save/reload, responsive and portrait-first mobile | R7 [PR #38](https://github.com/m-amirov/ludory/pull/38), portrait [PR #61](https://github.com/m-amirov/ludory/pull/61); browser checks are emulated, not device or marketplace PASS. See [N3](evidence/2026-10-29-narrative-n3-acceptance.md) and [R7](audits/2026-10-29-runtime-r7-acceptance.md) |
| **5. Connect Yandex + Release R1–R3 (implemented locally)** | C1–C5 Yandex SDK, saves/ads, independent ZIP; read-only SHA-bound Release validation and optional R2/R3 field-test planning/observations | C5 [PR #51](https://github.com/m-amirov/ludory/pull/51), R1 [#52](https://github.com/m-amirov/ludory/pull/52), R2 [#53](https://github.com/m-amirov/ludory/pull/53), R3 [#54](https://github.com/m-amirov/ludory/pull/54) merged. `PASS_LOCAL`/`READY_FOR_FIELD_TEST` cannot certify production. [Release contract](../packages/release/README.md) |
| **6. Connect VK V1–V5 (implemented locally)** | Separate VK Bridge, storage, ads, runtime, candidate ZIP and `vk-check` | PRs [#55](https://github.com/m-amirov/ludory/pull/55), [#56](https://github.com/m-amirov/ludory/pull/56), [#57](https://github.com/m-amirov/ludory/pull/57), [#58](https://github.com/m-amirov/ludory/pull/58), [#59](https://github.com/m-amirov/ludory/pull/59) merged in order. Fixture-browser/VK contract checks are not real VK SDK or moderation evidence. [VK guide](../packages/connect-vk/README.md) |
| **7. Pre-F5 P1–P3d (implemented with explicit limits)** | Fresh local/LAN preview P1; novel portrait P2; moderation simulation P3a, Playwright candidate capture P3b, bounded Web visual-review handoff P3c and two-round scoped repair P3d | PRs [#60](https://github.com/m-amirov/ludory/pull/60), [#61](https://github.com/m-amirov/ludory/pull/61), [#62](https://github.com/m-amirov/ludory/pull/62), [#63](https://github.com/m-amirov/ludory/pull/63), [#64](https://github.com/m-amirov/ludory/pull/64), [#65](https://github.com/m-amirov/ludory/pull/65) merged. Browser capture is local evidence; P3c/P3d require actual attested host actions to claim review, and never grant platform approval. [Studio QA](../packages/studio/README.md#pre-moderation-qa-simulation-p3a) |
| **8. F5b1–F5b3 (local mock-SDK acceptance complete)** | One trusted new `narrative-interactive` source pinned, exported to **both** Yandex/VK ZIP candidates and tested as the same story in browsers | [PR #67](https://github.com/m-amirov/ludory/pull/67), [#68](https://github.com/m-amirov/ludory/pull/68), [#69](https://github.com/m-amirov/ludory/pull/69) merged. 22 browser scenarios are reported for the paired fixture; no live platform, rights or publication PASS. Draft [#66](https://github.com/m-amirov/ludory/pull/66) is not the gate for this merged implementation |
| **9. Requirements Watch (operational)** | Weekly/manual diff detection for three official Yandex Markdown sources, reviewed hash baseline and advisory GitHub issue | [PR #70](https://github.com/m-amirov/ludory/pull/70) merged; first hosted [run #1](https://github.com/m-amirov/ludory/actions/runs/41493255297) `SUCCESS/CLEAR`, three `UNCHANGED`. No automatic rule acceptance. [Watch guide](policy-watch/README.md) |
| **10. F6 technical audit (recorded; 1.0 freeze BLOCKED)** | README/roadmap reconciliation [2026-11-02](audits/2026-11-02-documentation-audit.md); [F6 technical audit and evidence index](audits/2026-11-03-f6-technical-audit.md) and [operator quickstart](OPERATOR_QUICKSTART.md) document code/API, dependencies/licensing, reproducible target builds and Draft triage | P1 Yandex ad timeout, installed Web Helper notices and unverified prebuilt provenance require remediation or explicit risk decision; F1 real-host/F5 unified acceptance gaps, contract/version policy, comprehensive advisories/SBOM, exact release-HEAD CI and owner sign-off remain. **No `v1.0.0` tag.** A later «Поцелуй на краю света» EP01–EP02 pilot needs distinct owner authorization and does not imply legacy parity |

The older [source inventory](SOURCE_INVENTORY.md), earlier F1 acceptance and dated specs are **historical** and must not be read as the current phase matrix. The merged F1c origin-trust guard restricts **high-level Studio/Codex/Web AI mutation workflows** to independently host-registered Studio-created games; directly exported low-level AI Store receipt mutators do not uniformly enforce this guard (see [F6 finding](audits/2026-11-03-f6-technical-audit.md)). Runtime/browser acceptance is emulated. Local Release candidates explicitly prohibit readiness/publication (`releaseReady:false`, `publicationAllowed:false`); official moderation is `NOT_RUN` where the relevant VK/QA schema carries that field. Yandex R1/R2 instead report the applicable live-platform, rights and owner gates as `NOT_RUN`; they do not expose a universal moderation field. Owner-approved out-of-scope live checks would require a separate plan.

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
2. **Legacy configuration:** treat `game-spec.yaml`, historical CEOS profiles and schema-v4 saves as read-only references; do not force a translator into frozen games. A new Studio project is a separate destination, not a mutation of the original.
3. **Platform leakage:** forbid VK/Yandex imports in `@ludory/core`; injection only from Connect and Runtime.
4. **Existing project corruption:** frozen games receive no writes; any future voluntary adoption requires separate authorization, preview and ownership checks.
5. **Premature release claims:** tests/builds do not replace live platform and human QA. Live platform checks are outside the **current** owner-approved task, not silently marked PASS or removed from a hypothetical future publication gate.

## Current technical-debt decisions

- PR #5 (CEOS adapter) is obsolete relative to the native workflow and the frozen-CEOS boundary; owner action is still required to close/archive it.
- PR #11 (routing preflight) is functionally superseded by merged PR #12 and the code is present in current `main`; owner action is still required to close/archive the duplicate draft.
- PR #10 (managed component updates) remains an independent open draft and is not silently treated as merged or required for Runtime MVP.
- PR #66 (earlier F5a disposable E2E) is still Draft. It is not proof of a successful paired-source narrative ZIP; the later F5b1–F5b3 #67–#69 path supplies that narrower acceptance. Close or archive #66 only after owner review of any unique unmerged work.
- Web Helper v2 source rebuild is not byte-reproducibility-verified; vendored artifact integrity and live browser capability remain separate gates.
- A direct legacy-game adoption flow and old save-state compatibility are **not implemented**. For the proposed «Поцелуй на краю света» pilot, obtain separate authorization before creating a destination or reading any non-public project materials; preserve the source repository.

## Not claimed by this milestone

No CEOS history migration, one-click mature-game importer, universal editor, hosted deployment/publishing, verified third-party rights, official moderation or real Yandex/VK acceptance. Platform SDK **adapters** and local candidate builders are implemented; that fact is not a live platform certification. No requirement to start the game without network connectivity.
