# Runtime MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Engine-neutral браузерный Runtime для новой Studio-игры с Core lifecycle, нормализованным вводом, manual persistence, audio и независимым Phaser bridge.

**Architecture:** Runtime управляет Core session, scheduler и adapter contracts, но не изменяет Core. Browser/Phaser и будущие Connect SDK остаются изолированными. Каждый PR добавляет проверяемый срез.

**Tech Stack:** Node.js 22+ ESM, `node:test`, `@ludory/core`, optional Phaser peer adapter, Playwright, локальная browser ESM сборка (только dev/build dependencies).

**Spec:** `docs/superpowers/specs/2026-10-28-runtime-mvp-design.md` (revision 2)

Статус: revision 2, согласован с исправленным proposal; код Runtime не создаётся.

Связанная спецификация: [Runtime MVP architecture](../specs/2026-10-28-runtime-mvp-design.md).

## Ограничения

- Работать только в отдельной ветке/worktree после явного решения начать Runtime.
- Existing games, CEOS и Starter Kit не трогать.
- Core не расширять браузерными, renderer или platform SDK зависимостями.
- Каждый PR должен оставлять рабочий пакет и иметь regression/contract tests.
- Connect и Release не входят в Runtime PRs.
- `createRuntimeHost` получает синхронный `update({deltaMs,inputs,state,setState})`; Core API не менять.
- `STOPPED` терминален; новый gameplay/restore после stop требует новый host.
- Variable tick `0..100ms`, первый tick после start/resume `0`, максимум один pending frame.
- Input v1, очередь максимум 256; нет replay при pause/resume.
- `PersistedRecord` — внешний конверт с вложенным неизменённым Core snapshot (включая `revision`), SHA-256 и `savedAt`.
- Manual `save`/`restore` (restore только в READY); autosave и restore-on-initialize не входят в MVP.
- Внешние input/storage/audio/environment принадлежат caller; host выполняет только своё cleanup/unsubscribe/unmount.

## File map

| File | Responsibility |
| --- | --- |
| `packages/runtime/package.json`, `src/index.mjs` | ESM exports/public API |
| `packages/runtime/src/contracts.mjs`, `errors.mjs` | Versioned validations, error codes |
| `packages/runtime/src/host.mjs`, `scheduler.mjs` | Core binding, lifecycle, frame timing |
| `packages/runtime/src/input.mjs`, `viewport.mjs` | Normalized bounded input, resize |
| `packages/runtime/src/persistence.mjs`, `browser-storage.mjs` | Save envelope, digest, browser adapter |
| `packages/runtime/src/audio.mjs`, `browser-environment.mjs` | Optional audio and browser environment |
| `packages/runtime-phaser/src/index.mjs` | Optional peer adapter |
| `packages/studio/catalog/templates/` | New-game integration and local browser bundle |

## Review Focus

1. Converting `PersistedRecord` to Core snapshot must preserve `revision` and reject extra fields/corruption before `Core.restore()` — R4.
2. `pause/resume` must not replay inputs or produce a huge first delta — R2/R3.
3. Concurrent `save` and `destroy` must not report premature successful writes — R4.
4. Exception from `update/render` must cancel scheduling and leave `RUNNING` — R2.
5. Node Core/Runtime imports must work without browser/Phaser, and new Studio game needs local ESM bundle, not CDN — R1/R6.

---

## Последовательность малых PR

### PR R1 — публичные типы и contract tests

**Files:** Create `packages/runtime/package.json`, `src/index.mjs`, `src/contracts.mjs`, `src/errors.mjs`, `test/contracts.test.mjs`; modify root scripts/workspaces only as required.

**Interfaces:** `RuntimeError(code,{cause?})`, `validateRuntimeInputEvent(event)`, `validateViewport(viewport)`, `validatePersistedRecordShape(record)` and versioned JSDoc contracts for `RuntimeHost/Renderer/Input/Storage/Audio/Environment`. Factory `createRuntimeHost` appears only in R2, without placeholder success.

