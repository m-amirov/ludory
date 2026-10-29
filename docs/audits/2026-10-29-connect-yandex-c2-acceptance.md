# Connect Yandex C2 — local acceptance evidence

Date: 2026-10-29. Base: `main` `2b4bd70ed64b0e9b35fc206056d04fb585e43ecf` (PR #39 C1 merged).
Scope: [approved Connect Yandex design](../superpowers/specs/2026-10-29-connect-yandex-design.md) §5; [C2 implementation plan](../superpowers/plans/2026-10-29-connect-yandex-c2.md).

## Delivered

- `createYandexLifecycle({ sdk, host, audio?, canResume?, windowObject?, documentObject? })` is SDK-specific and does not modify Core/Runtime/Phaser.
- Explicit, awaited, at-most-once `LoadingAPI.ready()` after Runtime initialization and caller-confirmed resource loading; capability errors cannot become success.
- Gameplay start/stop markers follow actual host statuses; duplicate attach/status events do not duplicate calls. Optional errors are observable as Connect degradation.
- SDK pause/resume pauses Runtime frames/input/audio and resumes only platform-owned pauses. Manual pause (`setManualPaused`) and explicit veto are never overridden.
- Independent pause reasons for SDK, `pagehide/pageshow` and document visibility prevent premature resume during BFCache/tab changes. Callback generation guards stale teardown handlers.
- Browser fixture invokes the actual bundled Runtime/Connect with a fake SDK, not a standalone mock lifecycle engine.
- Review-driven regression handling prevents an unbalanced `GameplayAPI.start()` when `stop()` is absent and observes rejected thenables returned by optional audio or invalid async `canResume` callbacks.
- A fulfilled but stale asynchronous loading-ready notification remains SDK-idempotent across detach/reattach; a detached caller receives `false`. Browser page listeners remain active if a separate visibility listener cannot be installed.

## Verification evidence

| Check | Observation |
| --- | --- |
| Baseline | C1 `main`: 501 tests, 499 PASS, 2 SKIP; Quality 17 PASS |
| Task 1 RED→GREEN | Missing exported factory + rejecting SDK marker retry |
| Task 2 RED→GREEN | Platform pause, manual ownership, resume-veto semantics |
| Task 3 RED→GREEN | BFCache/page/visibility events, independent reasons, stale callback safety; extra RED→GREEN coverage for delayed asynchronous start/stop and detach cleanup |
| C2 Node suite | `node --test --test-isolation=none packages/connect-yandex/test/lifecycle.test.mjs`: **29/29 PASS** |
| Root suite and Quality | `npm test`: **530 tests, 528 PASS, 2 SKIP, 0 FAIL**; Engineering Quality **17/17 PASS** |
| Static checks / Core example | `npm run check`, `node examples/core-session.mjs`, `git diff --check`, and `node --check packages/runtime/test/browser/yandex-c2-smoke.mjs`: **exit 0** |
| Playwright browser smoke | `npm run smoke` in `packages/runtime/test/browser`: **exit 0**; existing R6 7/7 PASS and Connect Yandex C2 **4/4 PASS** (Chromium, Firefox, Android emulation, iPhone WebKit emulation) |
| Remote exact-HEAD CI | pending PR publication |

## Browser gate note

Initial browser launch was blocked by sandbox process permissions and missing host OS libraries (`libgstreamer`, `libgtk-4`, etc.). After installing the Playwright system dependencies in this isolated environment, an authorized headless execution completed successfully on all four C2 variants. The browser smoke bundles the real Runtime and Connect lifecycle but injects a fake Yandex SDK; its PASS attests the browser integration contract only. The GitHub Actions browser job also installs those dependencies and now includes the C2 fixture; the exact remote PR CI outcome is pending.

## Not established

- No Yandex-hosted SDK observation, Yandex developer-console debug panel, actual mobile hardware or real ad event inventory.
- No cloud Player storage (C3), ads (C4), Yandex archive/live draft (C5), release package, moderation submission or publication.
- `YANDEX_LIVE_PASS` and Release PASS remain **BLOCKED / NOT ASSESSED**.
