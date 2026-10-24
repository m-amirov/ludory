# LUDORY

LUDORY is a modular toolkit for building and shipping browser games to Yandex Games, VK Games, and future platforms.

> **Status:** foundation in progress. `@ludory/core` is independently tested; `@ludory/studio` supports safe metadata adoption and new-game templates. This repository does not yet replace CEOS or Starter Kit, nor does it certify any platform release.

## Modules

| Module | Responsibility | Stage |
| --- | --- | --- |
| Ludory Studio | Projects, profiles, templates, development workflows and project updates | Metadata adoption + new-game scaffolding |
| Ludory Core | Framework-independent game definition, state and lifecycle | Foundation |
| Ludory AI | CEOS orchestration, agents, workflows and evidence | Planned migration |
| Ludory Runtime | Host UI, browser lifecycle, input, persistence, sound | Planned |
| Ludory Connect | Optional SDK adapters for Yandex Games, VK Games and others | Planned |
| Ludory Release | Validation, builds, evidence and distribution gates | Planned migration |

The module map and migration stages are described in [the consolidation roadmap](docs/ROADMAP.md). Design decisions and compatibility limits are documented in [the architecture spec](docs/superpowers/specs/2026-10-24-ludory-foundation-design.md).
The pinned source baseline is listed in [the source inventory](docs/SOURCE_INVENTORY.md); a [29-group capability matrix](docs/migration/CAPABILITIES.md) and [398-file source closure](docs/migration/source-closure.json) record planned ownership without claiming feature parity.

## Start with Core

Requires Node.js 22+. No third-party runtime dependencies.

```sh
npm install --offline
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

The Core is optional for existing games. It does **not** import platform SDKs or choose renderers. Platform services are added through separate Runtime/Connect adapters in later stages.

## Ludory Studio: project metadata and safe scaffolding

The common manifest is `ludory.project.json`, validated by Core. It holds only identity, version, localized title, engine ID and target IDs; it does not replace platform configurations, CEOS run history or the legacy `game-spec.yaml`.

```sh
# Print commands; after npm install, use npm exec -- ludory ... if desired.
node packages/studio/bin/ludory.mjs help

# Inspect a mature game (read only).
node packages/studio/bin/ludory.mjs inspect --project /path/to/game --json

# Preview adoption from legacy Starter Kit game-spec.yaml schema 2 (read only).
node packages/studio/bin/ludory.mjs migrate --project /path/to/game --json

# Explicit, metadata-only adoption once status is READY and Git is clean.
node packages/studio/bin/ludory.mjs migrate --project /path/to/game --apply --json

# New game metadata in an *existing, empty* directory: dry-run by default.
node packages/studio/bin/ludory.mjs init --project /path/to/empty --id my-game --title 'Моя игра' --lang ru --engine phaser --targets yandex-games,vk-games --json
```

For `init` and `migrate`, `--apply` exclusively creates one file (`ludory.project.json`); neither command modifies existing game code, assets, saves, `AGENTS.md` or platform settings. Mature games require a committed, clean Git worktree and unambiguous metadata. `BLOCKED` and `CONFLICT` require owner intervention. Read [Studio's first-slice contract](docs/superpowers/specs/2026-10-24-studio-foundation-design.md) for limitations; the ownership-aware updater and CEOS orchestration have not been ported yet.

Studio also supports versioned profiles and templates for **new empty projects**:

```sh
node packages/studio/bin/ludory.mjs profiles list
node packages/studio/bin/ludory.mjs templates list
node packages/studio/bin/ludory.mjs create --project /path/to/empty-game --id my-game --title 'Моя игра' --lang ru --profile web-game --template web-basic --targets yandex-games,vk-games
# Review the preview before repeating with --apply.
```

The new `create` command exclusively generates a playable browser demo, the
Core-compatible manifest and a SHA-256 creation receipt. Its targets denote
intended platforms, **not** a production-ready VK/Yandex integration. The
Starter Kit updater, CEOS orchestration and host release gates remain unmigrated.
See [Studio's guide](packages/studio/README.md).

## Source-of-truth repositories during migration

- [Codex Engineering OS](https://github.com/m-amirov/codex-engineering-system) — orchestration and agent/evidence logic until migrated.
- [Yandex Games Starter Kit](https://github.com/m-amirov/starter-kit-yandex-games) — templates, ownership-aware updater and platform validation until migrated.

Do not delete, rename or deprecate the original repositories until compatibility, migrations and release gates have been proven independently.
