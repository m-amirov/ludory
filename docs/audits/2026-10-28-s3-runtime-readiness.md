# S3 readiness audit — Runtime-backed player quality (2026-10-28)

**Status: READ-ONLY PRODUCT GATE; no S3 skill approved, created or executed.** Baseline: Ludory `main` at `b56b096463ea0d1fe9489ea358a31ef67f14a978`, after merged [PR #31](https://github.com/m-amirov/ludory/pull/31). Sources: current Git tree, [Skills roadmap](../skills/ROADMAP.md), [pinned 30-skill gap audit](2026-10-28-skills-gap.md), open Runtime [PR #16](https://github.com/m-amirov/ludory/pull/16) and [PR #17](https://github.com/m-amirov/ludory/pull/17), and the R1–R7 plan in #16. This report does not change any game, SDK or Runtime code.

## What is actually available

| Boundary | Observed at audited SHA | Consequence for S3 |
| --- | --- | --- |
| Core | `packages/core`: platform-neutral session/definition/state, Node tests | Source-level mechanics checks exist; no browser lifecycle/input/viewport evidence |
| Studio | `web-basic` and `narrative-basic` templates, new-game scaffold and synthetic test fixtures | Template HTML is not proof of the planned Runtime host or current-build player behavior |
| Runtime on `main` | **No `packages/runtime` and no `packages/runtime-phaser` tree** | Cannot certify S3 host-based mobile, accessibility, audio, performance or web playtest |
| Runtime contract [PR #16](https://github.com/m-amirov/ludory/pull/16) | **Open Draft**, head `f05775e268c3f5674589fbc232cc48bbe5dd3604`, docs only, based on older `3382691` | Revised R1–R7 spec exists but is **not part of `main`** |
| Runtime R1 [PR #17](https://github.com/m-amirov/ludory/pull/17) | **Open Draft**, head `a563c70a066acc0a7c297870037bb1895dd5df9d`, base = PR #16 branch; validators/contracts only | R1 lacks `createRuntimeHost`, scheduler, input queue, persistence engine, browser adapter or observed game |
| CI for #16 and #17 | Exact historical heads: **4/4 Ubuntu/Windows Node 22/24 success**; [#16 run `40640631524`](https://github.com/m-amirov/ludory/actions/runs/40640631524), [#17 run `40648718165`](https://github.com/m-amirov/ludory/actions/runs/40648718165) | Green *at those heads*, not a test of integration with latest `main` or actual browser/device |
| Merge safety | Local `git merge-tree --write-tree` of both historical heads against audited `main` returned a tree without a textual conflict | **Not** permission to merge, semantic review, runtime acceptance or proof that `main` now contains R1 |
| Connect / Release | No target SDK or independent release implementation | No S3 check may issue Yandex/VK or Release PASS |

**Stacked-PR caution:** #17 targets the #16 feature branch, not `main`. Owner-approved integration must review/land #16 before retargeting/reconciling #17, then run fresh exact-commit CI against the current merged base. Never silently merge the R1 branch into its historical parent or replace current first-party skill files with the older branch snapshot. No approval to merge #16/#17 is inferred from advancing S3 analysis.

## Dependency-based S3 sequence (proposed, not approved)

| Deferred Starter Kit capability | Minimum evidence prerequisite | Earliest honest S3 action |
| --- | --- | --- |
| `mobile-game-ux` | Runtime R2 host, R3 normalized input/viewport, **R6 locally bundled new Studio game**; browser/mobile emulation recordings and exact build/viewport | **First candidate:** narrow `ludory-mobile-ux` evidence contract *after* R6; no PASS based on static CSS/source tests |
| `game-accessibility` | Rendered focus/keyboard/touch flow, DOM/a11y tree or supported canvas semantics, actual browser observations, target locale and reduced-motion paths | Next separate optional contract after R6; source lint/contrast estimates remain advisory |
| `web-game-playtest` | R6 playable local build, pause/focus/reload/asset errors and fresh Chromium/Firefox/WebKit observation | Separate check on current build, not a claim of real device coverage |
| `game-audio-quality` | R4 audio/browser adapters + R6 autoplay permission/unlock, mute/pause/resume observations | After audio is actually wired; no automatic ad SDK requirement before Connect |
| `game-performance-budget` | R2 scheduling + R6 reproducible browser build, measured frame/memory/startup trace and **game-provided budget** | Measured benchmark contract; do not invent universal FPS/CPU budgets |
| `game-feel-polish` | Responsive input-to-feedback path, display timing evidence and optional consented player feedback | Separate measured/qualitative review; not a mechanical enjoyment PASS |
| `product-quality-review` | Playable vertical slice with game-defined first-minute goals, cold-read/task evidence and unprimed player method | Last product-evidence review; a synthetic model is not a real player |

**Release/media is S5, not S3.** CEOS `prod-check`, `release`, video and Starter Kit release/Yandex validation remain blocked until independent Connect/Release evidence exists.

## First S3 vertical-slice contract: entry conditions

Do not create the first S3 `SKILL.md` before the owner approves its narrow design and the following current-game facts exist:

1. **Current native build:** a new, authorized Studio game, traceable source commit, exact emitted local ESM/browser-bundle SHA-256 and current entrypoint. No CDN-only placeholder, guessed generated build or frozen source game.
2. **Runtime behavior:** observed R2–R3 lifecycle/input/viewport and R6 browser startup; input actually reaches the playable game, and pause/resize/resume have deterministic observations. R4 persistence and optional audio are separately scoped, not silently assumed.
3. **Captured proof:** precise browser engine/version, viewport CSS dimensions and DPR, touch/keyboard event route, orientation/resize/focus sequence, readable screenshots or a trace with exact hashes, expected vs observed behavior and reproducible route/seed.
4. **Platform/device boundaries:** desktop browser simulation and mobile emulation are named as such. Actual Android/iOS hardware remains `NOT_RUN` absent a real device; no claim of native tap latency or performance from source-only tests.
5. **Safety:** CEOS/Starter Kit and existing games frozen, Core free of browser/SDK/Phaser dependencies, no hidden project mutation, personal data, paid remote calls or publication. Failure/unknown/blocked outcomes must remain distinct.

### Candidate acceptance states

- `SOURCE_CHECKED` — exact code/contract/source binding only; not playable browser evidence.
- `BROWSER_OBSERVED` — named checks observed against bound current build and browser/version/viewport; not a blanket game PASS.
- `EMULATED_MOBILE` — mobile input/viewport in supported browser emulation, **not** real device proof.
- `BLOCKED_RUNTIME` / `BLOCKED_BUILD` — required current implementation or bundle missing.
- `NOT_RUN` — requested browser/device or human check not performed.
- `NOT_APPLICABLE` — audio, orientation or other mechanic outside the approved game scope.

These are candidate **evidence-modality/availability labels**, not defect verdicts or new Runtime/AI schema enums. `BROWSER_OBSERVED` and `EMULATED_MOBILE` say **where/how a check was witnessed**, even when the observed behavior **fails**. For each criterion, record a **separate** `PASS` / `FAIL` / `BLOCKED` decision with expected and actual behavior; `NOT_RUN` remains an absence-of-check status. None implies Release acceptance. A later spec must reconcile them with existing `ludory-verification` and `ludory-visual-qa` owners to prevent duplicate criteria or screenshot-review loops.

## Owner decision gate

**Recommended product-first path:** separately review and accept the Runtime v2 design/R1 branch stack **#16 → #17**, with fresh integration verification, then explicitly authorize R2. Follow **R3, R4, R5 and R6 in the currently proposed order**. Complete R6 acceptance, as presently written, includes save/reload and autoplay-denial browser tests that require the applicable R4 persistence/audio work; R5 is a separately planned Phaser-adapter milestone. **Skipping, reordering or narrowing R4/R5/R6 requires a new reviewed design decision**—a partial browser fixture cannot silently be called R6 complete. Only with an actual browser vertical slice prepare the **first** S3 `ludory-mobile-ux` contract and its independent evidence fixtures. Do not batch “S3 all seven skills” without working Runtime.

Alternatives: (a) a documentation-only blocked S3 skill now would add an entrypoint but no usable player-quality evidence; (b) a narrowly scoped **source-only accessibility advisory** could be proposed independently, but must not be called runtime accessibility PASS. Neither substitutes for R6. The owner must choose before implementation or integration. **No Runtime PR merge, R2 code, S3 skill or Release operation is authorized by this audit.**
