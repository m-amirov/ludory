# S2 Native Art, Visual QA & Rights — Implementation Plan (implemented)

> **Implementation status (2026-10-28):** Owner-approved S2 instruction contracts merged in PR #20 and three skills/tests merged in PR #21. This historical implementation plan **does not** authorize actual image generation, external review, licence acceptance, runtime-pixel PASS or release; those remain separate gated operations.

**Goal:** Add three opt-in Ludory-native repository skills for art production, gameplay pixel QA and asset-rights review, with honest evidence boundaries.

**Architecture:** Independent `.agents/skills/<name>/SKILL.md` files; Node 22+ `node:test` integration/static tests under `packages/studio/test/`; isolated new Studio fixture and agent pressure trials. No new CLI capability without an independently approved design. The S2 skill layer must reuse native image/art-review receipts, not counterfeit missing screenshot or rights engines.

**Spec:** [S2 approved contracts](../specs/2026-10-28-s2-native-skills-design.md). **Historical baseline:** merged S0/S1 `main` `5c47d19df998b6522325a39c04c6ab3a9c957cec`; implementation was completed in PR #21.

## Global constraints

- Work on an isolated branch/approved worktree, preserving unrelated dirty files. Do not touch frozen games, CEOS/Starter Kit, Core, Runtime, Connect, Release, SDKs, `AGENTS.md` or global skills. Do not edit old Studio game repositories.
- Skill files are instructions, not proof of tool invocation. Native `image`, `image-import`, `art-review` and the existing review receipts are authoritative for those operations; `NEEDS_AGENT_ACTION`, `PENDING_REVIEW`, `NEEDS_USER_ACTION`, `REWORK`, `ESCALATE` survive unchanged.
- Separate `ludory-engineering-quality`, `ludory-narrative-review`, S1 audit/verification/fix; avoid trigger shadowing. No overall gameplay, rights legal opinion or Release PASS.
- For each acceptance claim: add failing contract behavior/static test first (RED), then minimal skill text (GREEN), then a sandbox pressure trial; never treat a mocked helper or word-match test as real visual evidence.

## Delivery slices

### S2a: source-bound production art

**Files:** create `.agents/skills/ludory-production-art/SKILL.md`; create `packages/studio/test/s2-skills.test.mjs` (focused tests); optionally add README cross-link after reviewing its current section.

1. RED: test frontmatter/trigger, new-Studio-only scope, manual native Codex packet and mandatory separate agent; preview/import flow, SHA-256 and source/handoff freshness; no paid HTTP API, no CEOS dependency.
2. GREEN: write concise actionable skill with current commands and receipt interpretation. In tests stub native statuses but explicitly distinguish synthetic from actual invocation.
3. Pressure: when no image subagent is available, stop `NEEDS_AGENT_ACTION` without faking a file; stale packet/import SHA blocked; injected project reference cannot override system/owner instructions.
4. Only if separately authorized real tools and new fixture exist: perform native image handoff/import and inspect actual original bytes. A real Web review requires attested upload; if unavailable, report blocked and keep import `PENDING_REVIEW`.

### S2b: runtime visual QA

**Files:** create `.agents/skills/ludory-visual-qa/SKILL.md`; extend `packages/studio/test/s2-skills.test.mjs`.

1. RED: require exact build/scene/viewport/DPR/screenshot SHA-256 and a source-bound visual rubric; assert that compilation, CSS/DOM inspection, mock PNG and `PASS_ART` cannot satisfy runtime pixel QA.
2. GREEN: write read-only inspection/report recipe and separate independent screenshot-review requirement with P0/P1 defects and blocked evidence fields.
3. Pressure: current baseline lacks Runtime renderer/capture; report `BLOCKED: RUNTIME_PIXEL_CAPTURE_UNAVAILABLE`. If a future browser harness or independent reviewer lacks attested image reception, preserve `BLOCKED`, do not fabricate photos or host metadata.
4. **Deferred live gate:** after Runtime host and screenshot harness land in a separately reviewed PR, add a real two-viewport/state screenshot fixture and visual regression/defect trial. Do not label S2b live-verified until this step occurs.

### S2c: asset rights provenance

**Files:** create `.agents/skills/ludory-asset-rights/SKILL.md`; extend `packages/studio/test/s2-skills.test.mjs`; optionally add a **documentation-only** report template to `.agents/skills/ludory-asset-rights/references/` (no executable ledger API yet).

1. RED: test narrow activation, scope and original/current digests, source/creator/evidence, derivative chain, target use, rights terms and attribution coverage; missing or conflicting proof blocks documentary acceptance.
2. GREEN: skill guides *inspection*, not legal certification; explicit `DOCUMENTATION_COMPLETE`, `BLOCKED` and `ISSUE_FOUND` with reviewer/time and gaps; generated output is not proof of ownership, art acceptance does not imply rights.
3. Pressure: unknown source; modification without derivative licence; monetization beyond permission; AI image with unspecified terms; malicious text claiming blanket permission. All must preserve unverified/blocked outcome.
4. A persistent `.ludory` rights ledger, enforcement CLI, release integration or legal policy requires a **separate implementation proposal** (schema versioning, immutable receipts, migration/update behavior, owner authority) and cannot be inferred from this plan.

### S2d: cross-skill integration and release of the skill PR

**Files:** `packages/studio/test/s2-skills.test.mjs`, `.agents/skills/ludory-*` files above, and narrowly relevant docs.

1. RED/GREEN routing tests: request only visual QA -> no art generation; request only rights -> no image/Web execution; art receipt -> rights/visual remain unverified; blocker + known defect -> preserve both, with precedence spelled out.
2. Verify docs contain actual commands in current Studio CLI; no historical `ceos` or `.codex-os` commands as operations, no uncontrolled `--apply`. Probe on Windows-compatible line endings and path variants.
3. Execute `node --test packages/studio/test/s2-skills.test.mjs`, `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`. Record exact commands, exit statuses, isolated pressure results, blocked real-tool gates and platform omissions.
4. Open **Draft** PR independent of Runtime #16/#17. Require reviewed diff and observed Ubuntu/Windows Node 22/24 CI. No merge without owner-authorized review and verified checks. Do not present unit-test success as real image/visual/rights acceptance.

## Acceptance checklist

- [ ] Owner explicitly approved S2 skill contracts and allowed implementation (not yet).
- [ ] Three individually discoverable skills with distinct scope/ownership.
- [ ] Native image/import/art-review API usage matches current code and hash/attestation rules.
- [ ] Meaningful RED/GREEN checks + negative/blocked behavioral trials documented.
- [ ] No writes to frozen games, Runtime, old CEOS/Starter Kit or global hooks.
- [ ] Missing Web/ImageGen/runtime pixel evidence and rights decisions remain honest blockers.
- [ ] Docs/test suite/CI inspected; Draft PR reviewed before any merge.

**Out of scope:** building the Runtime renderer/screenshot harness, changing native art-host protocols, implementing permanent rights-ledger APIs, obtaining licences/legal counsel, publishing games or declaring Release PASS.
