# @ludory/core — experimental v0.1

Small platform-neutral foundation; works in Node 22+ and modern browsers. No dependencies, IO, storage, DOM or SDK usage.

## API

- `defineGame({schemaVersion, id, version, title, engine, targets})`: validate and freeze game metadata. `targets` are identifiers, not SDK imports.
- `createStateStore(initialState)`: own and snapshot JSON-compatible object state; replacement increments revision, observers can unsubscribe. Returned state is a copy.
- `createGameSession({definition, initialState, onUpdate})`: explicit lifecycle `idle → ready → running ↔ paused → stopped`, with synchronous `tick(deltaMs)` and version-bound `snapshot()/restore()`.

`onUpdate` must finish synchronously; its provided `setState` callback is valid only during that tick. For unrelated UI events, use `session.setState()` explicitly. State observers receive immutable-by-copy revision events in commit order even when a subscriber causes a nested update. If a subscriber throws, all subscribers still receive their events and the originating write throws `AggregateError` **after committing the state**; consumers must not blindly retry that write.

When the revision reaches `Number.MAX_SAFE_INTEGER`, another write is rejected without changing state. Snapshots require exactly the documented own data fields: malformed or cross-game snapshots are never treated as saves.

Session transitions and storage are independent of Phaser, rendering and platform services. Runtime will eventually supply host clock, persistence, audio and input. Connect will supply platform APIs.

**Important:** This is a new opt-in contract; it does not yet read existing `game-spec.yaml`, install on existing projects, or promise backward compatibility across prerelease versions.
