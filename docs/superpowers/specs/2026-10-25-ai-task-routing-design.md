# Ludory AI Task Routing: Codex, Web DEV, and Image Producers

**Status:** Approved by project owner on 2026-10-25; Slice C producer contract revised and approved on 2026-10-26.
**Date:** 2026-10-25
**Decisions already confirmed:** Prefer Web DEV to author source-aware artistic briefs **if** it genuinely has enough project context; otherwise the primary task model authors them. The separate **built-in Codex `$imagegen`** skill generates the pixels, with no OpenAI API integration or API key. Terra/SOL producer attestation is **not** a requirement for this default route. No CEOS runtime dependency.

## Purpose and user experience

Studio prepares a short, source-aware request and selects **one real executor per task**. The owner should not need to maintain long model-specific prompts or select a route by hand for the five common activities:

| Task | Preferred executor | Required outcome |
| --- | --- | --- |
| Implement game mechanics | Codex CLI | Code and bounded test evidence, not automatic acceptance |
| Write an episode script | Web DEV | Source-bound script artifact, pending narrative review |
| Develop an art concept | Web DEV with selected, verified project context; otherwise primary task model | Concept/brief artifact, source-bound, pending review |
| Generate images | Active Codex agent invoking built-in `$imagegen` | Source-bound prompt handoff, then imported image originals/hashes pending review |
| Check functionality | Codex plus independent tests | Machine-observed test results; release gates remain separate |

The existing `workflow start/continue/cycle/checkpoint/recover` system remains the single source of run state and the append-only receipt chain. No new top-level agent manager, broker service, recurring planning loop, or CEOS import is introduced.

## Considered approaches

1. **Chosen — small task router and host-bound adapters.** An explicit task kind chooses one existing host capability, runs automatically when capability and account entitlement are verified, or prepares a manual handoff. Reuse native Ludory events. Slightly more initial integration work, but keeps everyday commands short and verifiable.
2. Manual-only dispatch packets. Fast and robust for unavailable hosts, but requires the owner to copy requests and results for every narrative and art task, conflicting with the goal of simplifying the process.
3. General multi-agent provider orchestrator. Might offer extensive fallback combinations but would reintroduce CEOS complexity, hidden model substitutions, and difficult recovery; rejected for this phase.

## Minimal architecture and boundaries

### 1. Explicit task contracts and routing

- Record one versioned `taskKind` (`mechanics`, `episode-script`, `art-concept`, `image`, `functional-check`) in a native task request. Routing is deterministic and inspectable; the system does not infer a different task type from arbitrary prose when it would change executor authority.
- A pure read-only plan reports requested kind, selected route, why it is eligible, expected inputs and outputs, and whether execution is `READY`, `NEEDS_AGENT_ACTION`, `NEEDS_USER_ACTION`, or `BLOCKED`.
- One task invokes one route. The **brief author** and **image generator** are different tasks with independently recorded provenance; no automatic second paid attempt or provider switch after an uncertain execution.
- For tool-mediated images, the CLI emits an agent handoff and never claims tool availability or execution. Model availability and entitlement belong to the active Codex session; no automatic invocation from Node.js.
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
- For visual tasks, provide **only selected and hash-bound story, character, location, style and scene references**. Web DEV takes priority only when those references and the usable authenticated host suffice for a coherent artistic brief. If Web DEV is unavailable or cannot be given adequate context, the *primary model executing the task* writes the artistic brief in its existing session, and passes a reviewed text file to image production. A standalone CLI must not pretend to have the primary conversation model; it emits a source-bound handoff instead. Source text and model declarations alone are not artistic approval.
- Keep text and creative-art evidence outside the release verifier. Malformed, missing, or foreign evidence fails closed.

### 4. Image-generation route (Codex built-in `$imagegen`)

