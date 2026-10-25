# Ludory AI Task Routing: Codex, Web DEV, and Image Producers

**Status:** Approved by project owner on 2026-10-25; implementation proceeds in separate reviewed slices.
**Date:** 2026-10-25
**Decisions already confirmed:** Prefer automatic, authenticated DEV execution when genuinely available, with an explicit manual handoff when it is not. For unpinned image tasks, prefer Terra and use SOL only if preflight cannot establish Terra availability; record the actual effective model. No CEOS runtime dependency.

## Purpose and user experience

Studio prepares a short, source-aware request and selects **one real executor per task**. The owner should not need to maintain long model-specific prompts or select a route by hand for the five common activities:

| Task | Preferred executor | Required outcome |
| --- | --- | --- |
| Implement game mechanics | Codex CLI | Code and bounded test evidence, not automatic acceptance |
| Write an episode script | Web DEV | Source-bound script artifact, pending narrative review |
| Develop an art concept | Web DEV | Concept/brief artifact, pending owner or independent review |
| Generate images | Image Gen capability through a verified SOL or Terra host | Real image files and hashes, pending artistic review |
| Check functionality | Codex plus independent tests | Machine-observed test results; release gates remain separate |

The existing `workflow start/continue/cycle/checkpoint/recover` system remains the single source of run state and the append-only receipt chain. No new top-level agent manager, broker service, recurring planning loop, or CEOS import is introduced.

## Considered approaches

1. **Chosen — small task router and host-bound adapters.** An explicit task kind chooses one existing host capability, runs automatically when capability and account entitlement are verified, or prepares a manual handoff. Reuse native Ludory events. Slightly more initial integration work, but keeps everyday commands short and verifiable.
2. Manual-only dispatch packets. Fast and robust for unavailable hosts, but requires the owner to copy requests and results for every narrative and art task, conflicting with the goal of simplifying the process.
3. General multi-agent provider orchestrator. Might offer extensive fallback combinations but would reintroduce CEOS complexity, hidden model substitutions, and difficult recovery; rejected for this phase.

## Minimal architecture and boundaries

### 1. Explicit task contracts and routing

- Record one versioned `taskKind` (`mechanics`, `episode-script`, `art-concept`, `image`, `functional-check`) in a native task request. Routing is deterministic and inspectable; the system does not infer a different task type from arbitrary prose when it would change executor authority.
- A pure read-only plan reports requested kind, selected route, why it is eligible, expected inputs and outputs, and whether execution is `READY`, `NEEDS_USER_ACTION`, or `BLOCKED`.
- One task invokes one route. A capability-based image fallback may select SOL **before execution begins** if Terra is unavailable; do not cascade between models after an execution failure, start multiple subagents, or consume another retry budget without an explicit new attempt.
- Model availability is discovered at execution time and cannot be inferred from a static config flag or from a task name. No model entitlement or executable means no automatic invocation.
- Extend the existing Studio workflow CLI with a small, discoverable task-kind option and an `auto` route while retaining current `--executor codex` compatibility. The detailed command syntax belongs in the implementation plan after repository review.

### 2. Native Codex route

- Reuse `packages/ai/src/executor.mjs` and the existing Node-test cycle. Do not create a second Codex adapter or claim that the `--in-scope` prompt is a hard filesystem allowlist.
- A test observed by Codex remains `EXECUTED_UNVERIFIED` until separately assessed. No automatic checkpoint or `PASS` promotion.

### 3. Authenticated Web DEV route

- Use the **installed, user-authorized DEV client** via its documented launcher/helper contract when discovery confirms a compatible executable, transport protocol, account entitlement and model route. CEOS's DEV transport is read-only reference material, not a runtime import.
- Web DEV creates narrative text and art concepts in this phase. An episode script is saved as a **separate reviewable draft**, not directly substituted into gameplay. Only after narrative/consistency validation succeeds does Ludory convert that accepted draft into game scenes, using a distinct, previewable and protected integration action. This is the owner's approved content flow. The Web model does not acquire arbitrary local filesystem or shell authority just because the browser model is selected.
- Input is a bounded request with task/run ID, game source identity, optional attachments and hashes, output schema, and acceptance criteria. The adapter verifies attachment bytes and selected model actually observed; returned text is not treated as proof of visual inspection or acceptance.
- Never copy browser cookies, tokens, DEV profiles, authenticated session files or raw reasoning into Ludory. Never fall back to direct CDP scraping or an unverified alternate provider.
- If the launcher/protocol/entitlement is unavailable, return `NEEDS_USER_ACTION` with a bounded manual task packet. The owner may explicitly supply results; Ludory verifies their paths and hashes but labels the model/transport provenance as user-declared rather than host-observed.
- Keep text and creative-art evidence outside the release verifier. Malformed, missing, or foreign evidence fails closed.

