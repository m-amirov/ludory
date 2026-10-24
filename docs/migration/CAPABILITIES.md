# CEOS / Starter Kit capability inventory — baseline 2026-10-24

This is a **complete tracked-file closure** and a functional **migration ownership matrix**, not a declaration of behavioral parity. The machine-readable [source closure](source-closure.json) classifies **all 398 tracked blobs** at pinned commits, with no unassigned files. Every capability below is `NOT_MIGRATED` unless explicitly marked otherwise. Do not interpret folder ownership as authorization to copy upstream code.

Independent source cross-check (2026-10-24): compared every closure path/blob SHA with the recursive GitHub Git trees at the pinned commits: CEOS **219/219**, Starter Kit **179/179**, **0 missing, 0 extras, 0 SHA mismatches**. This establishes tracked-file completeness at those exact revisions only; the repository test also checks internal inventory consistency offline.

| Source | Pinned HEAD | Tracked blobs | Production/tooling group |
| --- | --- | ---: | --- |
| CEOS 0.5.40 | `c8cc13bd3852409be93097ee823e9cd35e512b73` | 219 | 45 `src/*.mjs`, 4 `bin`, 1 hook, 2 installers, 57 test files |
| Starter Kit 0.5.15 | `7595fefe4e125c37c57a830d9bce60deda083489` | 179 | 40 `tools` files, 17 `config`, 45 test files |

## Functional matrix

Statuses are migration statuses, **not** judgments that the original implementation is defective. `Mapped` means the future owner is assigned. `Core` primitives are new contracts, not a CEOS/Starter Kit port.

