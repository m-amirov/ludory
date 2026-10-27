# Engineering Quality — opt-in project mode (2026-10-27)

Status: **Owner approved (Variant A); implementation in feature branch, pending PR review and Windows/tool validation**.

## Intent

Add a project-scoped `Engineering Quality` mode to new Ludory Studio games. Its purpose is to make Uncle Bob-inspired engineering discipline observable: behavior-first tests, root-cause fixes, constrained complexity, duplication review, mutation testing, and source-bound receipts. The mode provides development-quality evidence, **not** independent Release PASS, platform certification, artistic review, or permission to publish.

## Approaches

1. **Selected: A — opt-in Studio project mode.** Separate `ludory quality` commands, source-bound evidence, and an automatic quick run after successful code-changing native Codex workflow operations. Fits the current Studio/AI boundaries without global hooks.
2. **Rejected now: B — checks on every Verified Cycle attempt.** This multiplies expensive mutation/test executions and conflates executor telemetry with independent approval.
3. **Deferred: C — Release-only checks.** Checks arrive too late to help iterative development and Release's independent verifier is not yet implemented.

## Scope and non-goals

- Scope: newly Studio-created games with creation receipts, JS/TS game source where tools support it; Node 22+ ESM. Development workflows work in dirty and unversioned new game directories.
- No changes to Core's platform-neutral contract or to existing/frozen games, CEOS, Starter Kit, global Codex hooks/skills, `AGENTS.md`, third-party SDK settings, or project-owned runtime files.
- Do not copy upstream `ub-mode/SKILL.md` verbatim until licensing is reviewed. Implement original project-local guidance with upstream attribution.
- No automatically installing unknown dependencies, no AI-generated test execution in the unrestricted Studio host, no unconditional push/merge to main, no publication or Release PASS.
- This feature is bounded to development evidence and is not a new orchestration engine. It reuses existing Codex execution/sandbox and Native AI integrity patterns.

## UX and contracts

All mutations are preview-only unless explicit `--apply` is present. JSON output is machine-readable and human messages give next action.

```text
ludory quality enable --project <new-studio-game> [--apply] [--json]
ludory quality check --project <new-studio-game> [--tier quick|deep] [--apply] [--json]
ludory quality status --project <new-studio-game> [--json]
ludory quality evidence --project <new-studio-game> [--run <quality-id|latest>] [--json]
```

- `enable` produces project-owned versioned policy under `.ludory/quality/policy.json`, exclusively and only on an eligible new Studio game. Repeated enable on the same policy is idempotent; divergent policy is a conflict, not an overwrite.
- `check` previews the exact read-only plan, tool availability, tier, scope and source binding. On `--apply`, required test commands run inside the existing Codex workspace sandbox; exact observed command-execution events and checked artifacts become evidence. A narrated success, fabricated stdout, Codex exit zero alone, or an unexecuted command is never PASS.
- `status` re-verifies receipt integrity and current-source binding, reports `PASS`, `FAIL`, `BLOCKED`, `STALE`, or `NOT_RUN` for each check and aggregate. `evidence` verifies and exposes bounded receipt metadata/report digests, not arbitrary paths or raw prompts.
- Missing prerequisites, unsupported host, missing coverage, failed baseline, or unknown tool version produce named `BLOCKED_*` reasons, never inferred PASS. No silent skip of required checks.

### Tiers

- `quick` (automatic after native Codex code-changing workflows): relevant behavior tests, Crapper, Dryer on changed code, with known pinned tool versions and required coverage for CRAP scoring. The strict CRAP <10 target applies to **new/modified functions**. Existing debt is a reported baseline, not a silent global rewrite.
- `deep` (explicit before proposed PR/release gate): includes quick plus bounded Mutator mutation tests on touched critical modules. The default mutation scope is changed code; never automatically use a full-tree `--mutate-all`. A survivor is a test-gap finding, not permission to rewrite arbitrary code.
- Set explicit worker/time budgets; never run heavy check tools concurrently against a shared mutable coverage/report tree.
- Duplicates (structural similarity >=0.80) are review findings, not unconditional refactor requirements. The chosen 0.80 threshold is explicit instead of relying on Dryer's current default 0.82.
- Policy can express justified, versioned exceptions with source locations, owner reason, expiry/review date. No agent-only silent suppression.

### Safety boundary and tool provenance

- All commands that may execute generated game code, test scripts or mutable project dependencies must run inside the Codex workspace sandbox; the Studio host performs only read-only validation, bounded hashing, and exclusive receipt writes.
- Invoke pinned, explicitly provisioned Crapper/Dryer/Mutator adapters; no implicit downloads or pip/npm/cargo install. Unknown executable, missing compatible pinned version or unsupported Windows behavior = BLOCKED. Track `crapper` prerequisite of `mutator`.
- Normalize fixed executable/argv arrays and allowlisted relative paths; reject shell metacharacters, traversal, symlinks outside project, alias substitution and ambiguous or stale Codex execution events.
- Any pre/post check source drift is `STALE`; never attach evidence to a newer code revision. Use controlled locks and exclusive creation to protect concurrent writers.
- Existing `workflow cycle` still reports `EXECUTED_UNVERIFIED` even when quality checks pass. Quality PASS means only the declared quality checks were observed and verified; it is not independent QA or a protected Release gate.

