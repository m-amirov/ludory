# Runtime R6 — browser/mobile acceptance candidate

Status: **CANDIDATE**, pending final exact-HEAD CI and owner review. This is not Runtime MVP, Connect, Release, rights, or platform acceptance.

## Scope

- New opt-in `runtime-basic` Studio template, with source-bound generated files and local ESM bundle.
- No writes to legacy games or CEOS/Starter Kit sources.
- Browser-safe `@ludory/core` entry keeps Node-only physical-path functions out of the browser bundle.
- Real browser lifecycle, pointer/touch/keyboard input, pause/resume without stale input, manual save/reload/restore, viewport rotation, and stop/destroy.
- Real media playback after user activation; forced `NotAllowedError` test checks graceful `AUDIO_UNAVAILABLE` without stopping gameplay. The forced denial is a deterministic policy simulation, **not** evidence that browser autoplay was actually denied in a user environment.
- Denied `localStorage` test verifies gameplay remains usable and saving reports `STORAGE_UNAVAILABLE`.
- BFCache `pagehide/pageshow.persisted` pause/resume is tested with synthetic transition events; actual history restoration may vary by browser and is not independently attested.

## Reproduction

```sh
npm ci --ignore-scripts
npm run build:runtime-template
git diff --exit-code -- packages/studio/catalog/templates/runtime-basic/assets/ludory-runtime.js
npm test
npm run check
node examples/core-session.mjs
cd packages/runtime/test/browser
npm ci --ignore-scripts
npx playwright install --with-deps chromium firefox webkit
npm run smoke
```

The separate `packages/runtime-phaser/test/browser` smoke runs real Phaser 3.90.0 with pinned dependencies and cancellation/resource cleanup checks.

The browser smoke prints JSON containing exact Git HEAD, bundle SHA-256, Playwright version, browser versions, scenario status, and `realDevices: NOT_RUN`. A missing executable/library is `BLOCKED`, while application assertions are `FAIL`; neither is converted to `PASS`.

## Remaining gates

| Gate | Status |
| --- | --- |
| Full exact-HEAD CI, including Windows Node 22/24 | PENDING |
| Chromium, Firefox, WebKit and two mobile emulations on CI | PENDING |
| Real Phaser smoke on CI | PENDING |
| Independent post-fix review | PENDING |
| Physical Android/iOS devices | NOT_RUN |
| VK/Yandex SDK, actual platform behavior, publication | NOT_RUN — outside R6 |
| Runtime MVP final R7 review | NOT_RUN |

No browser emulation establishes real-device behavior. No source-bundle hash or test result grants platform/Release PASS.
