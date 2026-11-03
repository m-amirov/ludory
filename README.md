# LUDORY

LUDORY is a modular toolkit for building and shipping browser games to Yandex Games, VK Games, and future platforms.

> **Status (2026-11-03, F6 follow-up):** the bounded new-game local workflow is implemented: Studio/Core/AI, Narrative/Runtime, Yandex and VK adapters, local candidate builds, LAN preview, portrait-first novels and opt-in moderation QA simulation. F5b1–F5b3 verified a **single newly authored narrative fixture** exported to two platform-specific ZIPs and exercised with mock SDKs in browsers. F6a–e records further local hardening and evidence. This is **not** full legacy-game adoption, real-platform certification or publication readiness. F6 identifies unresolved 1.0 freeze gates. Existing games remain frozen; historical CEOS runs are never imported.

## Modules

| Module | Responsibility | Stage |
| --- | --- | --- |
| Ludory Studio | New-game creation, trusted component updates, profiles, preview, narrative export and native CLI | Studio foundation + F1a + P1 + F5b1/F5b2 implemented |
| Ludory Core | Framework-independent game definition, state and lifecycle | Foundation complete |
| Ludory Economy | Opt-in pure wallet, deterministic grants, purchase digests and premium unlocks; no SDK/storage yet | E1 implemented; E2–E5 integrations pending, disabled by default ([API](packages/economy/README.md)) |
| Ludory AI | Source-bound native workflows, Codex execution, Web/ImageGen handoffs and quality gates | Bounded local contracts; actual external host capabilities separately gated |
| Ludory Runtime | Core host, Narrative/Phaser, browser lifecycle/input, saves/audio and portrait-first UI | R1–R7 + N1–N3 + P2 implemented |
| Ludory Connect | Isolated Yandex Games and VK Games SDK adapters and candidate builders | Yandex C1–C5 and VK V1–V5 implemented, mock-SDK evidence only |
| Ludory Release | Local ZIP validation, Yandex R1–R3, VK checks and P3a–P3d QA | Local checks/receipts and bounded QA; no official moderation or publication |

