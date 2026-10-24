# LUDORY

LUDORY is a modular toolkit for building and shipping browser games to Yandex Games, VK Games, and future platforms.

> **Status:** foundation in progress. `@ludory/core` is the first independently tested module. This repository does not yet replace CEOS or Starter Kit, nor does it certify any platform release.

## Modules

| Module | Responsibility | Stage |
| --- | --- | --- |
| Ludory Studio | Projects, templates, development workflows and project updates | Planned |
| Ludory Core | Framework-independent game definition, state and lifecycle | Foundation |
| Ludory AI | CEOS orchestration, agents, workflows and evidence | Planned migration |
| Ludory Runtime | Host UI, browser lifecycle, input, persistence, sound | Planned |
| Ludory Connect | Optional SDK adapters for Yandex Games, VK Games and others | Planned |
| Ludory Release | Validation, builds, evidence and distribution gates | Planned migration |

The module map and migration stages are described in [the consolidation roadmap](docs/ROADMAP.md). Design decisions and compatibility limits are documented in [the architecture spec](docs/superpowers/specs/2026-10-24-ludory-foundation-design.md).
The pinned source baseline is listed in [the source inventory](docs/SOURCE_INVENTORY.md).

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

## Source-of-truth repositories during migration

- [Codex Engineering OS](https://github.com/m-amirov/codex-engineering-system) — orchestration and agent/evidence logic until migrated.
- [Yandex Games Starter Kit](https://github.com/m-amirov/starter-kit-yandex-games) — templates, ownership-aware updater and platform validation until migrated.

Do not delete, rename or deprecate the original repositories until compatibility, migrations and release gates have been proven independently.
