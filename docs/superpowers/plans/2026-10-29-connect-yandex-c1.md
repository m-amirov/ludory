# Connect Yandex C1 — SDK Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the independently testable `@ludory/connect-yandex` SDK loader, initialization lifecycle and capability detection without changing Core/Runtime/Studio.

**Architecture:** A DOM-lazy browser script loader resolves `YaGames` without bundling the SDK. An instance-scoped connector deduplicates initialization, handles timeout/teardown races and exposes an immutable SDK capability snapshot. Future C2–C5 modules use the connector's `connection` and remain independent PRs.

**Tech Stack:** Node.js >=22, ESM, `node:test`/`assert`, native `AbortController` and timers, existing npm workspaces. No SDK npm dependency.

**Spec:** `docs/superpowers/specs/2026-10-29-connect-yandex-design.md` (approved 2026-10-29).

## Global Constraints

- Implement **C1 only**. `LoadingAPI.ready`, gameplay, Player storage, ads, Yandex build and live SDK acceptance belong to C2–C5.
- Preserve `@ludory/core`, `@ludory/runtime`, Phaser, Studio templates, CEOS/Starter Kit and frozen game repositories untouched.
- `packages/connect-yandex` is an independent workspace (`@ludory/connect-yandex`, Node >=22, ESM, explicit `exports`, no runtime SDK dependency).
- Import must not read `window`/`document`, load `/sdk.js`, call `YaGames.init()` or mutate global state.
- The Yandex-hosted default is `/sdk.js`; an explicitly supplied absolute script URL is allowed for own-domain integrations. Never vendor/download `sdk.js`.
- One connector has statuses `IDLE -> LOADING -> READY | FAILED` and `* -> DESTROYED`; retry after failure/destroy requires a fresh connector.
- Every rejection in a Connect operation is an instance of `YandexConnectError` with stable `code` and preserved cause when applicable; API errors must not become fake success.
- `capabilities` means only method availability. No live Yandex, release or moderation PASS from fake-SDK tests.

## Review Focus