The authoritative phase status, deferred work and evidence boundaries are in [the consolidation roadmap](docs/ROADMAP.md). The [documentation audit](docs/audits/2026-11-02-documentation-audit.md) explains the 2026-11-02 reconciliation. The [F6 technical audit](docs/audits/2026-11-03-f6-technical-audit.md) records the remaining **1.0 freeze blockers**, including [F6e's deterministic dependency inventory, online root npm scan and asset-rights blockers](docs/audits/2026-11-03-f6e-security-license-assets.md); the [API/version policy](docs/API_VERSION_POLICY.md) defines the supported workspace interfaces and version gate. Start a new game with the [operator quickstart](docs/OPERATOR_QUICKSTART.md). Design decisions are preserved as historical snapshots in [the architecture spec](docs/superpowers/specs/2026-10-24-ludory-foundation-design.md).

## What is supported now

- **New Studio games only:** a trusted `narrative-interactive` project can be derived into distinct Yandex/VK local ZIP candidates from one pinned source (F5b1/F5b2). The [Studio export instructions](packages/studio/README.md#narrative-dual-target-local-candidates-f5b2-programmatic) show the programmatic API; this is **not** a general one-click importer or a public CLI export command.
- **Local testing:** browser mock-SDK checks exercise the paired story (F5b3), `ludory preview --lan` serves a fresh static build to devices on the same private network, and `qa simulate`/`qa capture`/`qa review`/`qa repair` separate deterministic checks from independently observed evidence. [Studio guide](packages/studio/README.md), [Release guide](packages/release/README.md).
- **Requirements changes:** the weekly/manual [Requirements Watch](docs/policy-watch/README.md) compares reviewed hashes of three official Yandex documents. Its first hosted run [#1](https://github.com/m-amirov/ludory/actions/runs/41493255297) completed `SUCCESS` with `CLEAR` and all three sources `UNCHANGED` on 2026-11-02. No rule-pack update is automatic; VK policy remains unverified.
- **Not claimed:** real SDK/device acceptance, platform moderation, rights clearance and publication are outside the current owner-approved local scope. `releaseReady:false` and `publicationAllowed:false` stay explicit. The old game repository is read-only until a separately approved adoption plan.

## Release R1 — local verification only

For a **new Studio-generated Yandex** candidate, save the JSON returned by `build-yandex-candidate.mjs`, the five-variant C5 browser smoke evidence and a SHA-bound declaration of shipped media. Then run:

```sh
node packages/studio/bin/ludory.mjs release check --archive /path/to/candidate.zip \
  --receipt /path/to/build-receipt.json --sdk-evidence /path/to/yandex-c5-contract.json \
  --rights /path/to/rights.json --json
```

`PASS_LOCAL` only verifies consistency of the **local** archive, receipt, fake-SDK browser evidence and rights declarations. It cannot attest copyright ownership, verified source signatures, live Yandex Draft, real advertising, physical devices or authorization to publish. `releaseReady` and `publicationAllowed` are always `false`. There is **no upload or publish command**. Format and examples: [Release R1 contract](packages/release/README.md).

Release R2 adds a **read-only local** handoff plan for optional future field testing of the same candidate ZIP:

```sh
node packages/studio/bin/ludory.mjs release plan --archive /path/to/candidate.zip \
  --receipt /path/to/build-receipt.json --sdk-evidence /path/to/yandex-c5-contract.json \
  --rights /path/to/rights.json --json
```

`READY_FOR_FIELD_TEST` means *local preflight is sufficient to start a separately authorized test*, not that Yandex, real browsers or physical devices passed. An optional `--field-evidence` JSON may list self-reported PASS/FAIL outcomes bound to this exact ZIP; positives remain `BLOCKED` until independently witnessed, negatives make the plan `FAIL`. This command performs no I/O beyond bounded local reads and never uploads or publishes. See [R2 contract](docs/superpowers/specs/2026-10-31-release-mvp-r2-design.md).
The pinned source baseline is listed in [the source inventory](docs/SOURCE_INVENTORY.md); a [29-group capability matrix](docs/migration/CAPABILITIES.md) and [398-file source closure](docs/migration/source-closure.json) record planned ownership without claiming feature parity.

## Start with Core

Requires Node.js 22+. No third-party runtime dependencies.

```sh
npm ci
npm test
npm run check
node examples/core-session.mjs
```

```js
import { defineGame, createGameSession } from '@ludory/core';

const definition = defineGame({
  schemaVersion: 1,
  id: 'my-game',
  version: '0.1.0',
  title: { ru: 'Моя игра', en: 'My Game' },
  engine: 'phaser',
  targets: ['yandex-games', 'vk-games'],
});

const game = createGameSession({ definition, initialState: { score: 0 } });
game.initialize();
game.start();
game.tick(16.67);
const snapshot = game.snapshot();
```

The Core is optional for existing games. It does **not** import platform SDKs or choose renderers. Platform services are supplied by the separate, implemented Runtime/Connect adapters.

## Runtime browser starter (new games only)

Studio includes an opt-in `runtime-basic` template. It bundles the Core/Runtime ESM code locally and starts a small playable DOM game with keyboard/pointer/touch input, pause/resume, manual save/reload/restore and optional audio. Inspect it with `node packages/studio/bin/ludory.mjs templates show --name runtime-basic`, then use the [full create/preview commands](packages/runtime/README.md#create-and-run-a-new-browser-game) in a **new, existing empty** directory. `--apply` creates files only after preview. Serve the created directory over HTTP (not `file://`); starting without a network connection is **not** a project acceptance requirement.

See [Runtime setup and API](packages/runtime/README.md), [independent Phaser adapter](packages/runtime-phaser/README.md) and [R7 acceptance evidence](docs/audits/2026-10-29-runtime-r7-acceptance.md). Browser emulation is not a physical-device check. Runtime can be paired with Connect adapters, but that does not constitute live Yandex/VK integration acceptance or Release approval.

## Ludory Studio: project metadata and safe scaffolding

The common manifest is `ludory.project.json`, validated by Core. It holds only identity, version, localized title, engine ID and target IDs; it does not replace platform configurations, CEOS run history or the legacy `game-spec.yaml`.

The existing `migrate`/`profiles apply` commands remain documented for compatibility, **not as instructions to change frozen games**. During current development, create isolated new Ludory test games only.

```sh
# Print commands; after npm install, use npm exec -- ludory ... if desired.
node packages/studio/bin/ludory.mjs help

# Inspect a mature game (read only).
node packages/studio/bin/ludory.mjs inspect --project /path/to/game --json

# Preview adoption from legacy Starter Kit game-spec.yaml schema 2 (read only).
node packages/studio/bin/ludory.mjs migrate --project /path/to/game --json

# New game metadata in an *existing, empty* directory: dry-run by default.
node packages/studio/bin/ludory.mjs init --project /path/to/empty --id my-game --title 'Моя игра' --lang ru --engine phaser --targets yandex-games,vk-games --json
```

For `init` and legacy `migrate`, `--apply` exclusively creates one file (`ludory.project.json`); neither command modifies existing game code, assets, saves, `AGENTS.md` or platform settings. **Do not run `migrate --apply` against frozen games.** Mature games require a separately authorized adoption decision, a committed clean Git worktree and unambiguous metadata; `BLOCKED` and `CONFLICT` require owner intervention. The host-trusted F1a managed-component mechanism exists for Studio-owned components; the older [PR #10](https://github.com/m-amirov/ludory/pull/10) remains a separate draft, not an adoption gate. See [Studio's first-slice contract](docs/superpowers/specs/2026-10-24-studio-foundation-design.md).

Studio also supports versioned profiles and templates for **new empty projects**:

```sh
node packages/studio/bin/ludory.mjs profiles list
node packages/studio/bin/ludory.mjs templates list
node packages/studio/bin/ludory.mjs create --project /path/to/empty-game --id my-game --title 'Моя игра' --lang ru --profile web-game --template web-basic --targets yandex-games,vk-games
# Review the preview before repeating with --apply.
```

The new `create` command exclusively generates a playable browser demo, the
Core-compatible manifest and a SHA-256 creation receipt. Its targets denote
intended platforms, **not** a production-ready VK/Yandex integration. The full
Starter Kit updater and CEOS automation are not imported; Ludory has its own
bounded workflows and strict, separately gated Release checks.
See [Studio's guide](packages/studio/README.md).

The experimental **Slice C** art workflow separates prompt authorship from image generation:
Web DEV prepares a source-bound brief when given sufficient narrative/style context;
otherwise the primary Codex model prepares it. `workflow image` prepares a
source-bound handoff to a **dedicated Codex image-generator subagent** (inheriting the
primary agent's model) which invokes the built-in `$imagegen` skill, without a separate API,
API key, model pin, network call or journal write. The skill currently exposes no model/
quality selector: request the highest available fidelity in the prompt and honestly
record the image provider's model as unknown. After the subagent saves the generated
PNG/JPEG/WebP, `workflow image-import --apply` validates and stores the original with
`USER_DECLARED` provenance for review, never automatically publishing or approving it.
See [Studio's built-in ImageGen instructions](packages/studio/README.md#codex-built-in-imagegen-originals-slice-c-experimental).

The experimental `workflow art-review` accepts an imported image original and
four checked scene/character/location/style references. An independent **GPT-6
Sol Instant (Web)** DEV session must actually receive the image with `low`
reasoning; Ludory refuses to
infer visual acceptance from text or from a configured model label. Explicit
`--apply` writes append-only hash-bound artistic receipts, with P0/P1 rework,
P2-only nonblocking notes, and an escalation after two serious rework reports.
`PASS_ART` is **visual model feedback**, never copyright, owner, runtime, VK,
Yandex or Release PASS. See [Web artistic review instructions](packages/studio/README.md#independent-web-art-review-experimental).

For an **owner-authorized, non-frozen Studio game** with a canonical manifest,
profile association and updates are read-only by default. These commands are
**not** instructions for legacy/frozen projects; `--apply` writes new profile
metadata under `.ludory/profiles/`:

```sh
node packages/studio/bin/ludory.mjs profiles apply --project /path/to/new-studio-game --name web-game
node packages/studio/bin/ludory.mjs profiles apply --project /path/to/new-studio-game --name web-game --apply
node packages/studio/bin/ludory.mjs profiles status --project /path/to/new-studio-game --json
node packages/studio/bin/ludory.mjs profiles update --project /path/to/new-studio-game
# Only after reviewing READY and confirming the project's authorization:
# repeat update with --apply.
```

Only new Ludory-owned `.ludory/profiles/` metadata is eligible for updates;
runtime files and CEOS/Starter Kit infrastructure remain outside Ludory's
ownership. Profile application does not activate game-engine functionality.

## Native Ludory AI workflows through Studio

The optional `narrative-game` profile can use a [StoryScope-inspired Codex narrative-review skill](.agents/skills/ludory-narrative-review/SKILL.md). For newly generated or imported `episode-script` drafts, Studio now requests a separate authenticated Web DEV review automatically after saving the draft. The reviewer checks canon, choices, routes and romantic arcs, stores evidence-bound `ACCEPT`/`REWORK`/`BLOCKED` results, and never declares release PASS or rewrites scenes automatically. Missing host leaves a pending review; interrupted review requires explicit stopped-helper recovery. See [Studio's narrative review workflow](packages/studio/README.md#automatic-narrative-review-storyscope-inspired).

Studio invokes its own `@ludory/ai` workflow engine **without installing or invoking CEOS**. Native runs are stored under `.ludory/ai/`. A valid `ludory.project.json` is required; Git is optional during development. **Manual workflow commands** leave game code, assets and saves untouched; the explicit `--executor codex --apply` mode may edit game files. Native history remains readable after ordinary source edits, commits or relocating the game; API-level append-only checkpoint receipts record hashes from the time of each action (not cryptographic authentication against a privileged writer).

**AI trust boundary:** game-project workflow/task mutations exposed through Studio or the high-level `@ludory/ai` APIs verify the independent Studio host registration before applying. Low-level `store.mjs` primitives (`planNewRun`, `commitNewRun`, `planNativeEvent`, `commitNativeEvent`) are privileged **internal** journal operations and are not exported by the package root. They validate source and journal consistency but do **not** themselves authenticate Studio origin; code with direct filesystem or source-module access is outside this package-level API boundary. `readNativeRun` and `listNativeRuns` remain public read-only diagnostics. Historical hash receipts establish integrity within their local journal, not an independently trusted author.

```sh
# Read-only inspection of native Ludory state.
node packages/studio/bin/ludory.mjs workflow doctor --project /path/to/game --json
node packages/studio/bin/ludory.mjs workflow status --project /path/to/game --run latest --json
node packages/studio/bin/ludory.mjs workflow next --project /path/to/game --run latest --json

# Preview a scoped native run; repeat with --apply after reviewing.
node packages/studio/bin/ludory.mjs workflow start --project /path/to/game \
  --pipeline audit-repair-loop --target 'EP3 QA' --in-scope 'src;tests' \
  --acceptance 'No blocking defects' --mutation-boundary 'Only scoped evidence' --json

# Manual mode: continue --apply records a request, without running an agent.
node packages/studio/bin/ludory.mjs workflow continue --project /path/to/game --run latest --json
# Opt-in Codex executor for a NEW game created by Studio: preview, then explicitly apply.
node packages/studio/bin/ludory.mjs workflow continue --project /path/to/new-game --run latest --executor codex --json
node packages/studio/bin/ludory.mjs workflow continue --project /path/to/new-game --run latest --executor codex --apply --json
node packages/studio/bin/ludory.mjs workflow cycle --project /path/to/new-game --run latest --test src/main.test.js --repairs 2 --json
node packages/studio/bin/ludory.mjs workflow cycle --project /path/to/new-game --run latest --test src/main.test.js --repairs 2 --apply --json
# If the parent process was interrupted after ACTION_REQUESTED, preview recovery first.
node packages/studio/bin/ludory.mjs workflow recover --project /path/to/new-game --run latest --json
node packages/studio/bin/ludory.mjs workflow recover --project /path/to/new-game --run latest --confirm-no-executor --apply --json
node packages/studio/bin/ludory.mjs workflow checkpoint --project /path/to/game \
  --run latest --stage EVIDENCE_COLLECTED --artifact 'reports/evidence.json' --outcome CONTINUE --json
```

`--apply` is mandatory for mutating `start`, `continue`, `recover` and `checkpoint`; `doctor`, `status` and `next` are read-only. By default, `continue --apply` records an **action request**, not an executed task. With `--executor codex`, it invokes the installed Codex CLI inside its `workspace-write` sandbox and stores only bounded execution metadata in the hash-chain ledger. The agent may modify files within the new game; `in-scope` is an instruction, **not a hard file allowlist**. A pending Codex request blocks checkpointing until its result is recorded. If the parent is interrupted, `recover` first previews an append-only failed result and requires `--confirm-no-executor`; it never assumes that missing output means completion. Codex completion yields `EXECUTED_UNVERIFIED`, never an independent quality or Release PASS. Direct Codex execution through Studio was verified on Windows/NTFS; descendant cleanup after forced parent termination remains unverified. When several runs are active, `status` lists their IDs; supply an explicit `--run`. No historic CEOS checkpoints are imported. See [Studio's workflow reference](packages/studio/README.md#native-workflows-through-the-unified-cli).

`workflow cycle` is opt-in and preview-only without `--apply`. It executes the current stage in a new Studio-created game, requests a sandboxed `node --test` command, and repeats on missing/failing test telemetry at most twice (`--repairs 0|1|2`). Each attempt is recorded by existing native request/result events. A passing test command is **observed through Codex JSONL**, not independently verified, so success remains `EXECUTED_UNVERIFIED` and an explicit evidence checkpoint is still required. No automatic stage advancement or Release PASS occurs. Real Windows Codex command telemetry is still to be checked; synthetic regression tests do not establish production readiness.

## Engineering Quality (project opt-in)

A new Studio-created game can explicitly opt into an [Uncle Bob-inspired Engineering Quality mode](.agents/skills/ludory-engineering-quality/SKILL.md). It is separate from Release verification. All `quality` commands preview without `--apply`; tests and deterministic Crapper/Dryer/Mutator tools run only through the Codex sandbox, with pinned executables and checksummed local reports.

```sh
node packages/studio/bin/ludory.mjs quality enable --project /path/to/new-game --apply --json
# Explicitly provision compatible Crapper/Dryer/Mutator tools and pin their absolute paths,
# SHA-256, versions and timeouts in .ludory/quality/policy.json before checking.
node packages/studio/bin/ludory.mjs quality check --project /path/to/new-game --tier quick --apply --json
node packages/studio/bin/ludory.mjs quality check --project /path/to/new-game --tier deep --apply --json
node packages/studio/bin/ludory.mjs quality status --project /path/to/new-game --json
node packages/studio/bin/ludory.mjs quality evidence --project /path/to/new-game --run latest --json
```

`quick` requires passing behavior tests, fresh LCOV coverage, Crapper (CRAP threshold `10`) and Dryer (similarity `0.80`); `deep` adds bounded Mutator. Tools must already be installed: no implicit dependency installs. Missing prerequisites give a named `BLOCKED` outcome. Evidence under `.ludory/quality/runs/` includes source/policy SHA-256, command metadata, checked report digests and bounded copies of coverage/metric artifacts. On an applied successful source-changing `workflow continue --executor codex` or `workflow cycle`, an enabled game receives one automatic `quick` check beside the original workflow result. The original native status remains `EXECUTED_UNVERIFIED`; neither Quality `PASS` nor successful Codex telemetry authorizes a release. Real Windows tool compatibility has not yet been verified.

## Frozen legacy repositories

- [Codex Engineering OS](https://github.com/m-amirov/codex-engineering-system) — read-only reference for useful orchestration and evidence behavior.
- [Yandex Games Starter Kit](https://github.com/m-amirov/starter-kit-yandex-games) — read-only reference for runtime, templates and platform validation.

Old games remain frozen until a **separate owner-approved** migration starts. Do not delete or overwrite the original repositories, import CEOS history, or run a legacy `migrate --apply` against them. `ludory adopt` is a **proposed future capability, not an implemented command**. For «Поцелуй на краю света», the recommended next step is a read-only source inventory followed by an independently created Studio project and an EP01–EP02 pilot; preserving save-state v4 and complete parity require explicit mapping and tests. See the [roadmap](docs/ROADMAP.md) and [owner's simplifying decision](docs/superpowers/specs/2026-10-24-native-dev-workflows-simplification-design.md).
