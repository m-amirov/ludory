# @ludory/connect-vk

V1 is an isolated, injected VK Bridge contract adapter for VK Games. It never imports browser globals at module import time and does not auto-load a script. `bridgeLoader` must provide the official VK Bridge instance with `send`, `subscribe`, `unsubscribe`.

```js
import { createVkConnector } from '@ludory/connect-vk';
import bridge from '@vkontakte/vk-bridge'; // game-owned VK entrypoint (V4)
const connector = createVkConnector({ bridgeLoader: async () => bridge });
const { bridge: initialized, livePlatformVerified } = await connector.initialize();
const advertised = await connector.probeCapabilities();
```

`DECLARED_SUPPORTED` is only a capability advertisement. Contract tests using a fake Bridge are not live VK acceptance. V2 adds storage/lifecycle, V3 adds ads; V4 adds the opt-in isolated Studio runtime template.

## V2: lifecycle and bounded VK cloud storage

Use the injected Bridge returned from `createVkConnector.initialize()`.

```js
import { createVkLifecycle, createVkStorage } from '@ludory/connect-vk';
const lifecycle = createVkLifecycle({ bridge: initialized, host, audio });
lifecycle.attach(); // VKWebAppViewHide/ViewRestore and optional visibility/page events
const storage = createVkStorage({ bridge: initialized, namespace: 'my-game' });
// Runtime host config: { ..., storage, saveKey: 'my-game:manual' }
// The host invokes storage.load/save; no direct SDK calls or local fallback.
```

Lifecycle only resumes pauses it acquired. A manual pause or a second active visibility reason prevents resume. `setManualPaused(true|false)` must accompany game-owned pause controls. `detach()` removes listeners but does **not** resume the Runtime.

VK Storage is isolated from Yandex Player/localStorage. Names are `ludory_<namespace-length>_<game-slug-with-underscores>_v1_<encoded-key>`, with safe VK Bridge ASCII keys and an unambiguous game-namespace boundary. For example, game `my-game` with Runtime key `my-game:manual` uses `ludory_7_my_game_v1_my-game_003Amanual`; direct slot `slot_1` uses `ludory_7_my_game_v1_slot__1`. The encoder doubles literal underscores, preserves ASCII letters/digits/hyphens, and escapes other characters as `_` plus four hexadecimal UTF-16 digits, preventing collisions between `:` or `/` and literal key text. Runtime `saveKey` must match the game ID and can use either `game-id:slot` or `game-id/slot`. Long encoded keys exceeding 100 ASCII characters fail explicitly.

Runtime persistence envelope V1 is validated **before** write. A single value is limited to **3800 UTF-8 bytes**, deliberately below the documented VK 4096-byte ceiling; large save states are rejected with `STORAGE_SAVE_FAILED` rather than chunked or silently truncated. A truncated/invalid remote JSON read reports `STORAGE_CORRUPT`. A write or clear must be explicitly acknowledged by VK. Operations are serialized, including concurrent save/load/clear, to preserve the order of operations.

Contract tests with a fake Bridge only certify local behavior. Live VK Games storage, app lifecycle, Android devices and ads remain **NOT_RUN**; there is no SDK loading, upload or publication operation in V2.

## V3: fullscreen and rewarded VK Bridge ads

```js
import { createVkAds } from '@ludory/connect-vk';

const ads = createVkAds({ bridge: initialized, lifecycle }); // lifecycle is attached
const availability = await ads.checkAvailability('rewarded'); // optional UI hint only
try {
  const { rewarded } = await ads.showRewarded();
  if (rewarded === true) grantGameReward(); // the game owns reward accounting
} catch (error) {
  // ADS_NOT_SHOWN, ADS_FAILED or CAPABILITY_UNAVAILABLE: no reward
}

// Before tearing down the game, cancel ads and then detach the lifecycle.
ads.destroy();
lifecycle.detach();
```

`showFullscreen()` sends `VKWebAppShowNativeAds` with `ad_format: 'interstitial'` and returns `{ shown: true }` only for a strict `{ result: true }` Bridge response. `showRewarded()` uses `ad_format: 'reward'` and returns `{ shown: true, rewarded: true }` only for the same strict result on that request. Errors, rejected calls, missing/false/malformed responses, detach and destroy cannot award a reward. A second simultaneous show is rejected. Availability uses `VKWebAppCheckNativeAds` and never grants a reward or proves an ad was watched.

The adapter leases a scoped Runtime pause for the duration of the ad. VK hide, browser visibility and manual pause reasons remain independent. An ad's completion must not resume a game still paused for another reason. The lifecycle attachment token prevents an old Bridge response from affecting a newly attached game. If the SDK never settles a show, the adapter times out after 120 seconds and releases its own lease; `createVkAds({ ..., timeoutMs })` accepts 1–300000 milliseconds for a controlled override.

VK's result is an **SDK acknowledgement**, not cryptographically signed proof. V3 does not perform live VK SDK/device verification; `livePlatformVerified` and Release gates remain unproven. No real player reward is granted by the adapter itself, no SDK or game files are bundled, and no publication is performed.

## V4: isolated VK-only Runtime template

For **a new empty game directory only**, opt into the platform-specific Studio template:

```sh
node packages/studio/bin/ludory.mjs create --project /path/to/new-empty-game --id vk-smoke --title 'VK Sample' --lang en --profile web-game --template vk-runtime --targets vk-games
```

As with other Studio create flows, preview before adding `--apply`. The template rejects Yandex and mixed targets, and limits IDs to 35 characters so the fixed `game-id:vk-runtime` persistence key fits VK Storage limits.

The generated `assets/ludory-vk.js` is an ESM bundle of **Runtime plus Connect VK**; `assets/vk-bridge.js` is a separate local bundle of the official, pinned `@vkontakte/vk-bridge@3.0.2`. `src/main.js` owns the Bridge import, the single VK initialization, lifecycle, storage, ad controls, and game Runtime. The game does not download an unpinned CDN script, use Yandex SDK or copy saves to browser storage. Studio hashes both managed files in its receipts. Rebuild and check with:

```sh
npm run build:vk-template
npm run check:vk-template
```

The starter UI has pointer/touch/keyboard scoring, audio, explicit manual pause, VK cloud save/restore and separate fullscreen/rewarded buttons. Restore is enabled only before Start (reload the game to restore a saved score). The visible rewarded-ad acknowledgement is **only** the strict response of one rewarded SDK call and explicitly credits **no prize**; the starter never grants a real reward or claims verified ad watching. A missing/rejected Bridge prevents Start and shows a bootstrap error.

`npm run smoke:vk-v4` from `packages/runtime/test/browser` uses local, fake-Bridge Chromium with desktop 1000×720 and Android viewport emulation. This is a **contract smoke**, not a physical Android test or live VK acceptance. SDK/device advertising, upload, moderation, publication, Release PASS and candidate ZIP packaging remain **NOT_RUN** and need separate owner-authorized steps.
