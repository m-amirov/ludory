# F1b — Native AI workflow acceptance evidence (2026-10-30)

**Scope:** F1b of the approved [Ludory 1.0 design](../superpowers/specs/2026-10-30-ludory-v1-completion-design.md), following F1a (merged PR #46). This is an **evidence index, not a combined F1 sign-off, game release or real-host attestation**.

## Tested identity and environment

- Starting `origin/main`: `567e2889de08eabc66042127bc2548c624a4cef5` (PR #46 already merged); F1b isolated worktree `feat/f1b-ai-workflow-reliability`.
- Candidate changes: `3019559` (Web DEV v2 preflight safety), `39742db` (Codex interruption regression), followed by this fixture/evidence change. **The final candidate HEAD and Windows CI receipts must be captured after publication; none is asserted in this pre-publication document.**
- Local environment: Linux x86_64, kernel `6.18.57`, Node `v24.22.1`, npm `11.9.0`. These are *not* a Windows host test.
- Test fixture ID: `f1-native-ai`, a new game created via Studio CLI in an isolated temporary directory; no Git initialization. The foreign fixture `frozen-legacy-game` contains user-like data and no Studio receipt.
- Selected text source: `scene-brief.md`, UTF-8, SHA-256 `a3c2a6ed34aad14224c8fc5b3cc159c8e342df24ce3e19fc648fe102020fe3b0`.
- Source of executable evidence: [`packages/studio/test/f1-ai-fixture.test.mjs`](../../packages/studio/test/f1-ai-fixture.test.mjs) and its [CLI fixture runner](../../packages/studio/test/helpers/f1-ai-fixture.mjs). Per-run temporary paths/IDs are deliberately deleted after the tests, so these tests do **not** produce permanent host receipts.

## Contract matrix — new Studio game, no external helper

All commands below run against a newly created test game with the same relative arguments as the fixture runner. Replace `<GAME>` and `<RUN>` with the temporary test project and returned run ID. Every command is called through the real Studio `runCli` boundary; no DEV or ImageGen host is injected.

| Exact command shape | Outcome category | Observed result / receipt or blocker |
| --- | --- | --- |
| `create --project <GAME> --id f1-native-ai --title 'F1 Native AI' --lang en --profile web-game --template web-basic --targets yandex-games --apply --json` | `CONTRACT_PASS` | `APPLIED`; Studio creation metadata on the **new fixture only**. |
| `workflow doctor --project <GAME> --json` | `CONTRACT_PASS` | `OK`; no Git HEAD; read-only inspection. |
| `workflow route --project <GAME> --task episode-script --json` | `BLOCKED` | `NEEDS_USER_ACTION`; no authenticated Web DEV helper, route `manual`. |
| `workflow route --project <GAME> --task image --json` | `CONTRACT_PASS` | `NEEDS_AGENT_ACTION`, `codex-imagegen`, `modelObserved:null`; no assertion that the tool ran. |
| `workflow route --project <FROZEN> --task episode-script --json` | `BLOCKED` | `AI_ROUTING_STUDIO_GAME_REQUIRED`; frozen foreign tree digest unchanged. |
| `workflow start --project <GAME> --pipeline production-art --target 'F1 Scene' --in-scope scene-brief.md --acceptance 'owner-visible source-bound receipts' --mutation-boundary 'new fixture only' --json` | `CONTRACT_PASS` | `READY`; did not create native run storage. |
| Same `workflow start` command with `--apply` | `CONTRACT_PASS` | `APPLIED`, run ID and native `ACTIVE` status; new fixture only. |
| `workflow status/next/continue --project <GAME> --run <RUN> --json` | `CONTRACT_PASS` | `ACTIVE` / `PERFORM_STAGE` / `READY` preview; no executor request written. |
| `workflow image --project <GAME> --run <RUN> --brief scene-brief.md --json` (also with `--apply`) | `CONTRACT_PASS` | SHA-bound ImageGen agent packet, `NEEDS_AGENT_ACTION`; `--apply` did not launch a host or write a workflow event. |
| `workflow draft --project <GAME> --run <RUN> --task episode-script --brief scene-brief.md --json` | `BLOCKED` | `NEEDS_USER_ACTION`; manual handoff, no real Web DEV session. |
| `workflow narrative-review --project <GAME> --run <RUN> --json` | `BLOCKED` | `REVIEW_EPISODE_DRAFT_REQUIRED`; no invented narrative `ACCEPT`. |
| `workflow art-review --project <GAME> --run <RUN> --image candidate.png --json` | `BLOCKED` | `ART_IMAGE_NOT_IMPORTED`; no invented `PASS_ART`. |
| `workflow recover --project <GAME> --run <RUN> --json` | `BLOCKED` | `NATIVE_RECOVERY_NO_PENDING_EXECUTOR`; cannot recover a request that never existed. |
| `quality status --project <GAME> --json` | no PASS | Policy-status preview only; no Quick/Deep or Release PASS inferred. |

**Proofs:** `node --import ./packages/studio/test/setup-trust-env.mjs --test --test-isolation=none packages/studio/test/f1-ai-fixture.test.mjs` — **1/1 PASS**, Linux. New-game run contained zero executor events after all previews and ImageGen handoff. The foreign game `owner-data.txt`, manifest, and complete two-file digest remained byte-identical; no `.ludory` namespace was created there. The test injected a DEV host that throws if invoked, and counted **zero invocations**.

## AI routing, binding and review safety

| Boundary | Outcome category | Evidence |
| --- | --- | --- |
| Web DEV v2 authorization | `CONTRACT_PASS` | New table-driven regression: `{preflight:{}}`, unauthenticated, reused chat, unobserved Sol entitlement, missing URL and accessor-based authentication are all rejected. The empty-preflight case **failed before the patch**, then passed after `3019559`; its previous `READY` was a real defect. |
| Legacy model-route / entitlement / pin selection | `CONTRACT_PASS` | Existing routing tests reject wrong model, missing verified transport/entitlement, inherited getters and revoked proxies; pinned Terra never silently falls back to Sol. |
| Vendored v2 text turns | `BLOCKED` | The v2 helper's `browser_observation_v2` is image-attached-only; preflight does **not** establish the selected model for text. The earlier code could report `READY` but its actual text turn would fail. F1b now returns `AI_ROUTING_WEB_TEXT_V2_UNSUPPORTED`, `DEV_TEXT_V2_UNSUPPORTED` or `REVIEW_WEB_TEXT_V2_UNSUPPORTED` without making a host request. Legacy text-route compatibility is preserved. Enabling v2 text requires a separately approved host protocol/implementation with genuinely witnessed model selection. |
| Web DEV helper/visual observation | `CONTRACT_PASS` | Mock-helper tests require submitted prompt, observed selected model, binary attachment bytes, trace ID, and successful processing observation. **Mocked frame protocols do not equal a real browser session**. |
| Image/source change between plan and execute | `CONTRACT_PASS` | Existing art/narrative tests recheck bound brief, image, sources and run head, fail closed on stale bytes and altered host result. |
| Narrative + art verdict | `CONTRACT_PASS` | Existing parser/ledger tests require exact draft/image SHA, grounded findings and observed host response; unknown evidence remains `BLOCKED`, no automatic stage advance or Release PASS. |

Command: `node --test --test-isolation=none packages/ai/test/task-routing.test.mjs packages/ai/test/dev-host.test.mjs packages/ai/test/art-review.test.mjs packages/ai/test/narrative-review.test.mjs packages/ai/test/draft-tasks.test.mjs` — **82/82 PASS**, process-capable local test runner after the v2 fail-closed changes. Restricted filesystem sandbox alone cannot spawn the DEV helper fixtures and produces environmental false negatives; the process-capable rerun was green.

## Native interruption, replay and file safety

| Boundary | Outcome category | Evidence |
| --- | --- | --- |
| Start/continue preview and stale apply | `CONTRACT_PASS` | Preview has no effects; start plan and event commits reject stale source, replay and tampered hash. |
| Multiple active runs | `CONTRACT_PASS` | Unqualified `latest` blocks ambiguous selection; explicit run IDs and cross-run executor event checks prevent wrong-run publication. |
| Crash after durable request / before result | `CONTRACT_PASS` | New regression leaves `ACTION_REQUESTED` pending, blocks repeated executor launch, requires explicit `recover --confirm-no-executor`, records `EXECUTOR_INTERRUPTED`, rejects replay and preserves untracked owner note plus partial source edit. This already passed; **no production recovery change was necessary**. |
| Uncertain Web DEV / ImageGen outcome | `CONTRACT_PASS` | Existing `draft-tasks`, `image-tasks`, narrative and store tests require owner confirmation to append failure; no hidden paid retry or synthetic success. |
| Frozen/foreign project | `CONTRACT_PASS` | Direct Codex, image, art and route tests block operations without the Studio receipt; foreign fixture routes are read-only. Manual workflow compatibility for preexisting native projects must **not** be mistaken for authorization to run against real frozen games. |

Command: `node --test packages/ai/test/workflows.test.mjs packages/ai/test/store.test.mjs packages/studio/test/native-workflow-cli.test.mjs` — **47/47 PASS**, process-capable local test runner.

## Real-host and release gates (not exercised)

| Missing gate | Outcome category | What would resolve it |
| --- | --- | --- |
| Authenticated isolated DEV Web session with actual selected `chatgpt-web/gpt-6-sol`, reasoning high | `BLOCKED` | Owner-authorized real session, successful helper probe and source-bound browser receipt. Not attempted from the fixture. |
| Actual narrative-generation and independent review turns | `BLOCKED` | Two independent observed Web DEV turns for a fresh game; preserve individual request/result SHA receipts. |
| Vendored v2 text-only observed model evidence | `BLOCKED` | New helper support for *text-only* browser-observed turns; current v2 implementation can witness image inputs only. Do not work around the protocol with fabricated model fields. |
| Actual Codex-native image agent calling session-only `$imagegen` | `BLOCKED` | A separate authorized Codex subagent plus actual image bytes and declared import receipt. The CLI alone cannot invoke it. |
| Independent visual review with real binary browser upload evidence | `BLOCKED` | Authenticated v2 helper `image_attached`/processing trace, matching SHA, model, reasoning and source context. |
| Visual-review timeout/idempotency | `BLOCKED` | **Known P1:** `executeArtReview` writes the final witnessed receipt *after* the external host turn, with no durable pre-turn intent. On a crash/timeout a second `art-review --apply` can repeat a possibly charged review. A source/run-bound append-only request+recovery mechanism with explicit stopped-host confirmation is required before unattended retries or real-host sign-off. Existing draft/narrative recovery checks do not cover this path. |
| Real Windows/NTFS host interrupted-process and browser/audio tests | `BLOCKED` | Exact candidate SHA on Windows with helper and physical/device browser acceptance. Linux local fixtures do not certify this. |
| Complete Release/Connect/Runtime gates | `BLOCKED` | Downstream F2–F6 plan gates; F1b neither exercises SDKs nor authorizes publication. |

No live host call was launched to force a green cell. Host-response fixtures are **test doubles**, not `HOST_OBSERVED_PASS`. There are currently **zero** real-host PASS receipts for this phase.

**Existing compatibility risk (not fixed in F1b):** manual `workflow start --apply` can still create a native run in a non-Studio project. `hasStudioCreationReceipt` checks local marker structure, not cryptographically proven project origin. Direct executor/image/review calls enforce their Studio receipt checks, but users must **not** run manual workflow mutation on frozen legacy games. Tightening creation provenance while preserving legitimate dirty/unversioned Studio games needs a separately scoped migration-safe design.

## Old Draft PR comparison (no mutation)

- [PR #5](https://github.com/m-amirov/ludory/pull/5): still **open Draft**, unmerged, non-mergeable at inspection. It adapts CEOS 0.5.40 via `--ceos-entry`; merged `main` uses native `ludory-ai` workflows and explicitly rejects the CEOS passthrough. Its legacy integration would reintroduce a prohibited dependency; **leave untouched**, do not cherry-pick or close automatically.
- [PR #11](https://github.com/m-amirov/ludory/pull/11): still **open Draft**, unmerged, non-mergeable at inspection. Its early routing slice selects Terra as default image provider; merged `main` uses `codex-imagegen` agent handoff with no observed model ID, while retaining explicit legacy pins. The current routing and safety tests supersede its earlier contract; **leave untouched**, no merge/close without owner decision.

## Acceptance decision

Initial branch-wide verification: `npm test` **exit 0** (including Quality integration 17/17), `npm run check` **exit 0**, `node examples/core-session.mjs` **exit 0**, `git diff --check` **exit 0**. These checks will be rerun/linked to the **exact published candidate commit** for the merge gate.

F1b local capability and core recovery contracts: **partially verified in Linux fixtures**; root-cause Web DEV preflight fix and explicit v2 text blockers included. **F1b final acceptance / F1 combined acceptance / real-host validation / platform release: BLOCKED** by visual-review timeout replay safety and missing observed text-host support, in addition to exact-head Linux+Windows CI and owner-authorized host receipts. PR must remain unmerged until these blockers are resolved and the owner separately authorizes merge.
