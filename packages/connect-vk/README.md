# @ludory/connect-vk

V1 is an isolated, injected VK Bridge contract adapter for VK Games. It never imports browser globals at module import time and does not auto-load a script. `bridgeLoader` must provide the official VK Bridge instance with `send`, `subscribe`, `unsubscribe`.

```js
import { createVkConnector } from '@ludory/connect-vk';
import bridge from '@vkontakte/vk-bridge'; // game-owned VK entrypoint (V4)
const connector = createVkConnector({ bridgeLoader: async () => bridge });
const { bridge: initialized, livePlatformVerified } = await connector.initialize();
const advertised = await connector.probeCapabilities();
```

`DECLARED_SUPPORTED` is only a capability advertisement. Contract tests using a fake Bridge are not live VK acceptance. V2/V3/V4 implement storage/lifecycle, ads and isolated bundle respectively.

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
