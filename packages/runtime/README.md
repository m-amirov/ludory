# Ludory Runtime — R1–R6 implementation

`@ludory/runtime` is an engine-neutral host for a real `@ludory/core` session. It does not import Phaser or Yandex/VK SDKs. R1–R6 provide lifecycle, input, viewport, **manual** persistence, optional audio and a locally bundled Studio browser starter. No auto-save, auto-restore, legacy migration, Connect adapter or platform release certification is implied.

## Create and run a new browser game

From the monorepo root, using Node.js 22+:

```sh
npm ci --ignore-scripts
mkdir runtime-demo
node packages/studio/bin/ludory.mjs create --project ./runtime-demo --id runtime-demo --title 'Runtime Demo' --lang en --profile web-game --template runtime-basic --targets yandex-games,vk-games --json
# Inspect the dry-run preview, then run the same command with --apply.
node packages/studio/bin/ludory.mjs create --project ./runtime-demo --id runtime-demo --title 'Runtime Demo' --lang en --profile web-game --template runtime-basic --targets yandex-games,vk-games --apply --json
```

Use a new **existing, empty** target directory; choose a different name if `runtime-demo` already exists, never point this command at an existing game. Serve that directory with any static HTTP server and open `index.html` in a browser (`file://` is not supported because the game loads its local manifest). The generated `src/main.js` imports `../assets/ludory-runtime.js` locally; creating a game does not download a CDN bundle or install Phaser. The Studio creation receipt hashes the generated files. `--targets` records future destinations only; there is no SDK wiring or platform verification in this starter.

Start, Pause, Resume, Save, Restore, Sound and Stop are buttons in the starter. Restore is explicit and allowed only while the host is `READY`, before Start, and only if a previous save exists. Reloading without Restore starts fresh. Once stopped, create a new host rather than restarting the terminal Core session.

The template deliberately uses a DOM renderer. For Phaser, integrate the separate optional [`@ludory/runtime-phaser`](../runtime-phaser/README.md) adapter into a game-owned browser build; the DOM template is not a Phaser starter.

## Host API

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

Browser storage uses a namespaced `localStorage` key and reports actual quota/permission failures. The starter continues gameplay without storage if browser policy denies access; `save()` then reports `STORAGE_UNAVAILABLE`, not success. Browser environment uses `requestAnimationFrame`, root CSS viewport dimensions, Web Crypto and an injected UTC clock. Browser audio uses caller-resolved game-owned asset identifiers; autoplay denial is `AUDIO_UNAVAILABLE` and never a gameplay fault. Pause/resume does not replay input queued during suspension. The host does not own or destroy injected adapters.

## Verification and limits

```sh
npm run build:runtime-template
git diff --exit-code -- packages/studio/catalog/templates/runtime-basic/assets/ludory-runtime.js
npm test
npm run check
node examples/core-session.mjs
cd packages/runtime/test/browser
npm ci --ignore-scripts
npx playwright install chromium firefox webkit
npm run smoke
```

The R6 browser smoke covers desktop Chromium/Firefox/WebKit plus Android Chromium and iPhone WebKit **emulation**, manual save/reload/restore, audio, input and resize. The separate Phaser browser fixture checks actual Phaser 3 initialization and cleanup. Playwright binaries and OS libraries are prerequisites of browser testing, not a `Studio create` requirement. The full evidence matrix and remaining physical-device, BFCache and platform gates are in [`R7 acceptance`](../../docs/audits/2026-10-29-runtime-r7-acceptance.md). No browser smoke attests device hardware, SDK compatibility or Release PASS.
