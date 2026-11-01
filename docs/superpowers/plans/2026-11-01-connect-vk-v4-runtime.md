# Connect VK V4 Runtime Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a deterministic VK-only Studio Runtime template with isolated official Bridge, usable desktop/mobile UI, and fake-Bridge browser contract evidence.

**Architecture:** Studio owns four immutable template files; a build script creates the platform-neutral Runtime+VK bundle and a separate pinned official Bridge ESM bundle. The entrypoint imports both and delegates platform operations to Connect VK V1–V3; browser smoke replaces the Bridge module only on its local test server.

**Tech Stack:** Node.js 22+ ESM, esbuild 0.25.12, `@vkontakte/vk-bridge@3.0.2`, Node test runner, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-11-01-connect-vk-v4-runtime-design.md`

## Global Constraints

- `vk-runtime` target exactly `['vk-games']`; namespace game ID max 35 characters for template save key.
- Never load remote SDK URLs, import VK from `@ludory/core`, touch Yandex or frozen games, or assert live VK SDK success.
- All generated assets must match Studio source receipts and deterministic checked-in bytes.
- Browser checks are fake-Bridge contract tests and device emulation, not physical-device evidence.

## Review Focus

- Yandex/mixed-target creation: tests must verify `BLOCKED`, without writing to the chosen directory (Task 1).
- Overlong VK game IDs: test the 35/36-character boundary before game creation (Task 1).
- Stale/missing/mutated managed Bridge asset: tests must reject exact-hash drift (Task 1).
- Failed SDK init or false rewarded result: browser test must show no playable/rewarded success (Task 2).
- Mobile/desktop overflow or hidden action controls: browser dimensions and reachability assertions (Task 3).

---

### Task 1: VK-only template, pinned dual bundles and Studio provenance

**Files:**
- Create: `scripts/build-vk-template.mjs`, `packages/studio/catalog/templates/vk-runtime/template.json`, `packages/studio/test/vk-template.test.mjs`
- Generate: `packages/studio/catalog/templates/vk-runtime/licenses/vk-bridge.txt`, `packages/studio/catalog/templates/vk-runtime/licenses/swc-helpers.txt`
- Generate: `packages/studio/catalog/templates/vk-runtime/assets/ludory-vk.js`, `packages/studio/catalog/templates/vk-runtime/assets/vk-bridge.js`
- Modify: `packages/studio/catalog/profiles/web-game.json`, `packages/studio/src/scaffold.mjs`, `packages/studio/test/catalog.test.mjs`, `package.json`, `package-lock.json`

**Interfaces:** `buildVkTemplateBundles(): Promise<{ ludory: Buffer, bridge: Buffer }>` and `verifyVkTemplateBundles({ ludory, bridge }): Promise<true>`; CLI `node scripts/build-vk-template.mjs [--check]`.

- [x] Write catalog/scaffold failing tests for VK-only targets, 35/36 character game IDs, complete hashed assets and rejected stale bundles.
- [x] Run `node --import ./packages/studio/test/setup-trust-env.mjs packages/studio/test/vk-template.test.mjs` and confirm missing feature failure.
- [x] Add pinned Bridge dependency, dual esbuild build, Studio catalog descriptor/profile wiring, 35-character check and checked-in assets.
- [x] Re-run focused tests; verify both build output buffers repeat identically, SDK is isolated, and modified bytes fail verification.
- [x] Commit this coherent feature increment (combined with Task 2 and Task 3 in local V4 commit `20e1e59`).

### Task 2: Safe VK game entrypoint and wide/mobile UI

**Files:**
- Create: `packages/studio/catalog/templates/vk-runtime/index.html`, `packages/studio/catalog/templates/vk-runtime/src/main.js`
- Modify: `packages/studio/test/vk-template.test.mjs`, `packages/connect-vk/README.md`

**Interfaces:** `index.html` serves local `src/main.js`; the entrypoint imports `../assets/ludory-vk.js` and `../assets/vk-bridge.js`. Status element reports `data-sdk-ready`, `data-host`, `data-last-operation`, `data-rewarded`, `data-error-code`; buttons use stable IDs.

- [x] Write failing static/behavior tests for exact local imports, explicit init, no Yandex leaks, fail-closed state and responsive CSS requirements.
- [x] Confirm RED, implement minimal game input, renderer, host, storage, lifecycle, ads, sound and controls; reject non-VK game manifest.
- [x] Confirm GREEN in focused tests and `npm run check`.
- [x] Commit this coherent increment (combined local V4 commit `20e1e59`).

### Task 3: Browser contract smoke and CI gates

**Files:**
- Create: `packages/runtime/test/browser/vk-v4-smoke.mjs`
- Modify: `packages/runtime/test/browser/package.json`, `.github/workflows/runtime-browser.yml`, `package.json`, `packages/connect-vk/README.md`

**Interfaces:** `npm run smoke:vk-v4` in `packages/runtime/test/browser` starts an ephemeral local server and replaces only `assets/vk-bridge.js` with an injected ESM fake.

- [x] Add failing Chromium smoke for desktop 1000×720 and Pixel 7 emulation, boot failure, save/restore, manual/VK/ad pause, false/true reward, responsive controls.
- [x] Run focused browser smoke and confirm RED for the missing behavior.
- [x] Wire the browser entrypoint and CI path filters/commands to make the tests GREEN; retain clear emulation/contract labels.
- [x] Run `npm run check:vk-template`, `npm run check`, `npm test`, browser smoke, `node examples/core-session.mjs`, and `git diff --check`; report any pre-existing environment-only failures explicitly.
- [x] Commit coherent browser/CI integration (local V4 commit `20e1e59`); remote PR remains pending the owner's push/PR authorization.

## Verification and review note

- Full Node suite: 823 PASS / 13 SKIP / 0 FAIL, followed by quality integration 18 PASS. `npm run check`, `npm run check:vk-template`, Core example and focused fake-Bridge Chromium desktop/Android smoke passed locally.
- Restricted-sandbox Node subprocess handling reports `EPERM` even for a Git child that exits `0`; in that mode five unrelated AI/Studio test files fail. The same full test suite ran green in the approved nonrestricted execution mode. No AI/Studio source was changed to work around the sandbox.
- Independent read-only review found no Critical or Important issues, but two initially Minor UX issues were regraded Important for normal player-visible behavior: Restore was actionable while invalid, and rewarded acknowledgement was invisible. Both were verified RED→GREEN in the browser smoke; a separate mutation check proved stale previous-success UI is caught on a later failed ad.
- Live VK SDK/device, actual watched ads, publication, moderation and remote CI are **NOT_RUN** at this local commit. Do not merge without fresh exact-HEAD CI, review and separate owner authorization.
