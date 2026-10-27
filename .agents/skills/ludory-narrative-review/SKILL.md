---
name: ludory-narrative-review
description: Use when authoring, reviewing, or revising an episode-script, interactive story, visual novel, branching romance route, scene graph, narrative draft, or narrative quality report in Ludory.
---

# Review Ludory Narrative

## Principle

Assess what the story *does*, not whether its wording resembles AI prose. StoryScope's corpus-level differences are hypotheses for a writer/editor to inspect, not an AI detector, authorship proof, creativity score or release gate. Read [research and rubric](references/storyscope.md) when judging a draft or devising a review brief.

## Workflow

1. Discover the game's canonical narrative/scene graph, episode brief, character canon, relationship variables, route locks and intended player experience. Respect `AGENTS.md`, immutable user-owned sources and frozen-game restrictions.
2. Identify the exact `episode-script` draft and its SHA-256. Review only source-bound bytes. Do not infer missing canon or fabricate unseen branches.
3. For Studio-created games, inspect `ludory workflow narrative-review --project <game> --run <id> --json` first. `workflow draft --apply` and `workflow draft-import --apply` already request automatic independent Web DEV review when available. Do not launch a second review just because a previous turn timed out.
4. The independent review checks factual consistency, causal links, characterization, meaningful choice consequences, romance/relationship arcs, reveal timing and route/state continuity. Check over-explanation, uniform sensory metaphors and overly tidy resolution only where these actually impair this story. Never impose flashback, ambiguity, subplot or word-count quotas.
5. Require evidence: P0/P1 findings identify a scene/passage, an **exact excerpt present in the draft** and a concrete defect relative to canon/brief. P2 is optional polish; avoid iterative micro-polish. Preserve author intent, genre and established characters.
6. Interpret `ACCEPT` as readiness for a *separate* integration decision, `REWORK` as actionable P0/P1 blocking issues and `BLOCKED` as missing/untrusted evidence. Neither `ACCEPT` nor Web DEV telemetry is Release PASS.
7. If `NARRATIVE_REVIEW_REQUESTED` is pending without `NARRATIVE_REVIEW_RESULT`, stop: verify the previous reviewer helper is no longer running before explicit `workflow recover --confirm-no-executor --apply`. Revisions use a new source-bound draft/run, not a hidden retry or silent original overwrite.
8. The DEV host accepts at most 64 KiB per complete review prompt. For an oversized episode, report `REVIEW_PROMPT_TOO_LARGE` and request an independently specified scene/chapter review workflow; never silently truncate a source. Manual `draft-import` review receives the draft and brief, without extra canon sources: missing route/character evidence may require `BLOCKED`.

## Report contract

Use one strict JSON object matching the active native review contract:

```json
{"schemaVersion":1,"draftSha256":"<exact SHA-256>","verdict":"REWORK","summary":"Choice has no state consequence","findings":[{"severity":"P1","category":"choice","location":"S05","excerpt":"<exact draft excerpt>","description":"The selected option never alters the route or subsequent scene"}]}
```

Allowed categories: `continuity`, `choice`, `character`, `plot`, `dialogue`, `pacing`, `romance`, `structure`, `other`. Severity: `P0`, `P1`, `P2`. `ACCEPT` has no P0/P1; `REWORK` has at least one P0/P1. Only a host-observed, contract-valid response may become accepted narrative evidence.
