# Connect Yandex C1 — independent local acceptance

Date: 2026-10-29. Base: `origin/main` `a3e75d45c4ed6d4851f506d466d1b4580bfaf8aa` (R7 merged).
Scope: approved [Connect Yandex design](../superpowers/specs/2026-10-29-connect-yandex-design.md), [C1 plan](../superpowers/plans/2026-10-29-connect-yandex-c1.md).

## Delivered

- Workspace package `@ludory/connect-yandex`, Node >=22 ESM, explicit exports, no Yandex SDK npm copy or global singleton.
- DOM-lazy official SDK loader (`/sdk.js` by default) and `YaGames.init()` bootstrap with bounded deadline.
- Instance lifecycle (`IDLE`, `LOADING`, `READY`, `FAILED`, `DESTROYED`); concurrent initialization returns one pending Promise; late completions cannot mark READY or start a new init after cancellation.
- Availability flags for LoadingAPI, GameplayAPI, Player, fullscreen and rewarded ads; method existence only, never observed success.
- Typed SDK errors with `code` and original `cause` when present.
- Zero changes to Core, Runtime, Phaser, Studio project templates, frozen games, CEOS or Starter Kit.

## Verification evidence

| Check | Actual observation |
| --- | --- |
| Baseline before C1 | `npm test`: 475 passed, 0 failed, 2 skipped; Quality integration 17 passed |
| C1 RED/GREEN | Missing public modules/package failed before implementation; new regressions failed before review fixes |
| C1 tests | `node --test packages/connect-yandex/test/*.test.mjs`: all 4 test files green; 24 individual cases |
| Root tests after fixes | `npm test`: 501 tests, **499 passed, 0 failed, 2 skipped** |
| Quality integration | 17 passed, 0 failed |
| Static checks | `npm run check`: exit 0 |
| Core example | `node examples/core-session.mjs`: exit 0 |
| Whitespace | `git diff --check`: exit 0 |

Initial `npm test` under a restricted sandbox failed 5 existing AI/Studio test files before any C1 code; it passed after running with permissions for child processes. Missing cached npm archive was resolved by installing project dependencies, not by changing source files.

## Independent review

Fresh read-only reviewer inspected `a3e75d4..1729161`, spec, plan and tests and reproduced three **Important** defects:

1. An uncooperative loader could trigger `YaGames.init()` after `destroy()` or timeout despite terminal status.
2. Throwing DOM `removeEventListener` prevented Promise settlement, leaked script on failure.
3. Throwing `factory.init` getter escaped stable `SDK_INIT_FAILED` taxonomy.

Fix pass `a7c4971` added RED→GREEN coverage for all three, and full suite was rerun. No second independent review was dispatched, as required by the native execution plan; the new tests are the fix evidence. No remaining Critical/Important finding from the original review is known.

## Gates not established

- **C1 exact remote PR HEAD CI:** pending until PR publication and CI run.
- **C2:** platform lifecycle/LoadingAPI/GameplayAPI and real audio behavior — not implemented.
- **C3:** Yandex Player/cloud saves and quotas — not implemented.
- **C4:** fullscreen/rewarded ad callbacks — not implemented.
- **C5:** standalone Yandex build, browser/mobile/live draft — not implemented.
- **YANDEX_LIVE_PASS, platform compliance, Release PASS, publication:** **BLOCKED / NOT ASSESSED**. No external game upload or moderation submission occurred.

C1 is a local SDK contract candidate; merge requires exact remote CI and owner decision.