| ID | Existing capability, representative source paths | LUDORY owner | Migration contract / parity gate |
| --- | --- | --- | --- |
| C01 | CEOS global installation, skills, agent profiles: `scripts/install-global.ps1`, `src/ceos.mjs`, `agents/`, `skills/`, `global/` | AI | Reinstallable, non-junction global package; skill routing parity on Windows |
| C02 | CEOS project profiles and adoption: `profiles/`, `src/adoption.mjs` | Studio/AI | No overwrite of project-owned configuration; profile inference must block uncertainty |
| C03 | Git preflight, ancestry and worktree hygiene: `src/git-preflight.mjs`, `src/worktree-hygiene.mjs`, `src/run-relocation.mjs` | Studio | Dirty/diverged/remotes/worktrees preserved; no force sync or cleanup |
| C04 | CEOS manifest/doctor/gates/verification commands: `src/ceos.mjs`, `src/verification-process.mjs` | Release | Preserve gate IDs, risk classifications and command exit behavior |
| C05 | Source/evidence/verification replay contracts: `src/evidence-contract.mjs`, `src/verification-replay.mjs`, `src/source-fingerprint.mjs` | Release/AI | Old/stale/missing evidence must never become PASS |
| C06 | Runs, checkpoints and stage transitions: `src/execution-engine.mjs` | AI | Persisted run state and legal transitions match upstream fixture outcomes |
| C07 | `continue`, direct mode, project continuation: `src/continuation-controller.mjs`, `src/project-continuation.mjs`, `src/direct-workflow.mjs` | AI/Studio | Read-only inspect/claim/release separation and interrupt recovery |
| C08 | Recovery and relocation: `src/continuation-recovery.mjs`, `src/temporary-blocker-recovery.mjs`, `src/run-relocation.mjs` | AI | Preserve evidence hash and original run history; fail on stale parent/session |
| C09 | Capability broker and attestation: `src/capabilities.mjs`, `src/capability-attestation.mjs`, `src/capability-broker.mjs` | AI | No invented host tools, no stale nonce reuse, deny unknown authority |
| C10 | Web High transport, delegation, reviews: `src/web-delegation.mjs`, `src/dev-web-high-transport.mjs`, `src/web-high-review-packets.mjs` | AI | Source-bound receipts and visual-only assurance stay explicit |
| C11 | Native production routing and runtime context: `src/native-producer-routing.mjs`, `src/runtime-context.mjs`, `hooks/` | AI | Session-bound routing and lifecycle remain verifiable |
| C12 | Art candidate ledger, attempt/rework and impact: `src/art-candidate-ledger.mjs`, `src/art-rework-budget.mjs`, `src/art-change-impact.mjs` | AI | Append-only/hash-bound ledgers; no silent rework loop |
| C13 | Art PNG output/import/gates/progress: `src/art-output-gate.mjs`, `src/art-output-transport.mjs`, `src/art-progress.mjs` | AI/Release | Real file dimensions/hash/provenance, no receipt-only PASS |
| C14 | Narrative dual-format, source resolution and finalization: `src/narrative-dual-format-art.mjs`, `src/narrative-source-resolver.mjs`, `src/episode-art-finalization.mjs` | AI | Full episode coverage and scene/route integrity, not batch-level promotion |
| C15 | CEOS policies, failure memory, specialized agent/skill contracts: `policies/`, `skills/`, `docs/` | AI | Policy precedence and stop conditions preserved |
| S01 | Starter `new-project` init and seeds: `tools/starter-kit/init-project.mjs`, `config/targets/new-project.json` | Studio | Empty target only; seeds become project-owned |
| S02 | Mature project target-aware updates: `tools/starter-kit/update-engine.mjs`, `config/targets/mature-yandex-phaser.json` | Studio | Never overwrite `src`, `public`, game-spec, assets, saves or runtime |
| S03 | Manifest ownership classes and hashes: `tools/starter-kit/manifest.mjs`, `config/manifest-entries.json` | Studio | Six ownership classes, baseline hash and semantic conflict parity |
| S04 | `package.json` merge and skill-root mapping: `tools/starter-kit/package-merge.mjs`, `tools/starter-kit/profile.mjs` | Studio | Preserve package scripts/versions; no second active skill root |
| S05 | Source package build/status/self-test: `tools/starter-kit/package-kit.mjs`, `status.mjs`, `self-test.mjs` | Studio | Reproducible source install/update and drift receipts |
| S06 | Yandex requirements/doc snapshot/console audits: `tools/yandex/requirements-audit.mjs`, `docs-watch.mjs`, `config/yandex-*.yaml` | Release | Rules remain target-specific, verified against official current source |
| S07 | Yandex SDK and project contract validation: `tools/yandex/sdk-validation.mjs`, `project-contract-validation.mjs` | Connect/Release | No SDK drift; use target-specific build fixture |
| S08 | Yandex media, artifact and head-bound release gate: `tools/yandex/media-validation.mjs`, `release-evidence-gate.mjs` | Release | ZIP/hash/metadata, evidence from exact candidate HEAD |
| S09 | External Yandex live/draft observer: `tools/yandex/external-evidence.mjs`, `external-runtime-provider/` | Release | No implicit auth, observation from actual hosted game, isolated artifacts |
| S10 | Optional VK Games adapter/validator: `templates/platform/vk-bridge-adapter.mjs`, `tools/vk/vk-games-check.mjs` | Connect/Release | VK Games ≠ VK Play, separate builds, real VK lifecycle and evidence |
| S11 | Optional `narrative-game`/story-promise profile: `tools/narrative/`, `config/optional-profiles/narrative-game.json` | AI/Studio | No mandatory narrative requirements for non-narrative games |
| S12 | CG, scene and wardrobe visual contracts: `tools/production-art/`, `tools/visual/`, `templates/visual-review/` | AI/Release | Source-bound visual evidence, human review and viewport coverage |
| S13 | Skills precedence, project rules, quality guidance: `.codex/`, `docs/QUALITY_CONSTITUTION.md`, `config/skill-policy.json` | AI/Studio | Official platform rules cannot be downgraded by generic skills |
| S14 | Project updates/migrations/rollback: `migrations/`, `.starter-kit/`, `docs/STARTER_KIT_UPDATES.md` | Studio | Versioned, reversible, hash-checked and dry-run-first |

## Collision decisions

1. `game-spec.yaml`, CEOS `.codex-os/project.yml` and the new `ludory.project.json` **must coexist** during adoption. The Ludory manifest describes only common project identity/targets in the first Studio slice; legacy files remain source-owned and unchanged.
2. CEOS adoption and Starter updater are **not** replaced by an ad hoc copy. Studio starts with a metadata-only migration; implementation parity for their installers/updaters comes in separate, tested phases.
3. CEOS verification and Yandex/VK audits remain **independent gates** under Release, never flattened into one generic PASS.
4. Both `.agents/skills` and `.codex/skills` may already exist; Studio does not rewrite or register either during metadata migration.
5. Game engines, Phaser code, visual novels, binaries, audio, art and user saves are **project-owned**. Core and Studio may reference them but do not migrate or copy them at this phase.

## Migration readiness and verification boundary

- **Inventory completeness:** every source blob mapped in `source-closure.json`; the source SHAs are pinned and can be refreshed on a future audit.
- **Migration parity:** `0/29` upstream capability groups have been ported or independently accepted. Only the new Core foundation exists.
- **Studio phase 1:** strictly metadata-only `init`, read-only `inspect`, dry-run `migrate`, explicit safe `--apply`. No CEOS state, Starter ownership update, SDK, CI release or production game deployment.
- **Before retiring either old repository:** port tests/fixtures group by group, compare old/new behavior, run two mature-game pilots with actual assets/save data and rollback evidence, and obtain independent platform acceptance.