- [ ] Write failing tests for invalid/valid input v1, unknown/accessor fields, NaN, viewport dimensions, missing `revision`, bad record version and stable RuntimeError codes.
- [ ] Run `node --test packages/runtime/test/contracts.test.mjs` and observe RED (missing exports).
- [ ] Implement minimal validators and package exports; Node import of Core/Runtime must work with `window/document` absent.
- [ ] Run focused tests GREEN, `npm test`, `npm run check`, Core example, `git diff --check`; inspect dependency graph for browser/Phaser/SDK leakage.
- [ ] Commit only the R1 slice and submit it for review, without claiming Runtime MVP PASS.


### PR R2 — engine-neutral host lifecycle

**Files:** Create `packages/runtime/src/host.mjs`, `scheduler.mjs`, `test/host.test.mjs`, `test/scheduler.test.mjs`.

**Interfaces:** `createRuntimeHost({game,initialState,update,renderer,input,storage?,audio?,environment,saveKey?})` and `initialize/start/pause/resume/stop/destroy/getStatus/getSnapshot/subscribe`. Use real Core `createGameSession({definition:game,initialState,onUpdate})`; `environment.now/requestFrame/cancelFrame` is the only frame clock.

- [ ] Write failing transition-table tests using real Core: `IDLE → READY → RUNNING ↔ PAUSED → STOPPED`, terminal stop, idempotent pause/resume/stop/destroy, invalid transition errors.
- [ ] Write failing deterministic frame tests: first/resumed tick `0`, clamp delta at `100ms`, one pending frame, canceled callback cannot tick.
- [ ] Write failing mount failure/duplicate initialize, thrown `update/render` → `FAULTED`, cleanup and subscriber isolation tests.
- [ ] Implement host and scheduler, initially passing empty `inputs:[]` to synchronous update (queue arrives in R3).
- [ ] Run RED/GREEN focused suite and full mandatory checks; commit R2.


### PR R3 — normalized input и responsive environment

**Files:** Create `packages/runtime/src/input.mjs`, `viewport.mjs`, `test/input.test.mjs`, `test/viewport.test.mjs`; extend `host.mjs`.

**Interfaces:** `createInputQueue({limit:256,onOverflow})`; `RuntimeInput.subscribe` and renderer `dispatchInput` feed the same normalized event v1 validator. `update({deltaMs,inputs,state,setState})` consumes a defensive copy per tick.

- [ ] Write RED tests for keyboard/pointer/touch events, invalid fields, copied events, overflow diagnostics and max queue length.
- [ ] Write RED tests for no input replay after pause/resume, no inputs in READY/STOPPED/FAULTED, no duplication across both injection paths.
- [ ] Write RED tests for viewport resize ordering, DPR, dimensions, equal-size portrait and unsubscribe after destroy.
- [ ] Implement adapters and queue; do not infer authoritative device class from viewport or user-agent.
- [ ] Run focused/full tests, commit R3.


### PR R4 — persistence и базовый audio

**Files:** Create `packages/runtime/src/persistence.mjs`, `browser-storage.mjs`, `audio.mjs`, `browser-environment.mjs`, `test/persistence.test.mjs`, `test/audio.test.mjs`; extend `host.mjs`.

**Interfaces:** `encodePersistedRecord(snapshot,{savedAt,digestSha256})`, `decodePersistedRecord(record,{game,digestSha256})`; `RuntimeStorage.load/save/clear`; `RuntimeEnvironment.utcNow/digestSha256`; `AudioHandle` returned by `play` and accepted by `stop(handle)`.

