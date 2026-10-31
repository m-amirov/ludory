# Connect VK F3/V2 — lifecycle and storage contracts

**Scope:** separate VK Games / VK Mini Apps connector continuation after merged V1. No VK Play API, SDK import into Core or Yandex, game migration, upload, moderation or publication.

## VK Bridge surface

- VK app view events arrive via `bridge.subscribe(event)` and `event.detail.type` as `VKWebAppViewHide` / `VKWebAppViewRestore`.
- Cloud storage: `VKWebAppStorageGet({keys:[key]})` → `{keys:[{key,value}]}`, `VKWebAppStorageSet({key,value})` → `{result:true}`; empty stored value denotes absent data.
- VK Storage has a 4096-byte string-value limit. V2 uses a conservative 3800 UTF-8-byte cap and one atomic key. Oversized saves explicitly fail: no fragmentation, no silent loss, no local fallback.
- Official API references: https://github.com/VKCOM/vk-bridge/blob/master/packages/core/README.md ; https://github.com/VKCOM/vk-mini-apps-api/blob/master/src/index.ts

## Contract: lifecycle

`createVkLifecycle({bridge, host, audio?, canResume?, windowObject?, documentObject?})` is import-safe in Node, subscribes only after explicit `attach()`, and detaches every owned listener. Each hide reason (VK view, pagehide, document visibility) is independent. The adapter pauses only a RUNNING Runtime; resume occurs only for an adapter-owned pause, after all reasons clear, and is withheld for manual pause or `canResume=false`. Manual resume control must call `setManualPaused`. No ads or games are started automatically. Asynchronous resume guards and bridge errors are observable as `LIFECYCLE_FAILED`.

## Contract: Runtime storage

`createVkStorage({bridge, namespace})` exposes async `load(key)`, `save(key, persistedRecord)`, `clear(key)`. Keys are strictly scoped and safe for VK Bridge; validation occurs before SDK writes. Persistence reuses `@ludory/runtime/contracts` `validatePersistedRecordShape`. Writes and clears require an explicit `{result:true}` response. Corrupt JSON is `STORAGE_CORRUPT`. Operations are queued, so concurrent operations cannot overtake an earlier save/clear. Caller uses Runtime hash/identity verification on loaded envelopes; V2 does not claim cloud integrity solely from JSON parsing.

Runtime integration uses the game's slug as `namespace` and its `saveKey` (e.g. `game-id:manual` or `game-id/manual`) directly. The VK adapter encodes UTF-16 key units into an injective ASCII representation, doubling literal underscores and using `_XXXX` for other unsafe characters, with a strict 100-character output bound. This avoids silently rejecting valid Runtime namespace separators or colliding with literal underscore sequences. Test against an actual Runtime host save/restore round trip, not only a storage stub.

## Acceptance and limits

- 14 V2 contract tests: lost SDK, malformed responses, UTF-8 quota/truncation, malformed save, save/read/clear concurrency, independent pause reasons, manual pause, refusal to resume, subscription cleanup.
- Existing 9 V1 tests, full `npm test`, `npm run check`, Windows/Linux Node 22/24 CI and browser R6 regression on the final SHA.
- No actual VK Bridge session, VK console, mobile device, account, ad inventory or Release PASS has been tested.
- V3 adds VK ad adapter and negative reward tests. V4 adds a separate VK target entrypoint, package and desktop/mobile browser smoke. `FRAMEWORK_CODE_READY` for VK is **not** achieved by V2 alone.

## Independent review hardening
The lifecycle now subscribes to Runtime status changes and re-enforces active pause reasons on newly RUNNING hosts. A synchronous detach during Runtime pause cannot reacquire ownership due to generation checks, and a rejected async `canResume` is explicitly observed. VK keys include an unambiguous namespace length prefix to prevent cross-game collisions. These changes have additional regression tests; no existing user save migration is required because V2 has never been merged.

## Second review hardening
Before invoking synchronous `canResume`, the lifecycle snapshots its attachment generation. After the guard returns, it checks generation, `attached`, outstanding pause reasons, manual pause, pause ownership and current host status **before** calling `host.resume()`. Two regressions cover a guard detaching and a guard introducing a new VK hide reason. Missing platform/device evidence remains NOT_RUN.