### 4. Image-generation route (SOL/Terra)

- SOL and Terra are **candidate producer models**, not image file generators. The selected host must demonstrate both an enforceable effective model route and a callable Image Gen capability within the same execution context before an automatic image task is allowed.
- For an image task without an explicitly pinned producer, perform read-only capability preflight in this order: **Terra → SOL → manual handoff**. Select SOL automatically only when Terra's model entitlement, enforceable route, or paired Image Gen capability cannot be verified **before any generation attempt**. Record both the requested preference and the effective, host-observed producer model and route.
- If the owner explicitly pins `Terra` or `SOL`, never replace that choice automatically: missing model/host/tool capability yields `NEEDS_USER_ACTION` or `BLOCKED` with the specific reason. If either selected automatic producer starts and then fails, do not silently retry through the other producer; a subsequent attempt must be explicit to avoid duplicate output and unaccounted generation cost.
- If neither Terra nor SOL can be verified alongside Image Gen at preflight, prepare a bounded manual-generation/import request. Imported images have explicitly labeled declared provenance; they do not claim host-observed Terra or SOL execution.
- For Terra, a config filename, child task name, or model string alone does not prove the running model. Require actual host-side model/role evidence where available. If that cannot be established, do not falsely claim Terra production.
- The host adapter produces actual bounded image bytes and a receipt: task ID, source/brief hash, claimed versus observed producer route, image paths, SHA-256, format and dimensions. Reject zero-byte, malformed, off-scope, or missing image artifacts. Preserve original images; downstream optimized runtime variants require separate validation.
- If an approved host tool or model identity cannot be verified, offer manual generation/import with explicit provenance limitations. Never fabricate PNGs, route attestations or a `PASS`.
- Image quality, scene consistency, rights and final release acceptance remain separate, evidence-based checks. Avoid endless cosmetic rework: block material P0/P1 contradictions first.

### 5. State and safe continuation

- Reuse the existing native append-only request/result event chain and project-bound receipts. Add only the minimum versioned fields needed to distinguish task kind, chosen route, execution source, result artifacts, hashes and manual handoff.
- A pending automatic request blocks conflicting starts and checkpoints. After an interruption, recovery cannot assume an old DEV/Codex producer is stopped; the operator must explicitly confirm or resolve the pending executor before retry.
- No source history import from CEOS; no writes to frozen games, `.ceos-runs`, or legacy Starter Kit configuration. Development may run on unversioned new games; do not mandate clean Git for everyday work.
- Keep secret material and raw reasoning out of the ledger. Store only minimal model/transport facts and artifact hashes; any optional full response archive must be explicitly scoped, redacted, and under the user's control.

## Delivery slices and acceptance

**Slice A — route planner:** five task kinds, deterministic mapping, capability discovery interface, read-only CLI preview, unsupported-route/fallback codes and tests. No model invocation. Existing Codex workflows unchanged.

**Slice B — DEV narrative:** automatic DEV text transport only where installed host capabilities are verified; explicit manual packet/import fallback, source-bound reviewable script drafts, narrative/consistency gate before separate game-scene integration, and failure/recovery regression coverage. Windows host smoke mandatory before MVP merge.

**Slice C — image production:** one host Image Gen adapter, Terra→SOL preflight fallback for unpinned tasks, strict pinned-model behavior, actual model verification, binary output checks, manual fallback and host-observed art file smoke. No broad multi-provider framework.

**Slice D — independent validation:** functional tests bound to actual files, narrative/art review receipts, no invented verdict; release and platform checks remain separate projects.

For every slice: tests before code, Node 22/24 CI, Windows-host evidence for DEV/process behavior, preview mutation-free, no regression in native Codex execution, frozen legacy games untouched. `Release PASS` is forbidden without independent Yandex/VK and publication gates.

## Dependencies, risks, and non-goals

- The exact installed DEV launcher protocol and Web model entitlement may differ from CEOS's recorded DEV 6.1.11. Discover and validate the current host instead of hardcoding its version or assuming `gpt-6-sol` access.
- An agent/model route cannot be guaranteed when the active host does not expose a trustworthy selector. SOL/Terra automation must block or switch to an explicitly labeled manual mode, never silently substitute another model.
- This phase does **not** implement unattended login, browser credential extraction, arbitrary agent scheduling, a background queue, autonomous release approval, or forced migration of existing games.
- PR #10's Windows component-update rollback failure is independent and must be resolved before integrating new features with the protected `main` workflow.
