# F1b — Native AI workflow acceptance evidence (2026-10-30)

**Scope:** F1b of the approved [Ludory 1.0 design](../superpowers/specs/2026-10-30-ludory-v1-completion-design.md), following F1a (merged PR #46). This is an **evidence index, not a combined F1 sign-off, game release or real-host attestation**.

## Tested identity and environment

- Starting `origin/main`: `567e2889de08eabc66042127bc2548c624a4cef5` (PR #46 already merged); F1b isolated worktree `feat/f1b-ai-workflow-reliability`.
- Candidate changes include `3019559` (Web DEV v2 preflight), `39742db` (interruption regression), `4e6f51e` (F1b contracts) and `520a4b9` (art-review intent/recovery), followed by an independent-review correction for filesystem durability, v2 capability authenticity and art-ledger races. **Final published HEAD and Linux/Windows CI receipts are publication gates; no CI or Windows PASS is asserted here.**
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
| Art-review preflight object spoofing | `CONTRACT_PASS` | A valid legacy capability with inherited or accessor-only v2 routing and preflight fields previously could authorize a visual browser call. New `ownData` checks reject both before writing a paid intent; the negative test failed before the correction and passed afterward. |
| Image/source change between plan and execute | `CONTRACT_PASS` | Existing art/narrative tests recheck bound brief, image, sources and run head, fail closed on stale bytes and altered host result. |
| Narrative + art verdict | `CONTRACT_PASS` | Existing parser/ledger tests require exact draft/image SHA, grounded findings and observed host response; unknown evidence remains `BLOCKED`, no automatic stage advance or Release PASS. |

Command: `node --test --test-isolation=none packages/ai/test/task-routing.test.mjs packages/ai/test/dev-host.test.mjs packages/ai/test/art-review.test.mjs packages/ai/test/narrative-review.test.mjs packages/ai/test/draft-tasks.test.mjs` — **96/96 PASS**, process-capable local Linux runner after independent-review corrections. Restricted filesystem sandbox alone cannot spawn the DEV helper fixtures and produces environmental false negatives; the process-capable rerun was green.

## Native interruption, replay and file safety

| Boundary | Outcome category | Evidence |
| --- | --- | --- |
| Start/continue preview and stale apply | `CONTRACT_PASS` | Preview has no effects; start plan and event commits reject stale source, replay and tampered hash. |
| Multiple active runs | `CONTRACT_PASS` | Unqualified `latest` blocks ambiguous selection; explicit run IDs and cross-run executor event checks prevent wrong-run publication. |
| Crash after durable request / before result | `CONTRACT_PASS` | New regression leaves `ACTION_REQUESTED` pending, blocks repeated executor launch, requires explicit `recover --confirm-no-executor`, records `EXECUTOR_INTERRUPTED`, rejects replay and preserves untracked owner note plus partial source edit. This already passed; **no production recovery change was necessary**. |
| Uncertain Web DEV / ImageGen outcome | `CONTRACT_PASS` | Existing `draft-tasks`, `image-tasks`, narrative and store tests require owner confirmation to append failure; no hidden paid retry or synthetic success. |
| Visual art-review timeout and idempotency | `CONTRACT_PASS` | F1b follow-up adds a SHA-chained `ART_REVIEW_REQUESTED` event *before* any `host.turn`; a timeout/partial attestation remains `ART_REVIEW_PENDING`, and a second invocation cannot submit. `workflow recover --confirm-no-executor --apply` appends `ART_REVIEW_INTERRUPTED` without touching user edits. An already witnessed receipt with a missing terminal event closes as `ART_REVIEW_OBSERVED`, while a late result after owner recovery cannot create a receipt. Exactly one artistic receipt per request. Local contract doubles only; no live browser call. |
| Native art journal, revised owner-approved contract | `CONTRACT_PASS` (local only) | Art request and result event/commit files are `fsync`-flushed before Web DEV submission. File-flush and commit-link fault injection forbids host calls; missing directory `fsync` no longer blocks Windows. A power cut can lose metadata; the contract now covers process interruption and explicit recovery, **not physical power-loss durability**. CI on the revised HEAD remains required. |
| Art-ledger and recovery concurrency | `CONTRACT_PASS` | A stale interrupted-recovery plan is rejected if its matching witnessed receipt appears before application; replanning retains `ART_REVIEW_OBSERVED`. Replay of new-format observed terminal events cross-checks receipt existence and exact SHA; deleting the artistic ledger cannot turn a previously paid review into a new request. Legacy pre-request artistic receipts remain readable. |
| Abrupt process death during native publication | `BLOCKED` | A killed writer can leave an obsolete `.lock`, a `.pending-*` temporary name or an incomplete event/artistic-receipt pair. The current strict reader blocks all subsequent host calls, but **there is not yet an owner-verified quarantine/reconciliation procedure for these crash artifacts**. A failing commit-link fault test proves the fail-closed state, not successful cleanup or safe restart. Do not claim F1b crash recovery is complete or merge-ready until bounded repair and termination tests exist. |
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
| Real-host visual-review timeout and recovery | `BLOCKED` | The **local** durable-intent contract now has a regression; the process-termination assertion is owner-provided and cannot independently prove that a paid browser operation stopped. Real authenticated helper interruption and recovery on Windows remain unobserved. Do not retry unattended or infer a host PASS from these tests. |
| Windows process-interruption recovery | `CONTRACT_PASS` local, exact-head CI pending | Explicit recovery preserves recognized orphan event/review files and dead process locks under `.recovered-*` names in their pinned source directories' parents (outside strict journal reader namespaces), using relative hard-link/unlink without a mutable quarantine destination. Real child-process SIGKILL, source/destination substitution and forged recovered-name regressions are covered. The standard writer lock guards recovery moves. Power-cut persistence is outside owner-approved scope. Revised-head Windows Node 22/24 CI remains required. |
| Real Windows/NTFS host interrupted-process and browser/audio tests | `BLOCKED` | Exact candidate SHA on Windows with helper and physical/device browser acceptance. Linux local fixtures do not certify this. |
| Complete Release/Connect/Runtime gates | `BLOCKED` | Downstream F2–F6 plan gates; F1b neither exercises SDKs nor authorizes publication. |

No live host call was launched to force a green cell. Host-response fixtures are **test doubles**, not `HOST_OBSERVED_PASS`. There are currently **zero** real-host PASS receipts for this phase.

**Existing compatibility risk (not fixed in F1b):** manual `workflow start --apply` can still create a native run in a non-Studio project. `hasStudioCreationReceipt` checks local marker structure, not cryptographically proven project origin. Direct executor/image/review calls enforce their Studio receipt checks, but users must **not** run manual workflow mutation on frozen legacy games. Tightening creation provenance while preserving legitimate dirty/unversioned Studio games needs a separately scoped migration-safe design.

## Old Draft PR comparison (no mutation)

- [PR #5](https://github.com/m-amirov/ludory/pull/5): still **open Draft**, unmerged, non-mergeable at inspection. It adapts CEOS 0.5.40 via `--ceos-entry`; merged `main` uses native `ludory-ai` workflows and explicitly rejects the CEOS passthrough. Its legacy integration would reintroduce a prohibited dependency; **leave untouched**, do not cherry-pick or close automatically.
- [PR #11](https://github.com/m-amirov/ludory/pull/11): still **open Draft**, unmerged, non-mergeable at inspection. Its early routing slice selects Terra as default image provider; merged `main` uses `codex-imagegen` agent handoff with no observed model ID, while retaining explicit legacy pins. The current routing and safety tests supersede its earlier contract; **leave untouched**, no merge/close without owner decision.

## Acceptance decision

Post-review local verification on the complete pre-publication tree: `npm test` **exit 0** (655 tests: 642 PASS, 13 OS-specific SKIP; Engineering Quality integration 17/17 PASS), `npm run check` **exit 0**, `node examples/core-session.mjs` and `git diff --check` **exit 0**. Separate AI source/routing/art regression set: **96/96 PASS**. Tests do not attest the GitHub published HEAD; Windows CI and real-host execution remain separate gates.

F1b local capability and ordinary timeout/recovery contracts: **verified in Linux fixtures**, including the additional fail-closed publication and cross-ledger checks. **F1b final acceptance / F1 combined acceptance / real-host validation / platform release: BLOCKED** by the incomplete crash-artifact reconciliation, missing observed text-host support, real-host receipts and exact-head Linux+Windows CI. No real Web DEV or ImageGen release gate is inferred from contract tests. Draft PR must remain unmerged until the blockers are resolved, reviewed and separately approved by the owner.
