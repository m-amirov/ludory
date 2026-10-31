# @ludory/connect-yandex

Independent Yandex Games SDK adapter for **new** LUDORY games. C1 provides
loading, initialization, availability detection and bounded errors. C2 adds a
standalone Runtime lifecycle bridge. C3 provides opt-in Player cloud storage.
C4 adds explicit fullscreen and rewarded ads. A Yandex build and live platform
acceptance remain separate C5 stages. C5 now provides a generated-game browser
contract candidate; it does not provide live Yandex or production Release proof.

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

## C4 advertising (explicit opt-in)

```js
import { createYandexAds, createYandexLifecycle } from '@ludory/connect-yandex';

// After `connector.initialize()` and with an existing Runtime host:
const lifecycle = createYandexLifecycle({ sdk, host });
lifecycle.attach();
const ads = createYandexAds({ sdk, host, lifecycle });

// Call only from a game-authorized placement/interaction, never from a render loop.
try {
  await ads.showFullscreen(); // resolves { shown: true } after onOpen and onClose(true)
} catch (error) {
  // Handle CAPABILITY_UNAVAILABLE, ADS_NOT_SHOWN or ADS_FAILED visibly.
}

try {
  const result = await ads.showRewarded();
  if (result.rewarded) {
    // Grant the reward exactly once for THIS completed attempt.
  }
} catch (error) {
  // No reward on failure or a completed no-show.
}

// At game teardown: ads.destroy(); lifecycle.detach();
```

SDK methods are called only by explicit `showFullscreen()` / `showRewarded()`.
The adapter pauses Runtime on `onOpen`, and releases only its own pause reason
on terminal SDK callbacks or `destroy()`. Manual menu pause must still call
`lifecycle.setManualPaused(true)`; an ad's close never overrides the menu flag,
SDK pause, hidden page or `canResume()` veto. Only one ad attempt can be active
per adapter. Concurrent or destroyed calls reject with `ADS_FAILED`.

`onClose(wasShown: false)` rejects with `ADS_NOT_SHOWN`; `onError`, invalid
ordering, and detached lifecycle reject with `ADS_FAILED`. `onClose(true)`
requires an observed `onOpen`; `showRewarded()` returns `{ shown: true,
rewarded: false }` unless **that same attempt** observed `onRewarded` after
`onOpen` and before a shown close. Duplicate/late callbacks cannot grant extra
rewards. Only the game may actually grant/persist the reward after checking
`result.rewarded`, with its own idempotency and persistence policy.
Each ad attempt is bound to one lifecycle attachment; events from a previous
`detach()`/`attach()` cycle cannot credit a reward or pause the new session.

The owner must choose compliant ad placements, privacy/consent behavior and
game-specific cooldowns. Yandex controls fullscreen frequency; a method
returning (even a fulfilled Promise) does not prove the ad was displayed.
The adapter deliberately does not invent a timeout or retry if the SDK leaves
callbacks pending. The game must present a pending state and allow explicit
teardown rather than silently treating a pending attempt as a no-show.
Fake-SDK tests show only `SDK_CONTRACT_PASS`, **not** live ad inventory,
consent compliance, Yandex approval or Release PASS.

## Acceptance boundaries

### C5: create and inspect a new Yandex-only browser candidate

Run from the Ludory repository root, with Node >=22 and `npm ci --ignore-scripts`:

```sh
npm run check:yandex-template
node packages/studio/bin/ludory.mjs create --project /tmp/ludory-c5-demo --id ludory-c5-demo --title "C5 demo" --lang en --profile web-game --template yandex-runtime --targets yandex-games --apply
node scripts/build-yandex-candidate.mjs --project /tmp/ludory-c5-demo --output /tmp/ludory-c5-demo.zip
```

`create` requires an **empty** target directory and creates a separate new-game
receipt. `build-yandex-candidate` requires a **new output path outside** the
project directory and refuses overwrites. The packager checks the independent
host-bound Studio origin registry and original manifest/component receipts;
copied directories or reconstructed self-signed JSON are not valid provenance.
Recreate a project through Studio on this machine if host trust is unavailable;
do not edit host registry files. A pinned HTML5 parser validates actual
executable script nodes; commented tags, raw-text lookalikes, inert types and
duplicates cannot stand in for a hosted SDK tag. The archive is deterministic and
contains the game HTML, JS entry, local Ludory Runtime/Connect bundle,
manifest and approved media; it does **not** contain Yandex `sdk.js`, test
fixtures or author/Studio work files. Its CLI prints file hashes and ZIP SHA-256.
This is a **non-release candidate**, not a verified production/rights package.

