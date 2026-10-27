# StoryScope-inspired narrative review for Ludory

**Date:** 2026-10-27
**Decision:** Automatic independent narrative review after an `episode-script` draft, approved by the owner.

## Intent

Ludory should apply a reusable Codex skill and an authenticated Web DEV review to newly produced episode drafts. Reviews identify story/continuity and interactive-choice problems with evidence, without treating statistical indicators of AI text as artistic laws or pretending that review equals publication approval.

## Scope and boundaries

- Add repository-local `.agents/skills/ludory-narrative-review/SKILL.md` and one evidence/rubric reference. Codex can discover it while working in Ludory; CLI prompts also carry the operative rubric, so automation does not depend on Codex skill discovery.
- Only new Studio games and `episode-script` drafts participate. Historical/frozen games and `art-concept` retain current behavior.
- The authoring Web DEV turn completes first, and stores its source-bound immutable draft. A subsequent separate reviewer turn, with no prior chat history requested, reads the saved draft, original brief and selected references. It must not edit the draft.
- `workflow draft --apply` automatically reviews accepted `episode-script` drafts. `draft-import --apply` does likewise when a verified Web DEV route is available; otherwise it leaves `PENDING_REVIEW` and explains the available manual handoff. A `workflow narrative-review` command permits a read-only preview and an explicit `--apply` of an unreviewed draft.
- The reviewer is **GPT-6 Sol (Web)** observed via the existing authenticated DEV helper. No OpenAI API, browser scraping, unverified provider or self-asserted model identity.
- Reviewer verdicts: `ACCEPT`, `REWORK`, `BLOCKED`. `ACCEPT` is scenario-local artistic readiness for subsequent integration, **never** a native pipeline `PASS` or Release gate. `REWORK` requires at least one grounded P0/P1. P2 alone must not block. `BLOCKED` is used for invalid/missing response or unavailable evidence.
- A review request is append-only and hash-bound to the immutable draft and context. A result is appended only for that request; interruptions remain pending, and cannot be silently repeated. `workflow recover --confirm-no-executor --apply` can explicitly terminate a pending review as `BLOCKED` after checking that the helper stopped.
- The review reports exact draft excerpts and location cues for P0/P1 findings, distinguishes factual contradictions from optional stylistic observations, and checks visual-novel choices, route continuity, state consequences, protagonist agency, revelation timing, relationship arcs, thematic over-explanation and cliches.
- No fixed quotas for flashbacks, ambiguity, subplots, senses or endings. Originality proxy is advisory; the findings of Russell et al., *StoryScope* (COLM 2026, arXiv:2604.03136v6), do not prove the quality or authorship of a specific story.
- Do not modify project-owned scenes, saves or release state automatically. No autonomous regeneration loop; a `REWORK` result returns specific actionable findings and the owner initiates a new draft/run.

## Considered approaches

1. **Chosen:** repo-local skill plus automatic source-bound Web reviewer and native review receipts. Reuses the current host and append-only audit trail with a small, explicit review contract.
2. Skill/AGENTS guidance alone. Cheap, but the existing `episode-script` draft never gets independently checked without prompting; insufficient for automatic acceptance.
3. Standalone scoring/detection service. Adds provider/API dependencies and turns research correlations into brittle release rules; outside Ludory boundaries.

## Acceptance

- Success and `REWORK` use independently reported, source-bound evidence. Tampered hashes, schema, excerpts, sources or model route cannot yield `ACCEPT`.
- Missing/failed reviewer and interruption preserve `PENDING_REVIEW`/`BLOCKED`, never `PASS` or automatic retry.
- Source-bound review result survives reading and replaying the native run; existing historical run formats still replay.
- Preview is read-only; only `--apply` creates review events; explicit recovery is required after uncertain execution.
- Automatic review is exercised for both host-generated and manually imported episode drafts. `art-concept` keeps existing flow.
- `npm test`, `npm run check`, `node examples/core-session.mjs`, and `git diff --check` must run. CI must pass before any merge/release claim.