1. Rejected/never-settled SDK loader after `destroy()` — C1 connector must reject promptly and never become `READY` later (Task 3).
2. A script fires `load` without defining `YaGames` — reject `SDK_UNAVAILABLE`, remove its listeners and injected script (Task 2).
3. Two `initialize()` calls while pending — return the **same promise**, invoke `sdkLoader` and `YaGames.init()` once (Task 3).
4. SDK `YaGames.init` resolves with a malformed SDK object — reject `SDK_INIT_FAILED` rather than claim `READY` (Task 3).
5. `document` accessor throws on SSR or restricted WebView — module import is inert; loader error is explicit, with no leaked timer/listener (Task 2).

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/connect-yandex/package.json` | ESM package, version, exports, engine |
| `packages/connect-yandex/src/errors.mjs` | `YandexConnectError`, C1 error codes |
| `packages/connect-yandex/src/capabilities.mjs` | Read-only method-level SDK feature detection |
| `packages/connect-yandex/src/sdk-loader.mjs` | DOM-lazy `/sdk.js` loader with abort and cleanup |
| `packages/connect-yandex/src/connector.mjs` | Instance-scoped initialization state machine and deadline |
| `packages/connect-yandex/src/index.mjs` | Public export boundary |
| `packages/connect-yandex/test/errors-and-capabilities.test.mjs` | Errors and capability matrix |
| `packages/connect-yandex/test/sdk-loader.test.mjs` | Fake document/script event contract |
| `packages/connect-yandex/test/connector.test.mjs` | Async SDK init/destroy/concurrency/race contracts |
| `packages/connect-yandex/README.md` | Usage, limits, API, evidence boundary |
| `package.json` | Include Connect tests in root `npm test`, source checks in `npm run check` |
| `package-lock.json` | Deterministic workspace lock refresh using `npm install --package-lock-only --ignore-scripts` |

### Task 1: Error taxonomy and capability detection

**Files:** Create `src/errors.mjs`, `src/capabilities.mjs`, `test/errors-and-capabilities.test.mjs` under `packages/connect-yandex/`.

**Interfaces:**
- Produce `YANDEX_CONNECT_ERROR_CODES` as frozen object containing `SDK_UNAVAILABLE`, `SDK_LOAD_FAILED`, `SDK_INIT_FAILED`, `SDK_TIMEOUT`, `CAPABILITY_UNAVAILABLE` (future C2–C4 codes stay reserved in the spec).
- Produce `class YandexConnectError extends Error` with `new YandexConnectError(code, {message, cause} = {})`, `.name === 'YandexConnectError'`, `.code` and `.cause`.
- Produce `detectYandexCapabilities(ysdk): Readonly<{loading:boolean, gameplay:boolean, player:boolean, fullscreenAds:boolean, rewardedAds:boolean}>`.

- [ ] **1.1 RED:** Test `new YandexConnectError('SDK_TIMEOUT',{cause}).code/cause` and unsupported code rejection; test missing/null SDK, absent features, partial `start` without `stop`, complete method matrix and frozen result. `node --test packages/connect-yandex/test/errors-and-capabilities.test.mjs` must fail on unresolved imports.
- [ ] **1.2 GREEN:** Implement the two modules with structural method checks: `ysdk.features.LoadingAPI.ready`, `ysdk.features.GameplayAPI.start/stop`, `ysdk.getPlayer`, `ysdk.adv.showFullscreenAdv/showRewardedVideo`. Invalid top-level `ysdk` is TypeError; absent optional surfaces are false.
- [ ] **1.3 VERIFY:** Run the targeted test, expect all PASS; commit only this task's files (`feat(connect-yandex): define SDK capabilities and errors`).

### Task 2: Browser script loader with explicit teardown

**Files:** Create `src/sdk-loader.mjs`, `test/sdk-loader.test.mjs` under `packages/connect-yandex/`.

**Interfaces:**
- Consume `YandexConnectError` (Task 1).
- Produce `loadYandexSdkScript({ documentObject, globalObject, scriptUrl = '/sdk.js', signal } = {}): Promise<{init: Function}>`. Missing dependencies are resolved from `globalThis.document`/`globalThis` **inside** the function's guarded body, not while evaluating default arguments; unusual throwing getters must become an explicit Connect error.
- The function returns an already-present valid `globalObject.YaGames` without script mutation. Otherwise append exactly one script to `document.head`, set `src` to configured path, attach load/error listeners, and remove listeners on every settle. Reject on error/abort; remove the script on failure/abort (successful script remains until page teardown). Require a safe URL shape (`/sdk.js` or `https://...` URL).

- [ ] **2.1 RED:** Fake document's `createElement`, `head.appendChild`, scripted `load/error` events. Assert default `src='/sdk.js'`; on load returns exact `YaGames` factory; network error produces `SDK_LOAD_FAILED`; load without `YaGames.init` produces `SDK_UNAVAILABLE`; abort produces `SDK_LOAD_FAILED`; every failing path removes injected script/listeners; preloaded SDK appends nothing; invalid URL rejected; absent `document` and throwing document accessor fail explicitly; import from Node with no DOM does not throw. Target: `node --test packages/connect-yandex/test/sdk-loader.test.mjs` fails first.
- [ ] **2.2 GREEN:** Implement event-driven loader and `AbortSignal` race/cleanup. Do not use a global connector cache or touch DOM at import time. A loader should not silently re-use a failed injected script.
- [ ] **2.3 VERIFY:** Targeted test PASS; commit files (`feat(connect-yandex): load official SDK with cleanup`).

### Task 3: Connector lifecycle and timeout races

**Files:** Create `src/connector.mjs`, `test/connector.test.mjs` under `packages/connect-yandex/`.

