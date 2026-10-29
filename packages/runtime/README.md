# Ludory Runtime (R4 candidate)

`@ludory/runtime` is an engine-neutral adapter around a real `@ludory/core` session. It does not import Phaser or Yandex/VK SDKs. R4 introduces **manual** save/restore and optional browser adapters; it does not auto-save, auto-restore, migrate existing games or certify platform releases.

```js
import {
  createRuntimeHost, createBrowserEnvironment, createBrowserStorage,
  createBrowserAudio,
} from '@ludory/runtime';

const environment = createBrowserEnvironment({ root: document.querySelector('#game') });
const storage = createBrowserStorage();
const audio = createBrowserAudio({ resolveAsset: id => assetManifest[id] });
const host = createRuntimeHost({
  game, initialState, update, renderer, input,
  environment, storage, audio, saveKey: `${game.id}:main`,
});
await host.initialize(); // no storage read
await host.restore();    // explicit; only if a save exists, before start
host.start();
await host.save();       // explicit write only
```

The example assumes the caller supplies a valid game definition, renderer, input, update function and `assetManifest`. A new game without a previous save should call `start()` directly; `restore()` rejects with `RESTORE_FAILED` if no record exists. Do not call `restore()` after gameplay starts. `save()` writes a versioned envelope with an exact Core snapshot (`revision` included), canonical UTF-8 JSON and SHA-256; the hash detects accidental corruption but **does not authenticate** a save. When storage or digest is unavailable, the host rejects with a stable `RuntimeError` code.

Browser storage uses a namespaced `localStorage` key and reports actual quota/permission failures. Browser environment uses `requestAnimationFrame`, root CSS viewport dimensions, Web Crypto and an injected UTC clock. Browser audio uses caller-resolved game-owned asset identifiers; autoplay denial is `AUDIO_UNAVAILABLE` and never a gameplay fault. The host does not own or destroy injected adapters. Browser, device, Phaser, Connect and Release acceptance belongs to later stages.
