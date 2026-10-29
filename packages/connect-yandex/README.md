# @ludory/connect-yandex

Independent Yandex Games SDK adapter for **new** LUDORY games. C1 provides
loading, initialization, availability detection and bounded errors. It does not
implement gameplay events, cloud saves, ads, a Yandex build or Release gates.

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

## Acceptance boundaries

- `node --test packages/connect-yandex/test/*.test.mjs` validates fake SDK/DOM
  contracts, including cancellation, timeout and double-init races.
- Browser Runtime, physical devices, cloud storage, ads and a live Yandex draft
  are separate C2–C5 gates. C1 mock tests never imply `YANDEX_LIVE_PASS`.
- No CEOS/Starter Kit migration and no modification of existing game projects.

Official documentation: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about.html