The generated `index.html` loads one blocking `<script src="/sdk.js">` in
`<head>` before the game module. This endpoint is supplied by Yandex hosting.
Opening the HTML directly as a `file://` URL, or serving it on a plain static
server without `/sdk.js`, is expected to display an initialization error. For
local preview use an explicitly configured SDK proxy matching Yandex's
official local-debug procedure, or run the browser contract tests below; do
not place a copied `sdk.js` inside the game archive or hide initialization
errors with a synthetic fallback.

```sh
cd packages/runtime/test/browser
npm ci --ignore-scripts
npx playwright install --with-deps chromium firefox webkit
LUDORY_C5_ARTIFACT_DIR=artifacts npm run smoke:yandex-c5
cd ../../../..
cd packages/runtime-phaser/test/browser
npm ci --ignore-scripts
npm run smoke:yandex-c5
```

The Runtime browser test creates a new Studio game, packs and extracts the
actual candidate ZIP, then serves it with a **test-only** `/sdk.js`. It checks
Chromium, Firefox, WebKit, emulated Android and emulated iPhone. It exercises
real Runtime/Connect initialization, touch, audio, manual/platform/ad pauses,
optional Player cloud save/restore and ad callbacks. The optional Phaser test
exercises a real Phaser 3 renderer with the same lifecycle boundary in Chromium
touch emulation. CI checks the committed bundle and uploads
`yandex-c5-contract.json` even when a browser run fails. Contract evidence is
intentionally limited to `SDK_CONTRACT_PASS` / `SDK_CONTRACT_FAIL` and
`YANDEX_LIVE_NOT_RUN`; **it can never certify platform acceptance or Release**.

### Separate owner-authorized Yandex Console draft

Before any real game release, an owner must explicitly authorize a disposable
new-game draft in Yandex Console (do not reuse frozen games). Then record:

1. Actual uploaded ZIP SHA-256 and Console draft ID, and network/debug-panel
   evidence that the hosted `/sdk.js` loaded and `YaGames.init()` succeeded.
2. LoadingAPI.ready only after real assets/Runtime mount; paired
   GameplayAPI.start/stop markers on start, pause, tab hide, resume and close.
3. Real browser/device input, viewport changes, mute/audio pause, and visible
   handling of SDK capability/network failures.
4. Explicit Player cloud save/restore including guest refusal and corrupted
   data handling; explicit ad attempts including no inventory, shown/closed,
   rewarded and unrewarded outcomes, with no automatic ads or false reward.
5. Exact Console errors/warnings, applicable platform policies, device matrix,
   game-specific rights and independent Release checks.

Without that separate authorization and evidence, hosted SDK, real Player,
inventory, real Android/iOS hardware, Yandex Console and publication remain
`NOT_RUN` (or `BLOCKED` when an explicit dependency is unavailable). Even an
approved Console draft is not moderation or release approval.

- `node --test packages/connect-yandex/test/*.test.mjs` validates fake SDK/DOM
  contracts, including cancellation, timeout and double-init races.
- C2 lifecycle tests use a fake SDK with the real Runtime host. A dedicated
  Playwright smoke uses Chromium, Firefox, Android Chromium emulation and iPhone
  WebKit emulation; it is a **browser SDK contract test**, not a physical-device
  or hosted-Yandex test.
- Physical devices, live cloud storage, **live ad delivery** and a live Yandex
  draft are separate gates. Fake-SDK tests never imply `YANDEX_LIVE_PASS`.
- No CEOS/Starter Kit migration and no modification of existing game projects.

Official documentation: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about.html
Lifecycle documentation: https://yandex.ru/dev/games/doc/ru/sdk/sdk-game-events
and https://yandex.ru/dev/games/doc/ru/sdk/sdk-events (checked 2026-10-29).
Player data documentation: https://yandex.ru/dev/games/doc/ru/sdk/sdk-player
(checked 2026-10-31).
Advertising: https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv
(checked 2026-10-31).
