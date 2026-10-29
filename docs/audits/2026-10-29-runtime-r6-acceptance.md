# Runtime R6 — browser/mobile acceptance evidence

Status: **R6 MERGED / CI PASS**. [PR #37](https://github.com/m-amirov/ludory/pull/37) was squash-merged into `main` on 2026-10-29 at `55c77b3e2b248e94cda4d8db13fbe16d8251452a`. Verified PR HEAD: `f7a094cb45012be6031ce4be7f067015e394ec14`. This is R6 technical evidence only, **not** automatic Runtime MVP owner acceptance, Connect, Release, rights or platform acceptance.

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
| Full exact-HEAD [Core checks](https://github.com/m-amirov/ludory/actions/runs/40853836146) | PASS — Windows/Ubuntu × Node 22/24, 4/4 jobs |
| Chromium, Firefox, WebKit and two mobile emulations on [R6 browser CI](https://github.com/m-amirov/ludory/actions/runs/40853836179) | PASS — GitHub workflow, exact PR HEAD |
| Real Phaser smoke and local bundle reproducibility on R6 browser CI | PASS — both CI steps successful |
| Independent post-fix review | PASS — no remaining Critical/Important; see [PR #37](https://github.com/m-amirov/ludory/pull/37) |
| Physical Android/iOS devices | NOT_RUN |
| VK/Yandex SDK, actual platform behavior, publication | NOT_RUN — outside R6 |
| Runtime MVP final R7 review | In progress — see [R7 handoff](2026-10-29-runtime-r7-acceptance.md) |

The R7 local rerun from the R6 merge commit observed Chromium 141.0.7390.37, Firefox 142.0.1, Android Chromium emulation and the two negative scenarios as PASS. WebKit desktop and iPhone WebKit emulation were **BLOCKED locally** by missing host libraries (`libgstreamer`, `libgtk-4` and others); the corresponding configurations passed in the exact-HEAD GitHub CI above. Keep these two observations separate.

Deferred R6 review notes: the local smoke fixture's URL decoder can throw on malformed request encoding, and a request URL prefix check is weaker than strict origin parsing. Neither finding was graded Critical/Important in the independent R6 review. BFCache is checked with synthetic page transition events only. No browser emulation establishes physical-device behavior. No source-bundle hash or test result grants platform/Release PASS.