## Automatic integration

- Only after an applied `workflow cycle` or `workflow continue --executor codex` finishes and its native execution result is committed, compare code hashes. If Quality mode is enabled and code changed, schedule exactly one `quick` check. No automatic check on preview, aborted/failed executor result, disabled mode, or unchanged code.
- The check's outcome is returned beside, but does not overwrite, the original workflow receipt/status. A Quality `FAIL/BLOCKED` must be conspicuous in CLI/JSON and available to later gate consumers. It must not masquerade as workflow/Release PASS.
- No background daemon, filesystem watcher, automatic checkpoint, retry loop inside quality, stage promotion or new session hooks. Existing max-two-repair bounded cycle remains unchanged.
- A crash during quality execution creates an interrupted/blocked inspectable run. Recovery never assumes a process has ended without confirming it.

## Evidence and storage

Under `.ludory/quality/` only:

- `policy.json`: schema/version, tiers, thresholds, tool manifest (name/version/digest), fail-closed policy.
- `runs/<id>/receipt.json`: immutable-by-contract, bounded and canonically encoded receipt with `schemaVersion`, `qualityRunId`, `projectId`, `sourceDigest`, `policyDigest`, timestamp, tier, tool identity/version/digest, exact argv and cwd identity, observed command exit, report SHA-256, verdict, reason code, previous receipt digest and receipt digest.
- `runs/<id>/reports/`: bounded copies of machine-readable coverage, CRAP, duplication, mutation reports with checksums. Validate paths and file types; no secrets, prompts, complete stdout or arbitrary user files.
- A hash-linked receipt chain and write-once/atomic publish pattern; tampering, missing report, truncated record or broken chain is `BLOCKED_INTEGRITY`. These receipts are *not* tamper-proof against a privileged actor rewriting the entire local chain.
- Read-only status rechecks digest/reference and reports `STALE` when current source no longer matches the receipt, while preserving historical evidence.

## Code ownership

- `packages/ai/src/quality-*.mjs`: policy contract, planning, sandbox-executor integration, evidence verification/persistence; exported via `@ludory/ai`.
- `packages/studio/src/quality-*.mjs` and narrow `cli.mjs` routing changes: CLI parse/preview/apply/status, no shadow orchestration.
- `.agents/skills/ludory-engineering-quality/SKILL.md`: repository-local instructions for Codex, not a global skill.
- Node `--test` regression coverage in `packages/ai/test/` and `packages/studio/test/`. README and Studio help updated without replacing existing profiles/templates.

## Acceptance and release gates

1. Disabled/default state leaves all existing flows unchanged; no implicit writes to frozen games.
2. All read-only commands have zero executor/FS writes. `enable --apply` is confined to new Studio games and is idempotent.
3. Required `quick` checks actually execute in the sandbox; each command, exit, pinned tool identity, source/report digest and verdict are independently re-readable from local evidence. False textual PASS and missing coverage cannot pass.
4. `deep` runs bounded mutation checks on the intended changed module; survivors and missing tool paths produce accurate findings/blockers.
5. Simulate corrupt, forged, stale, symlinked, interrupted and concurrently written receipts; fail closed without deleting history.
6. Integration tests prove exactly-one post-change automatic quick check, no preview/unchanged/disabled triggering, unchanged bounded cycle semantics, and no auto-Release PASS.
7. `npm test`, `npm run check`, `node examples/core-session.mjs`, and PR CI Node 22/24 pass. Confirm actual Windows Codex sandbox command telemetry and external tool compatibility before claiming Windows support or mandatory quality enforcement.
8. Full Ludory Release, VK/Yandex compliance, rights and real device/browser checks remain separate. No claim of publication readiness without their future independently implemented gates.

## Implementation sequence after approval

1. Add contract and RED-GREEN tests for policy, eligibility, safe preview and evidence integrity.
2. Add fixed-command/pinned-tool adapters and sandbox-observed `quick/deep` execution with negative tests.
3. Add Studio CLI commands, append-only receipts and source/hash revalidation.
4. Wire opt-in post-workflow automatic `quick` checks without altering existing cycle return semantics.
5. Add project-local skill/docs, run full verification and Windows-capability gate, open PR for review. Do not merge without requested review and observed checks.

## Reference

- Upstream inspiration: https://github.com/unclebob/ub-mode
- Companion tools: https://github.com/unclebob/crapper, https://github.com/unclebob/dryer, https://github.com/unclebob/mutator
- Existing Ludory contracts: `AGENTS.md`, `packages/ai/src/workflows.mjs`, `packages/ai/src/store.mjs`, `packages/studio/src/cli.mjs`, `docs/superpowers/specs/2026-10-24-native-ai-verified-cycle-design.md`
