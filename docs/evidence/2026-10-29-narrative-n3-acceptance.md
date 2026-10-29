# N3: Studio opt-in narrative game — technical acceptance

Date: 2026-10-29. Source base: merged N2 on `main` `3b9a489e928ea1b123526f24d353c14951cfcfa6`.
Scope: new empty Studio-created games only; no existing novel source or saved game modified.

## What was implemented

- `narrative-game` profile version 1.1.0 adds `narrative-interactive` 1.0.0 without changing `narrative-basic` 1.0.0.
- Studio `create` preview stays read-only; `--apply` rechecks collisions and writes SHA-bound `ludory.studio.json` receipts.
- Studio requires `narrative-assets.json` for the interactive template at preview/apply: an authored source SHA and per-image SHA-256 are validated without executing template JavaScript. Missing, undeclared or stale asset proofs fail before writing any project files.
- Source-bound, deterministic offline bundle of Core + N1 graph engine + N2 DOM Runtime, built by `npm run build:narrative-template` and attested by `npm run check:narrative-template`. Static sample uses `src/story.js` for RU/EN authored content, local SVG artwork and a same-origin static manifest.
- Sample exercises two authored photo frames with a decline option, photo thumbnails retained in the album, keepsake, authored message intent/tone/earned attachment and differing replies, causally correct shared/unshared photo and item echoes, relation threshold, exclusive route lock, two endings, journal, save/restore, full RU/EN shell switch and replay. Corrupt/incompatible saves are kept intact and cannot be overwritten via ordinary Save until explicit restart, including when a changed narrative graph leaves Runtime FAULTED. No LLM/text input, camera, remote inference, platform SDK, backend or CDN.

## Fresh local verification

| Gate | Observation |
| --- | --- |
| `npm test` with sandbox process restrictions lifted | 565 tests: **563 PASS, 2 SKIP, 0 FAIL**, quality integration **17/17 PASS**, exit 0 |
| `npm run check` | exit 0 |
| `node examples/core-session.mjs` | exit 0 |
| `npm run check:narrative-template` | bundle and asset proof matched committed source, 60,418 bytes, exit 0 |
| Catalog/create and narrative bundle unit tests | preview no writes, occupied project rejected, old template preserved, local asset validation, stable hash, generated receipt hashes, exit 0 |
| Playwright Chromium Desktop 1000×720 | PASS, `viewportWidth=1000`, externalRequests=0 |
| Playwright emulated Android portrait, Pixel 7 | PASS, `viewportWidth=412`, externalRequests=0 |

The real generated game was served from a disposable loopback static HTTP directory, not from source imports. Both browser passes exercised alternate narrative routes and endings, two photo options, decoded album images before and after reload, message cancel, message replies, conditional echoes, hidden locked routes, journal, saved-state restore, RU/EN document/ARIA localization, malformed/incompatible save preservation, FAULTED restore with valid Runtime digest and functional restart, and replay. PNGs and JSON reports are captured to ignored `packages/runtime-narrative/test/browser/artifacts/n3/`; the GitHub Runtime browser workflow uploads `narrative-n3-studio-browser` on CI.

### Limits

- Browser scenarios use desktop Chromium and **emulated** Android viewport/touch, not physical devices; Firefox/WebKit parity remains covered by N2's independent smoke, not N3 end-to-end.
- The Studio asset proof protects template creation against source/image drift. It is not a substitute for validating later edits in created games: authors still need graph/echo validation, current bundle rebuild where applicable, and real-game tests.
- The original SVG is generated as repository code for the demo; each downstream game needs its own rights/asset review.
- These tests do not establish Yandex/VK SDK compatibility, moderation approval, rights clearance or production release PASS. Independent PR review, GitHub checks and owner approval remain separate gates before merge.
