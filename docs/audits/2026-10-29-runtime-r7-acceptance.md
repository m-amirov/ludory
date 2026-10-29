# Runtime MVP R7 — final technical review and owner handoff

**Status: TECHNICAL ACCEPTANCE CANDIDATE — OWNER DECISION PENDING.** This report evaluates the Runtime contract in [revision 2](../superpowers/specs/2026-10-28-runtime-mvp-design.md) and the [R1–R7 implementation plan](../superpowers/plans/2026-10-28-runtime-mvp.md). It neither certifies physical devices nor authorizes Connect, Release, publication or changes to frozen games.

## Scope and source provenance

- R1–R6 are merged into `main`; R6 [PR #37](https://github.com/m-amirov/ludory/pull/37) merged as `55c77b3e2b248e94cda4d8db13fbe16d8251452a` on 2026-10-29.
- Exact R6 PR HEAD was `f7a094cb45012be6031ce4be7f067015e394ec14`, with [Core checks](https://github.com/m-amirov/ludory/actions/runs/40853836146) and [browser matrix](https://github.com/m-amirov/ludory/actions/runs/40853836179) both completed successfully on that commit. The Core workflow executed Windows/Ubuntu × Node.js 22/24 (4/4 jobs); the browser job covered 5 configurations, local bundle reproducibility and real Phaser 3 smoke.
- Independent R6 **post-fix** code review reported no Critical or Important findings. It did not attest physical hardware, genuine BFCache navigation, actual autoplay policy denial, SDK compatibility or rights. See [R6 details](2026-10-29-runtime-r6-acceptance.md).
- R7 is a documentation, integration and evidence review of that source, without Runtime feature expansion. Independent R7 read-only code review of the initial candidate `6cfd8ed3184b8fde4b42b43f9886c0d630a41259` found **0 Critical / 0 Important / 2 Minor**; an incomplete README command was corrected before handoff, while a pre-existing broken foundation-audit link in `docs/ROADMAP.md` was deferred. R7 exact PR-HEAD CI remains `PENDING` until observed.
- Source/ownership boundary: only files in Ludory may be changed. The existing game repositories, CEOS and Starter Kit remain frozen and untouched by this review. No migrations, platform SDK calls, deployments or publications were performed.

## Spec revision 2 acceptance matrix

Status meanings: `PASS` = observed local and/or exact R6 PR-HEAD CI evidence; `BLOCKED` = environment prevented the check; `NOT_RUN` = no test performed; `PENDING` = future owner/review gate.

| Criterion | Status | Concrete evidence and scope |
| --- | --- | --- |
| New Studio game boots via engine-neutral browser host | PASS | R6 Playwright generated `runtime-basic`, local ESM bundle, manifest and creation receipt. Browser runner and CI `Runtime browser R6` succeeded. |
| Core session binding and lifecycle transitions | PASS | `packages/runtime/test/host.test.mjs`, `scheduler.test.mjs` and real browser start/pause/resume/stop/destroy; `createGameSession` remains the Core entrypoint. |
| Normalized keyboard/pointer/touch input | PASS | `input.test.mjs` and all five R6 CI browser/device-emulation scenarios. |
| Pause/resume no stale input replay or duplication | PASS | R3/R6 regressions and browser score checks after pause/resume. |
| Manual save/restore with fake and browser storage, incompatible/corrupt/error cases | PASS | `persistence.test.mjs`, explicit browser save → reload → READY restore; storage denial keeps game running and reports `STORAGE_UNAVAILABLE`. No autosave or auto-restore. |
| Responsive resize and mobile orientation | PASS (EMULATED) | Desktop Chromium/Firefox/WebKit and Android/iPhone emulations in R6 CI; local Chromium/Firefox/Android observed. Not physical device proof. |
| Audio mute/volume/pause/resume and autoplay-denial tolerance | PASS (SIMULATED DENIAL) | `audio.test.mjs`, real user-activated audio playback, deterministic rejected `Audio.play()` with `AUDIO_UNAVAILABLE` while gameplay stays RUNNING. Real-world autoplay-policy rejection not attested. |
| Independent Phaser renderer and real Phaser 3 browser smoke | PASS | `packages/runtime-phaser/test/phaser-adapter.test.mjs` and `PASS_REAL_PHASER_BROWSER_SMOKE` plus `PASS_PRE_DOM_READY_CANCELLATION` in Chromium; exact R6 CI browser job also passed. |
| Core/Runtime package boundaries, no Phaser/SDK import | PASS | Node-only `@ludory/core` and `@ludory/runtime` exports; browser-safe conditional Core surface; separate optional peer `@ludory/runtime-phaser`; no SDK runtime imports. |
| Independent browser smoke for MVP matrix | PASS (CI) | [R6 browser job](https://github.com/m-amirov/ludory/actions/runs/40853836179); this does **not** imply Connect or Release PASS. |
| Browser WebKit desktop and iPhone WebKit emulation rerun in this Linux executor | BLOCKED (LOCAL) | Missing WebKit shared libraries (`libgstreamer-1.0`, `libgtk-4`, etc.). Both configurations PASS in exact R6 CI; do not conflate the two environments. |
| Genuine BFCache history restore (not a synthetic event) | NOT_RUN | R6 test covers synthetic `PageTransitionEvent` only; browser-specific history cache behavior is unverified. |
| Physical Android and iOS hardware | NOT_RUN | No real device was attached. Mobile viewport emulation is not hardware acceptance. |
| Yandex/VK SDK integration, saves, lifecycle, monetization | NOT_RUN | Connect packages and target-specific live checks are outside Runtime R7. |
| Release, rights, platform moderation and production publication | NOT_RUN | Separate future owner-authorized stages; no release claim. |
| R7 independent branch review | PASS | Independent read-only review: 0 Critical/Important; 2 Minor (README example fixed after review, historical broken roadmap link deferred). |
| R7 exact-HEAD CI and owner acceptance | PENDING | Complete exact PR-HEAD checks before owner merge decision and Connect Yandex. |

## R7 local reproduction (2026-10-29)

Baseline source: `main` merge commit `55c77b3e2b248e94cda4d8db13fbe16d8251452a`, Node.js `v24.22.1`, npm `11.9.0`, Linux executor.

| Command | Observed result |
| --- | --- |
| `npm ci --ignore-scripts --offline` | PASS; dependency cache available. |
| `npm test` (approved non-sandboxed execution) | PASS: **475 PASS, 2 existing SKIP, 0 FAIL**, plus Quality integration **17/17 PASS**. |
| `npm run check` | PASS. |
| `node examples/core-session.mjs` | PASS; Core lifecycle/snapshot example output observed. |
| `npm run build:runtime-template` | PASS. |
| `git diff --exit-code -- packages/studio/catalog/templates/runtime-basic/assets/ludory-runtime.js` | PASS; generated browser bundle is identical to committed bytes. |
| `ludory create` preview then `--apply` into a fresh temporary empty directory | PASS: preview `READY`, apply `APPLIED`; manifest, `src/main.js`, local bundle and `ludory.studio.json` receipt exist. No existing game modified. |
| `packages/runtime/test/browser: npm run smoke` | **PARTIAL: 5 PASS / 2 BLOCKED**. Chromium, Firefox, Android emulation, denied storage and simulated autoplay denial passed. WebKit desktop/iPhone WebKit were blocked by missing host libraries. Exit code 1 was retained. |
| `packages/runtime-phaser/test/browser: npm run smoke` | PASS: `PASS_REAL_PHASER_BROWSER_SMOKE`, `PASS_PRE_DOM_READY_CANCELLATION`. |

R6 browser output carried source commit `55c77b3e2b248e94cda4d8db13fbe16d8251452a`, local ESM bundle SHA-256 `894dd54f1822b195cc2e8ca37329ddcae9b9a48d7fa6da38c701be532f79f18f`, Playwright `1.56.1`, Chromium `141.0.7390.37` and Firefox `142.0.1`. No physical device was claimed. The first sandboxed `npm test` run had 5 test-file failures due to denied child process execution (`spawnSync ... EPERM`), not established code regressions; rerun with approved process permissions passed. The sandboxed browser run similarly failed to bind local HTTP (`listen EPERM`) before an approved rerun observed browser outcomes. Both failures remain in the audit trail.

## Boundaries, open work and owner decision

1. `@ludory/core` remains platform-neutral. Runtime browser adapters are optional and isolated; Phaser 3 is a peer of `@ludory/runtime-phaser`, not a Core or neutral Runtime dependency. SDK/Connect code is not part of this stage.
2. The baseline browser game exercises a DOM renderer. Its success does not mean every future game-owned Phaser scene automatically works or has been mobile-tested.
3. Deferred R6 minor review items are test-server malformed URL handling and strict origin comparison. They are not production host bugs and have no R7 feature-scope expansion. Real BFCache history, genuine autoplay restrictions and physical device behavior remain unobserved.
4. Physical device and platform-specific evidence must be collected before claiming Yandex/VK readiness or Release PASS. Connect Yandex requires its own SDK/entrypoint tests, live runtime evidence and owner authorization; VK and Release are separate gates.
5. Owner decision requested: accept this **Runtime-only technical handoff** after R7 independent review and exact-HEAD CI, or request additional evidence/fixes. Do **not** merge R7 or begin Connect Yandex based on this candidate report alone.

### Independent review limitations and deferred minor

- The reviewer ran 119 focused Core/Runtime/Phaser tests (119 PASS), independently compared the browser bundle bytes and SHA-256, checked Node imports and all five required Review Focus risks. The full `475 PASS + 17 Quality` runs were executed separately by the primary R7 verification, not by the independent reviewer.
- The reviewer did not exercise physical devices, real BFCache history navigation, natural autoplay-policy rejection, arbitrary Phaser scenes, live Yandex/VK environments, rights or external frozen repositories; none of these becomes PASS on that account.
- **Deferred Minor:** `docs/ROADMAP.md` historically links to `audits/2026-10-28-foundation-acceptance.md`, which is absent even in the R6 base. This pre-existing documentary link defect does not affect Runtime's implementation or tests; correct the historical evidence reference in a separate source-audit cleanup.
