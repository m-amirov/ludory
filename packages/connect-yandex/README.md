# @ludory/connect-yandex

Independent Yandex Games SDK adapter for **new** LUDORY games. C1 provides
loading, initialization, availability detection and bounded errors. C2 adds a
standalone Runtime lifecycle bridge. C3 provides opt-in Player cloud storage.
Ads, a Yandex build and live platform acceptance remain separate C4–C5 stages.

## C1 usage

```js
import { createYandexConnector } from '@ludory/connect-yandex';

const connector = createYandexConnector({ timeoutMs: 10_000 });
try {
  const { sdk, capabilities } = await connector.initialize();
  // Continue new-game setup; handle each optional feature explicitly.
} catch (error) {
  // Inspect error.code: SDK_UNAVAILABLE, SDK_LOAD_FAILED, SDK_INIT_FAILED,
  // SDK_TIMEOUT. Do not report a platform success when initialization fails.
} finally {
  await connector.destroy();
}
```

The default loader appends `<script src="/sdk.js">` in the browser only when
`YaGames.init` is not already available. This relative path is for ZIP archives
hosted by Yandex Games; own-domain deployments may explicitly supply an absolute
HTTPS `scriptUrl` via `loadYandexSdkScript`. Never download or bundle `sdk.js`.
Use `sdkLoader` injection for automated tests. Importing the package does not
read the DOM or call the SDK. `destroy()` cancels an in-flight initialization,
and another `initialize()` after failure/destroy requires a new instance.

Capabilities (`loading`, `gameplay`, `player`, `fullscreenAds`, `rewardedAds`)
are shallow method-availability checks, **not** proof of successful platform
operations. The returned `connection` and capability snapshot are immutable;
the actual `sdk` object remains owned by Yandex. Timeouts cover the script and
SDK `init()` stage. Loader/network/initialization errors remain visible with
stable codes and original causes where provided.

## C2 lifecycle bridge

Use `createYandexLifecycle({ sdk, host, audio?, canResume?, windowObject?, documentObject? })`
only with the initialized SDK and an existing `@ludory/runtime` host.

1. `lifecycle.attach()` before game start (preferably before `host.initialize()`).
2. `await host.initialize()` and load all game resources; then explicitly call
   `await lifecycle.markReady()` and check it returned `true` before treating
   Yandex loading tagging as complete.
3. Start the Runtime host. Yandex `GameplayAPI.start/stop` markers follow actual
   `host.getStatus()`, never a guessed game intent.
4. On menu/manual pause set `lifecycle.setManualPaused(true)` **before**
   `host.pause()`. Clear the flag only when your game allows resume; clearing
   alone never calls `host.resume()`. Call `lifecycle.detach()` on teardown.

The bridge listens to `sdk.on('game_api_pause'/'game_api_resume')`, then uses
`host.pause()` / `host.resume()`; Runtime stops/resumes input, frame scheduling
and its audio adapter. Pass optional `audio` only if it is not already owned by
the host or its `pauseAll/resumeAll` methods are idempotent. The bridge also
observes `pagehide/pageshow({ persisted: true })` and document visibility,
keeping independent pause reasons so an SDK resume cannot override a hidden
tab. Teardown removes listeners and invalidates old event callbacks.

Manual ownership is explicit: a separate direct `host.pause()` while the host
is already platform-paused is not observable via Runtime status, so menu logic
**must** call `setManualPaused(true)`. A `canResume` callback may return `false`
to forbid resume and must be synchronous (do not return a Promise). Browser
autoplay restrictions and user mute remain managed by Runtime audio.

SDK markers are optional, observable integration operations, not Release proof.
`getLastError()` preserves `CAPABILITY_UNAVAILABLE`/`LIFECYCLE_FAILED` diagnostics.

## C3 Player cloud storage

```js
import { createYandexPlayerStorage } from '@ludory/connect-yandex';

// Use after the connector has initialized. The namespace must identify your game.
const storage = createYandexPlayerStorage({
  namespace: 'my-game',
  getPlayer: () => sdk.getPlayer(),
});
// Pass storage explicitly to createRuntimeHost({ ..., storage, saveKey: 'my-game:manual' }).
// host.save() and host.restore() remain explicit actions, never automatic.
```

`RuntimeStorage.load/save/clear` use only `ludory:<game-slug>:v1:<save-key>`;
`clear` writes a `null` tombstone without changing other SDK keys. `save` passes
the whole validated Runtime V1 SHA-256 envelope to `player.setData` with
`flush: true` and awaits SDK completion. `getPlayer` is called lazily; a
successful Player is cached for the adapter lifetime, whereas failed acquisition
can be retried by a later explicit action. Writes and reads are ordered.

The SDK allows about 200 KB **total** Player data across every key; this
adapter conservatively preflights its own keyed JSON UTF-8 record. Other game data can still
exhaust the quota. Player permission/guest restrictions, network and rate-limit
failures are exposed as `PLAYER_UNAVAILABLE`, `CLOUD_SAVE_FAILED`,
`CLOUD_LOAD_FAILED` or `CLOUD_CLEAR_FAILED` with causes. There is **no** silent
localStorage fallback or cloud/local conflict resolution, no automatic player
authorization request, and no use of profile identifiers. A game may explicitly
offer a separate local-storage policy in its entrypoint, outside this adapter.

Namespace format: lowercase game slug, maximum 64 characters. Save keys: safe
ASCII letters, digits, dash, underscore, dot and colon, maximum 128 characters.
SDK fake tests verify the contract, **not** real cloud availability in Yandex.
If a Player SDK Promise never settles, later queued storage operations also
remain pending. The adapter does not pretend to cancel an outstanding remote
write or declare a late/unknown write successful; games should surface a
pending-operation state and let users retry after a confirmed failure.

## Acceptance boundaries

- `node --test packages/connect-yandex/test/*.test.mjs` validates fake SDK/DOM
  contracts, including cancellation, timeout and double-init races.
- C2 lifecycle tests use a fake SDK with the real Runtime host. A dedicated
  Playwright smoke uses Chromium, Firefox, Android Chromium emulation and iPhone
  WebKit emulation; it is a **browser SDK contract test**, not a physical-device
  or hosted-Yandex test.
- Physical devices, live cloud storage, ads and a live Yandex draft are separate
  gates. Fake-SDK tests never imply `YANDEX_LIVE_PASS`.
- No CEOS/Starter Kit migration and no modification of existing game projects.

Official documentation: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about.html
Lifecycle documentation: https://yandex.ru/dev/games/doc/ru/sdk/sdk-game-events
and https://yandex.ru/dev/games/doc/ru/sdk/sdk-events (checked 2026-10-29).
Player data documentation: https://yandex.ru/dev/games/doc/ru/sdk/sdk-player
(checked 2026-10-31).
