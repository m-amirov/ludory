# LUDORY foundation design

## Intent

Replace CEOS and Yandex Games Starter Kit over time with one coherent, extensible game-development product, initially supporting VK Games and Yandex Games. Start with a useful Core without jeopardizing current games or declaring unverified migration parity.

## Source findings

- `m-amirov/ludory` started as an empty repository on `main`.
- `m-amirov/codex-engineering-system` on its inspected `main` exposes version `0.5.40`, ESM Node 22+, persistent orchestration, skills, evidence and verification. Its reference decision favors no runtime dependencies.
- `m-amirov/starter-kit-yandex-games` on its inspected `main` exposes version `0.5.15`, source manifests, safe updater, Yandex validators and optional disabled-by-default VK Games adapter.
- Neither source ships a common reusable gameplay engine. Game runtime logic belongs to individual projects.

## Architectural approach

Chosen default: **modular monorepo with independently versionable packages**, plain ESM/Node 22 baseline and no runtime dependencies in Core. No single large code copy and no independent six-repository fleet. Future modules share versioned contracts, CLI and CI, but game renderer choice stays with each project.

Alternatives considered:

1. **Copy both repositories into LUDORY wholesale:** fastest initial migration, but duplicates conflicting manifests, upgrades, Codex instructions and release gates; rejected.
2. **Six separate repositories/packages:** strong physical isolation, but higher coordination and version drift; deferred until package release independence becomes necessary.
3. **Modular monorepo (chosen):** central integration and atomic interface changes while keeping unit boundaries and cross-platform SDK isolation.

## Initial Core contract

Core owns no host implementation. Its initial public API is:

1. `defineGame(input)`: validate a version-1 game definition (slug `id`, SemVer `version`, localized `title`, `engine`, at least one unique target ID). Return detached, frozen metadata.
2. `createStateStore(initialState)`: keep JSON-compatible root-object state, copy on read/write, strictly reject unsupported/cyclic/nonfinite values, increment monotonic revision and notify subscribers.
3. `createGameSession({definition, initialState, onUpdate})`: enforce legal lifecycle transitions and only tick while running. `onUpdate` is synchronous and gets a state-copy and `setState` API. `snapshot()` returns serializable `{schemaVersion,gameId,gameVersion,revision,state}`; `restore()` only allowed before gameplay starts, with matching schema/game/version, and leaves state unchanged on malformed input.

Identifiers `vk-games`, `yandex-games`, and future platforms are only strings here: no Core SDK imports or platform-specific branching. The game manifest is new and does not replace Starter Kit's existing `game-spec.yaml` until a tested translator exists.

## Out of scope

Rendering, sprites, DOM UI, asset production, SDK bridges, local/cloud persistence, multiplayer, deterministic physics, economy, authentication, monetization, release or migrations of project-owned games.

## Risks and acceptance

- Invalid definitions/state/snapshots reject with actionable errors and no partial mutation.
- Lifecycle transitions are legal and `tick` cannot execute while paused/stopped or with invalid delta.
- Returned definitions/state/snapshots cannot mutate internal state by reference.
- No network, SDK or browser requirements for the Core test suite.
- An example shows initializing, running, pausing and restoring the exact game state.
- First phase is labeled experimental. Release of the full LUDORY ecosystem requires subsequent phases and independent platform evidence.
