# N2 Runtime Narrative UI — scoped acceptance evidence

**Date:** 2026-10-29. **Baseline:** merged N1 PR #41, `main` merge SHA
`f1724912623c63eb00f9d56e3e52c3822f464378`.

## Implemented

- New opt-in `@ludory/runtime-narrative` package; generic Core/Runtime, Phaser,
  Connect Yandex/VK and existing game repositories untouched.
- Accessible DOM renderer for dialogue, conditional choices, photo variants,
  keepsakes, guided finite message composer (intent/tone/available attachment),
  authored preview and reply, local Cancel, conditional echo, ending, earned
  journal with optional RU/EN labels and relationship facts.
- Normalized Runtime inputs with finite action grammar and original beat ID;
  `advanceNarrative` enforces authored option availability and route locks.
- Core `state.narrative` is the single durable source. Session-only bounded Back
  restores all related state atomically; reload/restore do not retain undo stack.
- Local/same-origin image paths only and visible accessible fallback; no server,
  runtime AI, camera, free-text field or platform-specific SDK.
- Independent review regressions: backslash URL escape rejected, Back hidden
  when session history empty (including reload), keyboard focus restored on
  composer selection and new beat, large images constrained on portrait,
  stale button callbacks rejected across unmount/remount generations.

## Reproducible local evidence

| Command | Observed result |
| --- | --- |
| `node --test packages/runtime-narrative/test/*.test.mjs` | 11/11 PASS, 0 FAIL |
| `npm test` | 556 tests: 554 PASS, 2 SKIP, 0 FAIL; additional 17/17 quality integration PASS (re-run after review fixes). |
| `npm run check` | Exit 0 |
| `node examples/core-session.mjs` | Exit 0, restored Core snapshot shown |
| `npm run smoke` from `packages/runtime-narrative/test/browser/` | `PASS_N2_BROWSER`, 5/5 PASS |

Browser coverage (headless Playwright, **not physical device validation**):

- Chromium `141.0.7390.37`, desktop 1000×720;
- Chromium `141.0.7390.37`, Pixel 7 emulated Android portrait 412 px,
  buttons operated via touch;
- Firefox `142.0.1`, desktop 1000×720;
- WebKit `26.0`, desktop 1000×720.
- Chromium `141.0.7390.37`, intentional offline art failure/fallback.

Each browser scenario executes dialogue → photo → keepsake → contextual
message → delayed echo → locked ending → Back and alternate ending → journal →
Pause/Save/Reload/Restore. Double-send is checked for exactly one response;
keyboard focus, portrait oversized art, resize, Cancel, missing image fallback,
no outbound requests, and no JavaScript page errors are
asserted. CI workflow `runtime-browser.yml` now includes N2 smoke and uploads
JSON/screenshots as `narrative-n2-browser` GitHub Action artifact when run.
Screenshots of the headless Chromium desktop/Android, Firefox and WebKit ending
states were also generated and visually inspected locally; they are not claims
of physical-device, final art or platform acceptance.

## Not attested by N2

No actual Android/iOS hardware test, platform VK/Yandex SDK certification,
moderation, release readiness, art/rights gate or blind narrative playtest.
N3 Studio template and adoption in an existing game remain separate future work.

**Review gate:** New N2 PR requires an independent review of its actual diff,
all applicable GitHub checks on exact HEAD and owner go/no-go before merge.
