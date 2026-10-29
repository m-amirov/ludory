# Connect Yandex C2 — Lifecycle and Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind a new Ludory Runtime host's real state to Yandex loading/gameplay markers and SDK/browser pause/resume events, without ever overriding a manual pause.

**Architecture:** An optional, instance-scoped `createYandexLifecycle` adapter subscribes to the existing Runtime host status stream and the already initialized Yandex SDK. It only calls Runtime's existing pause/resume methods; the host remains responsible for scheduler, input and audio, with an optional audio adapter as additional silence boundary. Event-source ownership and manual-pause intent prevent unsafe auto-resume.

**Tech Stack:** Node >=22 ESM, `node:test`, existing `@ludory/connect-yandex`, injected fake Runtime/SDK and browser events.

**Spec:** `docs/superpowers/specs/2026-10-29-connect-yandex-design.md`, §5 (owner-selected independent C1–C5 path; C2 continuation requested on 2026-10-29).

## Global constraints

- C2 only. No cloud saves (C3), ad bridge (C4), Yandex bundle or live draft (C5).
- No source edits in Core, Runtime, Phaser, Studio, frozen games, CEOS or Starter Kit.
- SDK `LoadingAPI.ready()` is emitted only after caller completed initialization/resources, never automatically during SDK load.
- Gameplay markers are derived from actual Runtime status, not a guessed lifecycle or browser focus.
- Manual pauses/menus, app pauses and mute are never overridden by platform resume; `setManualPaused(boolean)` is required integration signal.
- Missing/throwing optional SDK methods degrade Connect; they cannot fake PASS or corrupt Runtime status.
- Test with fake SDK in Node; do not claim live Yandex or platform/release PASS.

## Review focus

1. `host.start()` synchronously emits RUNNING during an already active platform pause: the bridge must not leave scheduler/audio active.
2. Stale SDK callback after `detach()` or an `off()` exception must not mutate host state.
3. A rejected/throwing optional marker must not be recorded as successful or leak unhandled rejection.
4. SDK resume while `pagehide` or `visibilitychange:hidden` is still active must not resume host.
5. Manual pause activated during platform pause must remain PAUSED when platform resumes, even if `setManualPaused(false)` happens later.

---

### Task 1: Game-ready marker and gameplay status bridge

**Files:** create `packages/connect-yandex/src/lifecycle.mjs`; modify `src/index.mjs`, `README.md`; test `packages/connect-yandex/test/lifecycle.test.mjs`.

**Interfaces:** `createYandexLifecycle({ sdk, host, audio?, canResume?, windowObject?, documentObject? })` returns frozen `{ attach(), detach(), markReady(): Promise<boolean>, setManualPaused(boolean), getStatus(), getLastError() }`. SDK/host are injected; import remains DOM inert. `attach()` subscribes once to `host.subscribe(listener)`; observed `status` events and initial status reconcile `features.GameplayAPI.start/stop` only on transitions; `markReady()` requires initialized host status and loaded resources confirmed by caller.

- [ ] Write tests: import inert in Node, invalid inputs, ready-before-host rejected, ready single-success only, absent/throwing/rejected LoadingAPI returns explicit failure, status marker sequence READY→RUNNING→PAUSED→RUNNING→STOPPED, duplicate attach/detach and SDK failures.
- [ ] Run `node --test packages/connect-yandex/test/lifecycle.test.mjs` and observe feature-absence RED.
- [ ] Implement minimal marker, lifecycle instance state, status subscription, error taxonomy, exports. Do not change host code.
- [ ] Run C2 test file, then all Connect tests green.
- [ ] Commit `feat(connect-yandex): bridge loading and gameplay markers`.

### Task 2: SDK event pause ownership and audio boundary

**Files:** modify `src/lifecycle.mjs` and `test/lifecycle.test.mjs`.

**Interfaces:** `setManualPaused(true)` flags menu/explicit pause before or during platform pause; `false` only clears intent, never resumes automatically. SDK `game_api_pause` and `game_api_resume` installed by `attach()`, removed by `detach()`. Track platform-owned pause separately from already-manual-paused host; `canResume` must synchronously allow resume, and host must still be PAUSED. Host `pause`/`resume` handles scheduler and input. Optional `audio.pauseAll/resumeAll` is best-effort and must not override mute.

- [ ] Write tests: manual-before-platform, manual-during-platform, rapid duplicate events, resume veto/exception, host terminal statuses, pause/resume errors, late callbacks after teardown, no gameplay marker start when platform owns pause.
- [ ] Run C2 test file and see new RED.
- [ ] Implement SDK subscriptions, ownership, guarded resume and safe degradation.
- [ ] Run all Connect tests green.
- [ ] Commit `feat(connect-yandex): preserve manual pauses across SDK events`.

### Task 3: Browser/BFCache lifecycle, documentation, verification

**Files:** modify `src/lifecycle.mjs`, `test/lifecycle.test.mjs`, `README.md`, `docs/ROADMAP.md`; create `docs/audits/2026-10-29-connect-yandex-c2-acceptance.md`; modify root `package.json` check script if needed.

**Interfaces:** optional injected `windowObject` handles `pagehide/pageshow` (only persisted restores), and `documentObject` handles `visibilitychange` without requiring globals at import. Keep independent SDK/page/visibility pause reasons so release of one source cannot prematurely resume.

- [ ] Write tests: BFCache pagehide/pageshow, hidden/visible, independent overlapping SDK events, detached callbacks and manual pause, throwing browser listeners.
- [ ] Run C2 test file and observe RED.
- [ ] Implement page event guards and teardown. Document caller ordering: SDK initialized → lifecycle attached → host.initialize/resources ready → markReady → host.start; menu sets `setManualPaused(true)` before `host.pause()`.
- [ ] Run `node --test packages/connect-yandex/test/*.test.mjs`, full `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check` on this branch. Verify exact counts; capture remaining blocked live/platform/device gates.
- [ ] Commit `test(connect-yandex): cover C2 page events and acceptance`.

## Completion gate

Review exact branch diff independently, fix Critical/Important with regression RED→GREEN, and publish separate C2 PR only after all required checks. Merge needs explicit owner approval after exact-HEAD CI. No Yandex SDK live validation, moderation or Release PASS from fake SDK.
