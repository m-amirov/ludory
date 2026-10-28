# PR #13 ImageGen capability and helper supply audit

Date: 2026-10-27
Branch: `feat/web-art-acceptance` (`ceos/task/pr13-web-art-acceptance` worktree)

This is diagnostic evidence for PR #13. It does not grant ImageGen PASS,
`PASS_ART`, Release PASS, or merge readiness.

## ImageGen capability root cause

The current-turn production-art gate was checked with:

```text
ceos capability-challenge --json
CEOS_ERROR: BLOCKED_SESSION_CONTEXT_UNVERIFIED
```

The command fails before a producer route can be trusted. This is the
mandatory run-scoped trusted Codex-session check, not evidence that the native
ImageGen tool itself executed or that a route was selected. The required next
action is a new trusted Codex session in which the run-scoped challenge
completes successfully; only that session may perform the fresh generation
smoke.

The separate context lookup was also checked:

```text
ceos context --skill production-art --project .
CEOS_ERROR: CEOS manifest not found under
D:\HardWork\LUDORY\.worktrees\pr13-web-art-acceptance\.codex-os
```

This is a missing CEOS project-context registration, distinct from the
session challenge. No `.codex-os` manifest was created, no environment marker
was used, and no trust or permission check was bypassed.

## Ludory routing boundary

The shipped Ludory path does not invoke CEOS or a Node-level ImageGen API:

- `packages/ai/src/image-tasks.mjs` plans the `codex-imagegen` handoff with
  `status: NEEDS_AGENT_ACTION`, `modelObserved: null` and
  `nextAction: SPAWN_IMAGE_AGENT` for the built-in `$imagegen` route.
- `packages/studio/src/cli.mjs` explicitly describes the separate Codex
  subagent handoff and the absence of a programmatic provider/model selector.
- `packages/ai/src/image-host.mjs` is the legacy injected host adapter for
  explicitly pinned Terra/SOL routes; its live-execution checks are not the
  built-in `$imagegen` route.
- `packages/ai/test/builtin-imagegen-handoff.test.mjs` proves the built-in
  plan does not probe a host or call an API. The Studio CLI test rejects the
  API-only model pins and preserves `USER_DECLARED` import provenance.

Therefore the current blocker is not a Ludory routing error. Native ImageGen
availability is **unverified** because the trusted-session challenge failed;
no ImageGen call was made and no generated output or receipt was promoted.

## Reproducible v2-helper delivery

The patched helper remains local and isolated:

- upstream source worktree: `D:\HardWork\LUDORY\.worktrees\codex-chatgpt-web-v2`;
- local commits: `83135a5` and `a8199d9`;
- built helper: `.launcher-runtime/browser-helper.cjs`;
- helper size: `216615` bytes;
- helper SHA-256:
  `c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7`;
- clean DEV copy:
  `C:\Users\user\AppData\Local\Temp\ludory-web-helper-clean-75080e4c746b4a1abc2b5c772ae598ae\runtime\browser-helper.cjs`;
- clean DEV copy has the same size and SHA-256;
- clean profile config is version 3, `browser-only`, launcher host, release
  `6.1.14`, with a descriptor explicitly under the same DEV profile;
- the descriptor was accepted by Ludory's safe registration checks and the
  helper negotiated `browser_observation_v2`;
- the subsequent route probe returned `DEV_ROUTE_UNVERIFIED` because the
  newly isolated browser profile had no independently confirmed authenticated
  Web route. That result is preserved; no declaration was promoted to
  `HOST_OBSERVED`.

The safe current delivery method is a pinned local source worktree/build plus
hash-checked installation into a dedicated DEV profile. It changes neither
the stable launcher nor the stable browser profile and does not publish to the
upstream repository. A future packaged artifact could carry the upstream
commit, build version, byte length and SHA-256 with an installer restricted to
the DEV profile, but adding such a dependency is outside this bounded PR and
would require a separate review of packaging and update trust.

## Parser regression coverage

`packages/ai/test/art-review.test.mjs` now asserts that:

- valid `PASS_ART` remains accepted;
- a structured `REWORK` with a P1 finding remains `REWORK`;
- an unknown JSON escape is rejected;
- invalid SHA-256, schema version and source-bound image SHA are rejected;
- the existing P0/P1, P2-only and invisible-image behavior remains covered.

## Gate status

- Web negative `REWORK`: PASS (previous evidence).
- Web positive `PASS_ART` with source-bound receipt: PASS (previous evidence).
- Native ImageGen capability smoke: **BLOCKED**, exact reason
  `BLOCKED_SESSION_CONTEXT_UNVERIFIED`.
- Required action: obtain a fresh trusted Codex session with a successful
  run-scoped capability challenge, then execute a new
  `brief -> native ImageGen -> original -> Web Art Review -> receipt` chain.
- Release and merge: not approved; PR #13 remains Draft.