**Interfaces:**
- Consume Tasks 1–2.
- Produce `createYandexConnector({ sdkLoader = loadYandexSdkScript, initOptions, timeoutMs = 10_000 } = {}): Readonly<{initialize():Promise<connection>, destroy():Promise<void>, getStatus(): string}>`.
- `connection` shape: `Object.freeze({ sdk: ysdk, capabilities: detectYandexCapabilities(ysdk) })`; `getStatus()` values `IDLE | LOADING | READY | FAILED | DESTROYED`. A valid SDK result is a non-null non-array object; all capabilities may legitimately be `false`.
- `sdkLoader` is invoked with `{signal}`; it resolves a `YaGames` factory with `.init()`. If `initOptions` is not supplied, call `YaGames.init()` with zero arguments. Deadline covers **both** script load and `init` (never leave a permanent LOADING). Error mapping: loader-mapped error preserved; other loader failure `SDK_LOAD_FAILED`; `init()` reject or malformed ysdk `SDK_INIT_FAILED`; deadline `SDK_TIMEOUT`. On destruction reject pending init with `SDK_LOAD_FAILED` (cancelled cause) and avoid late READY/unhandled Promise.

- [ ] **3.1 RED:** Fake SDK and deferred promises. Test success/status/capability snapshot; one factory init for simultaneous calls and same pending Promise identity; rejected loader/init; malformed `ysdk`; deadline for never-resolved loader and init; `destroy` in IDLE, LOADING, READY, repeated calls; late init after destroy cannot re-enter READY; initialize after FAILED/DESTROYED rejects with stable code; optional `initOptions` propagation and numeric timeout validation. Run targeted test and observe expected failure.
- [ ] **3.2 GREEN:** Implement per-instance state, `AbortController`/deadline with cleanup in `finally`; use `Promise.race` without leaked rejection and prevent late state changes with a generation/destroy token. `initialize()` must be a non-async function returning stored Promise to preserve identity, though it internally starts async work. `destroy` must not wait forever for a noncooperative injected loader.
- [ ] **3.3 VERIFY:** Targeted test PASS; commit (`feat(connect-yandex): initialize SDK with bounded lifecycle`).

### Task 4: Package integration, docs and regression gate

**Files:** Create `packages/connect-yandex/package.json`, `src/index.mjs`, `README.md`; modify root `package.json` and `package-lock.json`; add `test/public-api.test.mjs`.

**Interfaces:** Public exports exactly `YandexConnectError`, `YANDEX_CONNECT_ERROR_CODES`, `detectYandexCapabilities`, `loadYandexSdkScript`, `createYandexConnector` via `@ludory/connect-yandex`.

- [ ] **4.1 RED:** Test `import('@ludory/connect-yandex')` in Node without globals; test public exports presence, no side effects, package metadata and that `@ludory/core` has no `connect-yandex` dependency. First run fails because workspace package is not registered.
- [ ] **4.2 GREEN:** Add workspace package, `exports`, `files`, README with `/sdk.js` hosted archive usage and C2–C5 limits; add Connect tests to root `npm test` and C1 `node --check` files to root `npm run check`; update lockfile. Do not add a fake production platform entrypoint.
- [ ] **4.3 VERIFY:** Run `node --test packages/connect-yandex/test/*.test.mjs`, `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`, verify clean worktree after commit. Record actual test counts/failures and host limitations; commit (`feat(connect-yandex): expose C1 package and CI contract`).

## PR and acceptance gate

- [ ] Confirm exact base and HEAD, a clean worktree and only C1 files plus approved docs.
- [ ] Independent review of C1: side effects, SDK races, timeout/error taxonomy, package exports, API compatibility.
- [ ] Publish C1 branch and open PR (not Draft if independent review and exact HEAD CI both PASS; otherwise Draft with blockers).
- [ ] Require CI on exact PR HEAD before accepting C1. No automatic merge, no Yandex platform PASS, no claims of live SDK or physical device coverage.
- [ ] Record C1 evidence and clearly list remaining C2–C5 work.
