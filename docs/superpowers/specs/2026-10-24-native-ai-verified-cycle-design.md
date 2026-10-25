# Native AI — bounded verified cycle (2026-10-24)

## Intent

Continue the merged Native AI Executor MVP with a small, opt-in controlled loop:
Codex executes one stage task, performs an explicitly requested Node test command
inside the existing Codex workspace sandbox, and may retry **at most twice**
when the observed test command is not successful. No second orchestrator.

## Approaches

1. **Chosen: same-stage bounded loop using the existing `ACTION_REQUESTED` / `EXECUTION_RESULT` ledger.** One CLI command coordinates at most three normal Codex executions, checks machine-observed `command_execution` events, and stops for independent checkpoint review. This reuses the existing failure/retry state.
2. **Deferred: automatic stage transitions.** Requires a separate independent validator for each domain/stage and cannot safely be inferred from Codex exit status or test execution.
3. **Rejected: executing AI-generated tests directly with unrestricted host Node.** This moves code out of Codex's sandbox and adds a privilege boundary not authorized for this MVP.

## Contract

- `ludory workflow cycle --project <new-studio-game> --run <id|latest> --test <relative.test.js> [--repairs 0|1|2] [--apply] [--json]`.
- Preview is read-only: no Codex launch, no test execution, no ledger changes. `--apply` explicit.
- Only Studio-created games, as gated by current native executor. Old games remain frozen.
- Test path must be a simple, relative JavaScript test path, without traversal, shell metacharacters, symlinks or absolute paths. The test may be newly created by Codex.
- On each attempt, the Codex prompt requests the exact command `node --test <test-path>` inside its existing workspace sandbox. An observed `item.completed` command_execution with matching command and exit code 0 is the **only** machine check for this command. Missing/failed command execution returns `EXECUTOR_CHECKS_FAILED` even if the Codex turn completes successfully.
- Test execution is not independent QA: it is merely Codex tool telemetry. A success always remains `EXECUTED_UNVERIFIED`; automatic checkpoint, pipeline advancement and Release PASS are prohibited.
- Retries only on `EXECUTOR_CHECKS_FAILED`, not on process failures, timeouts, interrupted runs, missing Codex, malformed JSONL or unsafe source changes. Max 1 initial attempt + 2 repairs.
- Each attempt is published as the normal request/result pair. The loop must replan against current hash-verified run state before each retry; no stale reuse, overlapping executor or parallel stage mutation.
- Output remains bounded; do not persist raw Codex JSONL, prompts or test output in the ledger. Record a bounded count/hash and explicit outcome code, as existing executor does.
- `workflow continue`, manual checkpoint, `workflow recover` and existing run formats retain their behavior.
- A process crash between request and result preserves `AWAIT_EXECUTOR_RESULT`, requiring the existing manual recovery confirmation.

## Acceptance

1. Dry-run has no executor, tester or ledger side effects.
2. Codex command telemetry matches a legitimate successful test command; fake text inside another command cannot pass. Missing/failing test command triggers a bounded retry, including correct run/request ledger chain.
3. Three consecutive failed checks stop after exactly three requests and three failure results. Process/timeout/unavailable errors stop immediately.
4. Check success returns `EXECUTED_UNVERIFIED`, never auto-checkpoint or PASS, and manual checkpoint remains available.
5. Negative tests for frozen game, invalid paths/repairs, ambiguous and substituted runs, current pending run, no duplicate or background operations.
6. `npm test`, `npm run check`, Core example and PR CI Node 22/24 pass. Real Windows Codex command telemetry is a host-observed gate before claiming production readiness.
