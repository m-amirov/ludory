---
name: ludory-engineering-quality
description: Use when implementing or reviewing changes in a new Ludory Studio game that has opted into Engineering Quality, particularly when a Codex workflow changes source code or a quality gate is blocked.
---

# Ludory Engineering Quality

Use this **repository-local** skill only for a new Studio-created game with an explicit project policy. It is inspired by Robert C. Martin's [ub-mode](https://github.com/unclebob/ub-mode); the instructions here are original and specific to Ludory. Never install global hooks, invoke CEOS, or modify frozen games on its behalf.

## First make behavior work

1. Read the actual game requirement and the smallest relevant source boundary. Ask whether an existing operation can be simplified before adding another abstraction.
2. Write one observable behavior test first and see it fail for the expected reason. Test external outcomes, not a private implementation detail.
3. Fix the **root cause** in the smallest coherent unit. Keep input parsing and unsafe effects at explicit boundaries. Prefer idempotent operations and isolated mutable state.
4. Run the focused test. Refactor only after behavior is pinned, and rerun the tests to prove no regression.

## Then make engineering evidence inspectable

```bash
ludory quality enable --project <new-game>             # preview, no writes
ludory quality enable --project <new-game> --apply     # explicit opt-in
ludory quality check --project <new-game> --tier quick --apply --json
ludory quality check --project <new-game> --tier deep --apply --json
ludory quality status --project <new-game> --json
ludory quality evidence --project <new-game> --run latest --json
```

- `quick`: actual behavior tests, coverage, Crapper **CRAP < 10**, Dryer structural duplication threshold `0.80`. Investigate duplicates before refactoring; do not refactor unrelated code merely to reduce counts.
- `deep`: also run bounded Mutator against changed critical code. Surviving mutants call for stronger behavior tests; uncovered paths call for justified tests or removal of dead code.
- For each tool, provision a compatible, already-installed executable and explicitly pin its absolute path, SHA-256, version and timeout in `.ludory/quality/policy.json`. Mutator requires its upstream Crapper dependency. No auto-download or first-run installer is authorized.
- `quality check` defaults to preview. Only `--apply` executes checks inside the Codex workspace sandbox. After a successful source-changing applied `workflow cycle` or `workflow continue --executor codex`, Ludory triggers **one** `quick` check automatically.
- Consult local `quality evidence` receipts: confirm actual commands, exit codes, coverage and `.metrics` report checksums, source digest, policy digest and verdict. `BLOCKED` or `STALE` is a stop condition, not a disguised success.

## Guardrails and handoff

Never reinterpret Codex's `EXECUTED_UNVERIFIED` as independent acceptance. A development Quality `PASS` is not **Release PASS**, device/browser validation, rights clearance or publishing permission. No silent exception, forced push, merge into `main`, automatic checkpoint, or edit outside the user's scope.

Report completion as: changed behavior and root cause; focused test RED/GREEN; `quick`/`deep` status with receipt ID and source SHA-256; unverified, blocked or stale items; exact next action. If tools or coverage are missing, report the named blocker and leave the quality gate unpassed.