- The image generation actor is **Codex's built-in `$imagegen`**, independently of the model that composed the prompt. Do **not** require the primary model, Terra or SOL to generate pixels. The built-in tool currently does not expose model or quality parameters; never infer a hidden effective model name.
- The first stage produces a context-aware, readable art brief with scene/character/style consistency references and acceptance criteria. The brief must be inspected and its file hash bound to the image request before generation. A Web DEV result and a primary-model result are not interchangeable provenance claims; each carries its actual source.
- The second stage prepares a bounded, SHA-256-bound skill packet from the approved brief. `workflow image` and `--apply` do not perform a network call or journal a false execution; they return `NEEDS_AGENT_ACTION`, `selectedRoute: codex-imagegen`, `nextAction: CALL_IMAGEGEN_SKILL`. The active Codex agent must invoke the actual built-in skill using that packet and selected project references.
- Model selection is `provider-default`, model observation is `null`; ask for the **highest available quality** in the art prompt, including reference fidelity and composition requirements. This quality preference is not a programmable slider or verified model property. No explicit model pin is offered in default CLI routing.
- No OpenAI API, API key, endpoint, HTTP retry or billable transport adapter is part of this slice. Do not silently fall back to a separate paid provider if the skill is unavailable. Agent tool invocation is governed by its own Codex session limits.
- After actual tool output, the agent saves PNG/JPEG/WebP originals inside the new Studio game and explicitly calls `workflow image-import --apply`. Import captures task/run ID, brief hash, input file hash, immutable original output path, SHA-256, format and decoded dimensions. Reject zero-byte, truncated, off-scope or malformed images, including invalid JPEG/WebP decode. Optimized runtime versions require separate checks.
- The CLI cannot independently attest tool invocation: its import is truthfully `USER_DECLARED`, not `HOST_OBSERVED`, and remains `PENDING_REVIEW`. Never fabricate binary assets, model attestation or a `PASS` merely because a packet was emitted.
- Image quality, scene consistency, rights and final release acceptance remain separate, evidence-based checks. Avoid endless cosmetic rework: block material P0/P1 contradictions first.

### 5. State and safe continuation

- Reuse the existing native append-only request/result event chain and project-bound receipts. Add only the minimum versioned fields needed to distinguish task kind, chosen route, execution source, result artifacts, hashes and manual handoff.
- A pending automatic request blocks conflicting starts and checkpoints. After an interruption, recovery cannot assume an old DEV/Codex producer is stopped; the operator must explicitly confirm or resolve the pending executor before retry.
- No source history import from CEOS; no writes to frozen games, `.ceos-runs`, or legacy Starter Kit configuration. Development may run on unversioned new games; do not mandate clean Git for everyday work.
- Keep secret material and raw reasoning out of the ledger. Store only minimal model/transport facts and artifact hashes; any optional full response archive must be explicitly scoped, redacted, and under the user's control.

## Delivery slices and acceptance

**Slice A — route planner:** five task kinds, deterministic mapping, capability discovery interface, read-only CLI preview, unsupported-route/fallback codes and tests. No model invocation. Existing Codex workflows unchanged.

**Slice B — DEV narrative:** automatic DEV text transport only where installed host capabilities are verified; explicit manual packet/import fallback, source-bound reviewable script drafts, narrative/consistency gate before separate game-scene integration, and failure/recovery regression coverage. Windows host smoke mandatory before MVP merge.

**Slice C — image production:** source-aware Web DEV / primary-model artistic-brief handoff, dedicated built-in Codex `$imagegen` tool handoff (no external API), provider-default model with highest available quality requested in prompt, full decoded binary integrity, review-only original import, no false tool attestation. Host-observed real generation requires an actual agent tool run; no broad multi-provider framework.

**Slice D — independent validation:** functional tests bound to actual files, narrative/art review receipts, no invented verdict; release and platform checks remain separate projects.

For every slice: tests before code, Node 22/24 CI, Windows-host evidence for DEV/process behavior, preview mutation-free, no regression in native Codex execution, frozen legacy games untouched. `Release PASS` is forbidden without independent Yandex/VK and publication gates.

## Dependencies, risks, and non-goals

- The exact installed DEV launcher protocol and Web model entitlement may differ from CEOS's recorded DEV 6.1.11. Discover and validate the current host instead of hardcoding its version or assuming `gpt-6-sol` access.
- The current built-in ImageGen tool exposes no effective-model selector or attestation. Record `provider-default`/unknown rather than claiming the main model or Terra/SOL made the image. Do not introduce a separate API adapter.
- This phase does **not** implement unattended login, browser credential extraction, arbitrary agent scheduling, a background queue, autonomous release approval, or forced migration of existing games.
- PR #10's Windows component-update rollback failure is independent and must be resolved before integrating new features with the protected `main` workflow.
