# F5 disposable end-to-end evidence: scope and remaining gates

This is a **partial F5 run**, not acceptance of Ludory v1 and not permission to publish. The owner-approved scope is in `docs/superpowers/specs/2026-10-30-ludory-v1-completion-design.md`, F5.

## Reproduce

- Node-only receipt integrity: `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/f5-fixture-evidence.test.mjs`.
- Browser-capable Linux/CI: `cd packages/runtime-narrative/test/browser && npm run smoke:f5`. It requires the package's Playwright Chromium binary, installed by `.github/workflows/runtime-browser.yml`.
- CI artifact `ludory-f5-disposable-e2e`: `f5-evidence.json`, both platform-specific candidate ZIPs, and two narrative screenshots. The receipt contains an F5 run ID, actual checkout `git rev-parse HEAD`, source-tree SHA-256 digests, ZIP hashes, each archived member hash, browser observations and screenshot hashes.
- Each run uses new Studio projects in a process-owned temporary directory; no existing game is opened or edited. Evidence output must not exist beforehand; no files are overwritten. Temporary projects are removed after the run.

## Evidence separation

| Scope | Evidence and verdict |
| --- | --- |
| Story lifecycle | The same disposable `narrative-interactive` Studio game is previewed on wide desktop and emulated Android portrait: start, Back, photo, keepsake, message echo, journal, save/reload, upgrade conflict, corrupt save, replay. Three SHA-256-bound, viewport-checked Playwright screenshots per viewport show the populated journal, restored game and replay; page/network errors are captured. Only CI with browsers can attest these cases. |
| Native AI handoff | Studio creates a native production-art run from a fixture-owned brief; route and image handoff produce `NEEDS_AGENT_ACTION`, with no image-generation call and zero external host invocations. Model actually used: `null`; live AI: `NOT_RUN`. |
| Yandex dry-run ZIP | A second, independent `yandex-runtime` Studio-created, single-target fixture yields a candidate ZIP; builder SHA-256 is independently checked against ZIP bytes and every archived member. No live SDK or publication claim. |
| VK dry-run ZIP | A third, independent `vk-runtime` Studio-created, single-target fixture yields an analogous SHA-256-verified ZIP. No live VK or publication claim. |
| Cross-target story packaging | **BLOCKED: `STORY_TARGET_PACKAGING_BLOCKED`.** Neither platform ZIP contains the interactive narrative game. Their SDK-specific templates require different, trusted Studio origins and one target each. Do not combine them into one game's release evidence. |
| Offline startup | **NOT_REQUIRED** by owner decision on 2026-11-02. No offline navigation is run or required by the F5 gate. Deterministic game interactions without a paid runtime AI/server remain a separate architectural requirement. |
| Devices, moderation, Web reviewer, platform accounts | **NOT_RUN**; no credentials or physical devices were exercised. `releaseReady: false`, `publicationAllowed: false` unconditionally. |

## F5 still outstanding

1. Build **the same** tested narrative/Phaser game into genuine separately validated Yandex and VK packages with valid Studio provenance, without weakening existing package admission rules.
2. Exercise any optional Phaser scene and pause/audio under the same whole-game fixture, beyond separate SDK/runtime browser suites.
3. Complete real device, live Web-reviewer and platform moderation gates only from direct evidence and owner-authorized environments. These are not inferred from emulation or mocked SDK tests.
4. At the exact candidate release HEAD, perform F6 roadmap/contract/licensing/security review and obtain owner sign-off before tagging. No version tag is part of this run.
