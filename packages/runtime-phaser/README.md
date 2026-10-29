# @ludory/runtime-phaser — Runtime R5

This adapter implements the R1 `RuntimeRenderer` interface with an injected Phaser **3** constructor.
It is independent of Core, does not import Phaser at module load, and includes no VK/Yandex SDK.
Phaser is an **optional peer dependency**, not a dependency of `@ludory/core` or `@ludory/runtime`.

```js
import { createPhaserRenderer } from '@ludory/runtime-phaser';
import Phaser from 'phaser'; // in the browser game entrypoint only

const renderer = createPhaserRenderer({
  Phaser,
  sceneFactory({ snapshot, dispatchInput }) {
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const scene = { create() { /* initialize sprites */ resolveReady(); } };
    return {
      scene,
      ready,
      renderSnapshot(next) { /* update game-owned sprites from detached Core state */ },
      onResize(viewport) { /* reflow game-owned sprites */ },
      dispose() { /* unsubscribe game-owned scene listeners */ },
    };
  },
});
// Supply `renderer` alongside game, initialState, update, input and environment
// to createRuntimeHost({ ... }) in an environment/bundle supporting that host.
// R6 will provide complete direct-browser host wiring and mobile acceptance.
```

## Contracts

- `createPhaserRenderer({ Phaser, sceneFactory, gameConfig?, readyTimeoutMs? })` returns `mount`, `resize`, `render`, `unmount`.
- The adapter owns exactly one `Phaser.Game` per mount and creates a fresh instance on remount.
- `parent`, `scene`, `width`, `height`, and nested `scale.parent`/`scale.width`/`scale.height`/`scale.mode` cannot be overridden by `gameConfig`.
- `viewport.width`/`height` are CSS pixel dimensions passed to Phaser; `dpr` and `orientation` are preserved for `onResize`.
- `sceneFactory` receives a detached initial Core snapshot and a guarded `dispatchInput`. The latter accepts only valid normalized `RuntimeInputEvent v1` with `source: 'renderer'`; it rejects stale events after unmount.
- `render(snapshot)` delivers a detached copy, so Phaser scene code cannot mutate Core state.
- Mount first waits cancellably for the root document's `DOMContentLoaded` before constructing Phaser.Game (Phaser's own deferred boot listener cannot be unregistered). Then it gates on engine readiness (`isRunning`/`ready`, not early `isBooted`) and optionally on `sceneFactory().ready` resolved by game-owned scene initialization (e.g. `scene.create`). Without that scene Promise, callers must ensure their hooks tolerate rendering before `scene.create`. Early Promise rejection, timeout, failed construction and interrupted boot are fail-closed. When the game loop cannot reach another frame, cleanup invokes Phaser 3's `runDestroy()` with a partial-startup fallback that individually tears down initialized subsystems, neutralizes pending texture callbacks, and releases CanvasPool entries/canvas. A `postBoot` callback can unmount before `loop.start()`, so the stopped-loop decision waits for that stack to finish.
- `unmount()` is idempotent, and concurrent callers await the same cleanup (including any failure). **Await `unmount()` before remounting.** A `mount()` attempted while teardown remains in flight rejects with `Phaser renderer is still unmounting`, without queueing an uncancellable future game. A normally running Phaser game still defers canvas disposal to its next game step after `destroy(true, false)`.
- No platform capability or Release PASS can be inferred from this adapter.

## Tests

```bash
node --test packages/runtime-phaser/test/*.test.mjs
npm test
npm run check
```

An **opt-in real browser smoke** pins Phaser 3.90.0 and Playwright 1.56.1 in a *separate nested fixture*, so the monorepo workspace and non-browser modules do not install Phaser:

```bash
cd packages/runtime-phaser/test/browser
npm ci
npx playwright install chromium
npm run smoke
```

The smoke starts a local HTTP server, loads a real Phaser Canvas scene in headless Chromium, verifies mounting/rendering/input/resize and actual canvas removal. It also runs three consecutive intentionally stalled Phaser startups, asserting no retained canvases, occupied CanvasPool slots or attached Input/Scale/Texture manager game references; tests a stopped loop and concurrent unmount, plus synchronous `preBoot`/`postBoot` cancellation; then cancels a normal startup during image loading, checks for zero late page errors, and mounts/unmounts again. A second streamed HTML fixture verifies cancellation while `document.readyState` is still `loading`, before `DOMContentLoaded`, without late game boot or resource resurrection. This is **not** mobile, VK/Yandex, WebGL, visual, or Release acceptance.
