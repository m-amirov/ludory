# Ludory AI Task Routing: Codex, Web DEV, and Image Producers

**Status:** Approved by project owner on 2026-10-25; Slice C producer contract revised and approved on 2026-10-26.
**Date:** 2026-10-25
**Decisions already confirmed:** Prefer Web DEV to author source-aware artistic briefs **if** it genuinely has enough project context; otherwise the primary task model authors them. A separate GPT Image agent/tool generates the binary image. Terra/SOL producer attestation is **not** a requirement for image generation. No CEOS runtime dependency.

## Purpose and user experience

Studio prepares a short, source-aware request and selects **one real executor per task**. The owner should not need to maintain long model-specific prompts or select a route by hand for the five common activities:

| Task | Preferred executor | Required outcome |
| --- | --- | --- |
| Implement game mechanics | Codex CLI | Code and bounded test evidence, not automatic acceptance |
| Write an episode script | Web DEV | Source-bound script artifact, pending narrative review |
| Develop an art concept | Web DEV with selected, verified project context; otherwise primary task model | Concept/brief artifact, source-bound, pending review |
| Generate images | Dedicated GPT Image agent/tool or authenticated GPT Image API adapter | Original image files and hashes, pending artistic review |
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
- One task invokes one route. The **brief author** and **image generator** are different tasks with independently recorded provenance; no automatic second paid attempt or provider switch after an uncertain execution.
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
- For visual tasks, provide **only selected and hash-bound story, character, location, style and scene references**. Web DEV takes priority only when those references and the usable authenticated host suffice for a coherent artistic brief. If Web DEV is unavailable or cannot be given adequate context, the *primary model executing the task* writes the artistic brief in its existing session, and passes a reviewed text file to image production. A standalone CLI must not pretend to have the primary conversation model; it emits a source-bound handoff instead. Source text and model declarations alone are not artistic approval.
- Keep text and creative-art evidence outside the release verifier. Malformed, missing, or foreign evidence fails closed.

### 4. Image-generation route (dedicated GPT Image)

- The image generation actor is **GPT Image**, independently of the model that composed the prompt. Do **not** require the primary model, Terra or SOL to also generate the image. A dedicated trusted Image Gen tool may expose only its default model; do not infer a hidden effective model name from that fact.
- The first stage produces a context-aware, readable art brief with scene/character/style consistency references and acceptance criteria. The brief must be inspected and its file hash bound to the image request before generation. A Web DEV result and a primary-model result are not interchangeable provenance claims; each carries its actual source.
- The second stage uses a narrow GPT Image adapter. For OpenAI Images API, `auto` requests **`gpt-image-2.5-sunburst`** for quality-first artwork; explicit `sunburst` or `flare` selection is supported where the API exposes it. The effective model must be recorded as **unknown** unless independently returned and verified by the actual provider; record the *requested* model separately. For a tool without a selector, retain `provider-default` as the selection instead of inventing a model identity. No Terra/SOL model attestation is required.
- A fully automated paid API call requires explicit operator execution (`--apply`), a configured API key and a separate per-session paid-call opt-in. The opt-in is **authorization**, not an enforceable dollar cap: estimates, billing and real budget checks remain the operator's responsibility. Without credentials/opt-in, offer manual generation/import and do not falsely claim an authenticated connection or completed work.
- The host adapter produces actual bounded image bytes and a receipt: task ID, brief hash, image route/provider, requested model, *observed model if truly observable*, immutable original image paths, SHA-256, format and decoded dimensions. Reject zero-byte, truncated, off-scope or malformed images, including invalid JPEG/WebP decode. Keep original image bytes; optimized runtime versions require separate checks.
- Journal the intent **before** any paid generation; one request permits at most one attempt. On timeout or ambiguous transport failure, leave the request pending until owner-confirmed recovery. No implicit alternate model, transparent retry or second charge.
- Image import remains a manual `USER_DECLARED` alternative. Never fabricate binary assets, effective-model attestation or a `PASS` merely because a tool was invoked.
- Image quality, scene consistency, rights and final release acceptance remain separate, evidence-based checks. Avoid endless cosmetic rework: block material P0/P1 contradictions first.

### 5. State and safe continuation

- Reuse the existing native append-only request/result event chain and project-bound receipts. Add only the minimum versioned fields needed to distinguish task kind, chosen route, execution source, result artifacts, hashes and manual handoff.
- A pending automatic request blocks conflicting starts and checkpoints. After an interruption, recovery cannot assume an old DEV/Codex producer is stopped; the operator must explicitly confirm or resolve the pending executor before retry.
- No source history import from CEOS; no writes to frozen games, `.ceos-runs`, or legacy Starter Kit configuration. Development may run on unversioned new games; do not mandate clean Git for everyday work.
- Keep secret material and raw reasoning out of the ledger. Store only minimal model/transport facts and artifact hashes; any optional full response archive must be explicitly scoped, redacted, and under the user's control.

## Delivery slices and acceptance

**Slice A — route planner:** five task kinds, deterministic mapping, capability discovery interface, read-only CLI preview, unsupported-route/fallback codes and tests. No model invocation. Existing Codex workflows unchanged.

**Slice B — DEV narrative:** automatic DEV text transport only where installed host capabilities are verified; explicit manual packet/import fallback, source-bound reviewable script drafts, narrative/consistency gate before separate game-scene integration, and failure/recovery regression coverage. Windows host smoke mandatory before MVP merge.

**Slice C — image production:** source-aware Web DEV / primary-model artistic-brief handoff, dedicated GPT Image provider adapter with a quality-first default, explicit billing opt-in, requested-versus-observed model distinction, decoded binary integrity, manual fallback, recovery, and host-observed art-file smoke when explicitly authorized. No broad multi-provider framework.

**Slice D — independent validation:** functional tests bound to actual files, narrative/art review receipts, no invented verdict; release and platform checks remain separate projects.

For every slice: tests before code, Node 22/24 CI, Windows-host evidence for DEV/process behavior, preview mutation-free, no regression in native Codex execution, frozen legacy games untouched. `Release PASS` is forbidden without independent Yandex/VK and publication gates.

## Dependencies, risks, and non-goals

- The exact installed DEV launcher protocol and Web model entitlement may differ from CEOS's recorded DEV 6.1.11. Discover and validate the current host instead of hardcoding its version or assuming `gpt-6-sol` access.
- A dedicated Image Gen tool may not expose an effective-model selector or attestation. In that case record `provider-default`/unknown rather than claiming the main model or Terra/SOL made the image. The OpenAI API adapter explicitly requests a named GPT Image model but does not turn the requested ID into an observed ID.
- This phase does **not** implement unattended login, browser credential extraction, arbitrary agent scheduling, a background queue, autonomous release approval, or forced migration of existing games.
- PR #10's Windows component-update rollback failure is independent and must be resolved before integrating new features with the protected `main` workflow.