- [ ] Write RED tests for real `Core.snapshot()` → record → Core `restore()`, preserving `revision` and excluding wrapper fields from Core snapshot.
- [ ] Write RED negative tests for wrong version/identity, corrupted digest, missing crypto, absent storage, quota/read/write errors, and no false saved event.
- [ ] Write RED tests for concurrent save/save and save/destroy ordering, restore only READY before start, no auto restore/save.
- [ ] Implement canonical JSON encoder/digest adapter, browser storage, basic audio mute/volume and graceful `AUDIO_UNAVAILABLE`.
- [ ] Run focused/full tests and browser-storage smoke, commit R4.


### PR R5 — независимый Phaser adapter

**Files:** Create `packages/runtime-phaser/package.json`, `src/index.mjs`, `test/phaser-adapter.test.mjs`, browser smoke fixture.

**Interfaces:** `createPhaserRenderer({Phaser,sceneFactory,...})` implements `RuntimeRenderer.mount/resize/render/unmount`; Phaser is optional peer dependency here only.

- [ ] Write RED fake-Phaser tests for mount once, resize, snapshot immutability, input forwarding and cleanup.
- [ ] Implement adapter, run GREEN suite and real Phaser browser smoke with pinned test Phaser dependency.
- [ ] Prove Node import of Core/Runtime without Phaser installed; run full tests and commit R5.


### PR R6 — browser/mobile acceptance slice

**Files:** Add runtime-enabled Studio template assets and tests, local pinned browser ESM bundle/build script, browser smoke under `packages/runtime/test/browser/`.

**Interfaces:** New Studio game uses a relative local browser bundle. `Studio create` stays preview-first, static and offline; no bare `@ludory/runtime` import in non-bundled HTML, no mandatory CDN.

- [ ] Write RED generated-game tests for manifest/receipt SHA, offline bundle presence, read-only preview and no remote imports.
- [ ] Build a pinned, locally reproducible browser bundle and attach as verified Studio template asset; no install/download during `create`.
- [ ] Run Playwright Chromium/Firefox/WebKit desktop and Android Chromium/iPhone WebKit emulation for startup, keyboard/pointer/touch, pause, resize, save/reload and autoplay denial.
- [ ] Record browser versions, exact evidence and real-device `NOT_RUN` if unavailable; run mandatory checks and commit R6.


### PR R7 — review and handoff

**Files:** Update Runtime documentation/examples, integration notes and acceptance report; no product feature expansion.

- [ ] Independent review against spec revision 2, package boundaries and actual Core APIs; verify frozen repositories unchanged.
- [ ] Run full mandatory commands from exact candidate commit and fresh browser smoke; report PASS/FAIL/BLOCKED/NOT_RUN per acceptance criterion.
- [ ] Preserve missing real-device/platform evidence as open gates, never declare Release PASS.
- [ ] Request owner acceptance before Connect Yandex, merging protected branches or publishing.


## Stop lines

- Если Core начинает требовать browser globals — остановить и вернуть зависимость в Runtime.
- Если Phaser или Yandex/VK SDK попадает в `@ludory/core`/engine-neutral runtime — остановить PR.
- Если browser/device evidence отсутствует — оставить `BLOCKED`/`NOT_RUN`, не повышать до PASS.
- Если persistence contract требует миграции старых игр — остановить и вынести в отдельное явно разрешённое решение.
- Если `start` из PAUSED, `restore` после STOPPED или `PersistedRecord` без Core `revision` требуют менять Core — остановить и исправить Runtime.

## Definition of Ready для начала R1

- [x] В spec revision 2 предложены публичные имена, lifecycle, input/update, save envelope, tick, errors и audio handle.
- [x] Пакеты разделены на neutral runtime и отдельный `@ludory/runtime-phaser`; browser test runner — Playwright с Chromium/Firefox/WebKit и mobile emulation.
- [x] Connect/Release и старые игры исключены.
- [ ] Исполнитель сверил API Core на текущем branch base, а не только в отчёте аудита.
- [ ] Текущая audit/spec ветка опубликована или доступна исполнителю без потери пользовательских изменений.
- [ ] Владелец принимает revision 2 и разрешает R1 в отдельной ветке.
