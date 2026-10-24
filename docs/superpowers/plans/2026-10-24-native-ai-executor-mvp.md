# Native AI Executor MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute one opt-in Codex task through Studio and record bounded, verifiable native outcomes without creating a new orchestrator.

**Architecture:** A small Codex process adapter handles stdin, JSONL and result classification. The existing AI ledger stores request/result events, and Studio routes `--executor codex` to the adapter after an explicit apply. Existing manual workflow commands stay compatible.

**Tech Stack:** Node.js >=22 ESM, `child_process.spawnSync`, Node test runner; no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-native-ai-executor-mvp-design.md`

## Global Constraints

- Existing games frozen; only Studio-created new games may execute Codex.
- Preview has no Codex child process or filesystem write (read-only Git inspection is allowed). Codex uses `--sandbox workspace-write`, never danger-full-access, with shell disabled.
- `EXECUTED_UNVERIFIED` cannot be upgraded to final Release PASS without independent verifier.
- Existing native run/event receipts, manual continuation, and project identity checks remain intact.
- Do not persist raw Codex transcript, stderr, prompt, credentials, or reasoning in native events.

## Review Focus

- Missing executable: no event written (`Task 2`).
- A Codex success exit without `turn.completed`: must be FAILED (`Task 1`).
- A failed execution after request: durable failure receipt, retry allowed (`Task 2`).
- A pending Codex execution blocks stage advancement, and a completion is bound to the exact request (`Task 2`).
- A valid request plan from another run, or a valid checkpoint substituted for a request, is rejected before preflight (`Task 2`).
- User-provided task with shell metacharacters: transmitted via stdin as data (`Task 1`).
- Old/frozen project with only a migrated manifest: no Codex invocation (`Task 3`).

---

### Task 1: Bounded Codex subprocess adapter

**Files:** Create `packages/ai/src/executor.mjs`; test `packages/ai/test/executor.test.mjs`.

**Interfaces:** `prepareCodexExecution(project, scope, stage, { gitRoot })` returns a safe command/input preview; `checkCodexAvailable(prepared, { spawn, executable, prefixArgs })` performs only a version preflight; `runCodexExecution(prepared, { spawn, executable, prefixArgs })` returns `{ ok, code, exitCode, transcriptSha256, eventCount, completed }` without exposing transcript bytes.

- [ ] Write tests for exact argv/stdin, no shell, workspace-write (not full-auto/danger), new games without Git, normal JSONL `turn.completed`, shell-metacharacter input, failure/no completion, malformed/oversized JSONL, timeout and missing program. Confirm RED before implementation.
- [ ] Implement minimal bounded adapter with no new provider layer; report failures as data.
- [ ] Run `node --test packages/ai/test/executor.test.mjs` (GREEN), then `npm test` (PASS).
- [ ] Commit implementation as an isolated change.

### Task 2: Record an execution result in the native event chain

**Files:** Modify `packages/ai/src/store.mjs`, `packages/ai/src/workflows.mjs`; test `packages/ai/test/store.test.mjs` and `packages/ai/test/workflows.test.mjs`.

**Interfaces:** `planNativeEvent(project, id, { kind:'EXECUTION_RESULT',stage,result })` validates metadata; `commitNativeEvent` keeps hash receipt checks. `executeWorkflow(plan,{apply,executor})` invokes an injected executor only after preflight and committing the request. Existing manual `continue` path is unchanged.

- [ ] Write failing tests for request/result ordering, no preflight writes, failure receipt, retry, stale plan and unverified success state.
- [ ] Extend replay validation and normal nextAction mapping; fail closed on forged results and preserve manual flow.
- [ ] Run targeted store/workflow tests (GREEN) and full `npm test` (PASS).
- [ ] Commit bounded ledger integration.

### Task 3: CLI opt-in and Studio-owned game gate

**Files:** Modify `packages/studio/src/cli.mjs`, `packages/studio/README.md`, `packages/ai/src/executor.mjs`, `packages/ai/src/workflows.mjs`; test `packages/studio/test/native-workflow-cli.test.mjs`.

**Interfaces:** `workflow continue --executor codex [--apply]` previews/runs; no other workflow operation accepts `--executor`. Studio `ludory.studio.json` serves only as an opt-in marker for execution, not verified ownership of every file.

- [ ] Write RED integration tests for created-game preview/apply and frozen-game refusal, ambiguous run and JSON error statuses.
- [ ] Implement CLI option and documentation with honest file-scope and host limitations.
- [ ] Run targeted CLI tests (GREEN), `npm test`, `npm run check`, Core example.
- [ ] Commit changes on an isolated feature branch, open Draft PR with accurate unverified host gates; do not merge without owner instruction.
