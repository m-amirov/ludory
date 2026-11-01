# Connect VK V4 — Isolated Runtime Template Design

## Intent and boundary

V4 gives authors of **new Ludory games** an opt-in `vk-runtime` Studio template. The resulting game runs the platform-neutral Runtime and Connect VK V1–V3 behind an explicitly owned VK Bridge import. It is not a migration, an SDK certification, a VK upload, or a Release PASS.

The owner asked to continue after V3 merged. The concrete template/build decisions below are implementation defaults, not claims of live platform approval.

## Goals

- `web-game` offers a `vk-runtime` template **only** for `['vk-games']`; no Yandex or mixed-target artifacts. Reject game IDs that exceed the VK persistence key budget (35 slug characters for the template's `id:vk-runtime` key).
- Generate only local, hashed, Studio-managed files: `index.html`, `src/main.js`, `assets/ludory-vk.js`, `assets/vk-bridge.js`, and the copyright/license notices for bundled VK Bridge (MIT) and SWC helpers (Apache-2.0).
- `assets/ludory-vk.js` contains Runtime + Connect VK exports only. `assets/vk-bridge.js` contains the pinned official `@vkontakte/vk-bridge@3.0.2` ESM SDK and no Yandex SDK. Both are reproducible with a `--check` build gate.
- Entrypoint imports the Bridge from the separate local file, runs `VKWebAppInit` through the existing connector, then wires Runtime, scoped VK Storage, lifecycle, ads, keyboard/pointer/touch input, sound, and explicit Start/Pause/Resume/Save/Restore/Fullscreen/Rewarded buttons.
- On missing or rejected Bridge initialization, fail visibly without enabling gameplay. The Bridge uses a caught dynamic import so a missing module also produces an on-page bootstrap error. Rewarded-ad acknowledgement is visibly labelled as SDK-confirmed (no prize credited) only for the specific successful rewarded response; no auto-award and no local-storage fallback. The Restore control is available only in Runtime `READY`, before Start (or after reload).
- Layout usable at **1000×720** desktop and a simulated Android phone width without horizontal scroll or inaccessible controls.
- Browser contract smoke serves a fake **module** at the same local Bridge asset path; no real VK SDK/device/ads verification may be inferred from it.
- CI includes deterministic bundle check and browser smoke on edits to VK template/Connect VK sources.

## Non-goals and safety

- No VK upload archive or moderation artifact in V4; later candidate packaging and live device tests need a separate gate.
- No publication or reward-crediting backend, no trust upgrade of `livePlatformVerified`, no changes to Core, CEOS/Starter Kit, existing games, Yandex template or SDK settings.
- The browser stub exists only in tests; generated games always contain the pinned official Bridge bytes.

## Approaches

1. **Chosen:** two local VK-only ESM bundles (Ludory adapters and official Bridge). Offline bootstrap is deterministic, and tests can intercept only the Bridge module. Slightly larger artifact; official dependency has an explicit build pin.
2. Hosted CDN script plus Ludory bundle. Smaller committed output, but remote availability/version drift and CSP make it insufficiently deterministic.
3. Add VK Bridge to the shared Runtime bundle. Simpler import in the entrypoint, but leaks platform-specific code into generic Runtime and prevents clean isolated SDK replacement.

## Acceptance

- Scoped unit tests are red before the feature, green after implementation: catalog target restrictions/key limit, generated asset provenance/hashes, deterministic stale-bundle rejection.
- Browser smoke on Chromium 1000×720 and emulated Android: start/input, pause ownership, saved score restore, ad pause and fail-closed reward, missing Bridge visibly blocks boot, responsive controls/no overflow.
- `npm run check`, `npm run check:vk-template`, `npm run smoke:vk-v4` pass where supported; existing full suite failures attributable to Linux sandbox child-process `EPERM` are recorded independently.
- CI on exact PR HEAD is required before merge. No merge into `main` without a new explicit owner approval.
