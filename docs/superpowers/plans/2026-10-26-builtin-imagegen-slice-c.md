# Slice C — Codex Built-in ImageGen Handoff

**Owner decision (2026-10-26):** Remove the OpenAI Images API adapter entirely. The primary Codex agent delegates to a separate image-generator subagent inheriting its model; the subagent invokes built-in `$imagegen` after an approved brief from adequately source-aware GPT-6 Sol (Web) DEV (priority) or the main task model. No OpenAI API key, endpoint or separate image subscription integration exists in Ludory.

## Contract

1. `workflow draft --task art-concept` produces a source-aware candidate brief when authenticated Web DEV can receive adequate scene/character/location/style references. Otherwise the active primary model authors the brief and saves a project-relative UTF-8 file. Drafts and source hashes require review.
2. `workflow image` snapshots the brief (SHA-256, size, project identity, current native run) and returns `NEEDS_AGENT_ACTION`, `codex-imagegen`, a complete `$imagegen` tool prompt and `SPAWN_IMAGE_AGENT`, with `agent: { role: image-generator, executor: codex-subagent, model: inherit-parent }`. The same result is returned with `--apply`; the CLI does **not** spawn an agent, invoke a tool, call HTTP or write an execution event.
3. The primary Codex agent delegates the bound packet to a separate subagent. Only that image-generation subagent uses built-in `$imagegen`, with selected visual references where available, and saves the generated original into the project. The tool schema currently has **no model or quality selector**. Request highest available fidelity in the prompt; record `provider-default`, `modelObserved: null`. Never fabricate a concrete model identity. If delegation or skill access is unavailable, stop without generating.
4. `workflow image-import --handoff-sha256 <original-packet-token> --apply` rejects a changed brief, run head/stage or project source binding before validating project-relative file safety, complete PNG/JPEG/WebP decoding, dimensions, byte limits, hashes and journal constraints. It preserves immutable original bytes and the declared handoff token with `USER_DECLARED` provenance, `PENDING_REVIEW`. It does not attest the tool invocation, accept artwork or release the game.

## Scope and negative tests

- Reject old API-only `--model` flags (`sunburst`/`flare`) and avoid all image-specific credentials, HTTP calls, retries, paid opt-in and automatic model fallback.
- Preserve historical explicitly pinned in-process Terra/SOL adapter contract and readable native journal events, including archived Sunburst/Flare requests and imports. These are **read compatibility only**, not available default CLI image production routes or executable API adapters.
- Freeze existing games, CEOS and Starter Kit; permit image handoff only for new Studio-created games with an active run and a safe art brief.
- Preview and handoff must be read-only; image import must fail closed for symlinks, hardlinks, corrupt JPEG/WebP data and source drift.
- Run targeted Node tests plus `npm test`, `npm run check`, `node examples/core-session.mjs`, and `git diff --check` before publishing the feature branch; request Node 22/24 CI and real Codex tool/Windows smoke independently.

## Remaining limitation

Node CLI cannot invoke Codex session tools; no unattended image generation or host-observed provenance claim is possible from it alone. Future orchestration would require a documented authorized tool bridge, not an implicit OpenAI API fallback.
