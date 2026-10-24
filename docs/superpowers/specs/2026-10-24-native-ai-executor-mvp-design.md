# Native Ludory AI Executor — first Codex-backed slice (2026-10-24)

## Intent

Extend the already merged native workflow ledger so a user can opt into a **real, single Codex task** from Studio. The existing read-only preview and manual `continue --apply` behavior remain compatible. The new command form is `ludory workflow continue --executor codex --apply`; preview without `--apply` must not start Codex or write a file (read-only Git inspection can run).

## Approaches

1. **Chosen: direct, explicit Codex subprocess with two ledger events.** Use installed `codex exec --json --ephemeral --sandbox workspace-write -`, no shell, pass the task on stdin. Require `--executor codex` in this first slice; keep the existing manual ledger mode unchanged. Persist an API-level append-only `ACTION_REQUESTED` event before execution and an `EXECUTION_RESULT` event afterward. It does not require an agent broker.
2. **Deferred: remote Codex SDK or general model/provider broker.** Would introduce authentication/routing policy and a second state machine before the single-executor path is validated.
3. **Rejected: directly declare checkpoint PASS from Codex prose or execution exit 0.** An agent finishing is not independent art/runtime/release verification.

## Scope and boundaries

- Only games made with the new Ludory Studio `create` receipt (`ludory.studio.json` schema 1) are eligible for executor launch. Old games remain frozen, and a migrated legacy manifest alone is insufficient. This receipt is an opt-in marker, not a cryptographic provenance guarantee.
- The user's `--apply` authorizes **Codex workspace-write access to the newly created game root**. The `inScope`/`outOfScope` fields are passed as instructions but are *not* filesystem-enforced allowlists. Do not claim precise per-file confinement in this slice; direct Codex execution through Studio was verified on Windows, while descendant cleanup after forced parent termination remains unverified.
- No global CEOS dependency, no worktree/session manager, no provider key extraction, no disabled safety policy. Do not use `danger-full-access`, `--full-auto`, shell interpolation, or auto-approvals. Keep the user's existing Codex configuration and account-based authentication.
- A missing Codex binary is diagnosed **before** the first write. A failure during execution is recorded as a failed attempt and surfaced without a false PASS. An active Codex request prevents stage checkpointing until its exact request-bound result is committed. If the parent crashes after `ACTION_REQUESTED`, `workflow recover` requires an explicit operator confirmation and appends a failed `EXECUTOR_INTERRUPTED` result; it never speculates that the old process stopped or advances a checkpoint.
- Record only bounded, non-secret metadata in the hash-chained event log: executor id, numeric exit code, JSONL SHA-256, event count, and whether a `turn.completed` event occurred. Do not persist stdout/stderr, API keys, model reasoning, or raw prompts in the ledger.
- A successful Codex process yields `EXECUTED_UNVERIFIED` and requires subsequent human/independent checkpoint evidence. The existing final Release PASS remains blocked.
- Initial runner timeout is finite, using SIGKILL for an unresponsive *direct child*; descendant cleanup and Windows termination behavior remain unverified. Large/malformed JSONL, spawn errors, timeouts and nonzero exits are explicit failures, not silently accepted.
- The ledger hash chain detects inconsistent stored bytes but is **not** tamper-proof against a writer who can rewrite the full chain. Protection of `.ludory/ai` from the Codex process is presently a prompt instruction, not a separate filesystem trust boundary.
- No writes to frozen projects, no historical CEOS importer, no host deployment, no production release claim.

## Acceptance

1. Unversioned Studio-created game executes one fake Codex child process on `--apply`, using stdin and `shell:false`; read-only preview executes none.
2. On success, two append-only events are replayed, history remains readable after ordinary game edits, and status becomes `EXECUTED_UNVERIFIED` / `AWAIT_EVIDENCE`, never PASS.
3. Nonzero exit, missing executable, malformed/missing completion, timeout and oversized output do not result in a successful receipt. Missing executable writes nothing; attempted failures are recorded.
4. Invalid/stale preview, ambiguous run, old project without Studio creation receipt, tampered event receipt and conflicting subsequent continue are blocked.
5. `npm test`, `npm run check`, Core example and PR CI Node 22/24 pass. Actual Codex executable and Windows/NTFS are host-observed gates, not CI assertions.
