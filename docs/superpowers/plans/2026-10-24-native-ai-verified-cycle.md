# Native AI bounded verified cycle — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-24-native-ai-verified-cycle-design.md`

**Goal:** One opt-in Studio command implements a bounded same-stage Codex → observed test command → repair retry loop using existing Native AI state, without new agent brokers or automatic stage advancement.

**Stack:** Existing Node.js ESM executor, workflow ledger and Studio CLI; no dependencies.

## Task 1: Observe test commands in the existing Codex adapter

- Add RED tests in `packages/ai/test/executor.test.mjs` for an exact `command_execution` completed event with success/failure; a nonmatching or echoed command cannot count, and ordinary runs without required command retain behavior.
- Update `packages/ai/src/executor.mjs`: optional `requiredCommand` in prepared plan; prompt requests the check; a completed turn without observed passing command yields `EXECUTOR_CHECKS_FAILED` (not PASS). Existing JSONL bounds/failure codes remain intact.
- Add the bounded code to `packages/ai/src/store.mjs`; RED→GREEN store replay/retry regression. Run targeted tests.

## Task 2: Sequential bounded same-stage driver

- Add RED tests in `packages/ai/test/workflows.test.mjs`: preview, one passing attempt, one failed then repaired, exhaustion after three, hard process failure, pending/stale guard and absence of automatic checkpoint.
- Extend `packages/ai/src/workflows.mjs` with `cycle` operation that composes the existing `continue` flow and re-plans each attempt; only retries `EXECUTOR_CHECKS_FAILED` up to selected repairs budget. No new ledger or persistent state machine.
- Run targeted tests; fix discovered root cause.

## Task 3: CLI and integration

- Add RED tests in `packages/studio/test/native-workflow-cli.test.mjs` for preview/apply, refusal of old game, path/repair validation, JSON errors and injected executor.
- Extend `packages/studio/src/cli.mjs` with `workflow cycle` and update `packages/studio/README.md`, `README.md`, `docs/ROADMAP.md`. Keep manual and recovery behavior stable.
- `npm test`, `npm run check`, `node examples/core-session.mjs`; final code review, then Draft PR to main. No merge without owner instruction.

## Release and safety gates

- Code checks and PR CI are necessary but insufficient for Windows-host observed Codex compatibility.
- No independent stage/release verifier is added; `EXECUTED_UNVERIFIED` is not quality, art or Release PASS.
- Existing games and CEOS/Starter Kit remain frozen and untouched.
