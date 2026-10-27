# Engineering Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in source-bound Engineering Quality checks and evidence to new Studio games, with automatic quick checks after applied Codex development workflow changes.

**Architecture:** `@ludory/ai` owns policy, safe runner orchestration, and hash-verified receipts; Studio exposes preview-first CLI commands. Generated tests and tools execute only inside the existing Codex workspace-write sandbox, while host-side code validates source, output, and receipt integrity. No release authority is added.

**Tech Stack:** Node.js 22+ ESM, `node:test`, existing `@ludory/ai` executor, built-in filesystem/crypto/child_process only.

**Spec:** `docs/superpowers/specs/2026-10-27-engineering-quality-design.md`

## Global Constraints

- Frozen old games, CEOS, Starter Kit, global Codex hooks/skills, project-owned SDK/runtime files remain untouched.
- Preview is strictly read-only. Only `--apply` may create scoped `.ludory/quality` state or run commands.
- Tests and external quality tools never run in unrestricted Studio host: use Codex sandbox with exact observed command and exit code.
- Missing tools/coverage, stale source, malformed or unauthenticated evidence fail closed; never infer PASS from Codex prose or exit 0 alone.
- No tool auto-download, conditional publication, Release PASS, background daemon, or automatic merge.
- Node 22+/24 CI; no extra production runtime dependencies; existing Native AI records and bounded cycle semantics remain unchanged.

## Review Focus

1. Tool entrypoint changed between preparation and sandbox run: result must be BLOCKED, never PASS (Task 2).
2. Changed source or symlink substitution while checking: store STALE/BLOCKED and protect outside paths (Task 1/2).
3. Interrupted Codex subprocess with a partial report: no successful Quality receipt and status reveals incomplete check (Task 2).
4. Applied workflow fails after some code writes: preserve original result and do not claim auto Quality PASS (Task 3).
5. Legacy Studio game with forged or missing creation receipt: opt-in must block before creating files (Task 1).

---

### Task 1: Project policy and integrity-checked evidence

**Files:**
- Create: `packages/ai/src/quality-policy.mjs`, `packages/ai/src/quality-store.mjs`
- Test: `packages/ai/test/quality-policy.test.mjs`, `packages/ai/test/quality-store.test.mjs`
- Modify: `packages/ai/src/index.mjs`

**Interfaces:**
- Produces `planQualityEnable(projectDir)`, `applyQualityEnable(plan)`, `readQualityPolicy(projectDir)`, `snapshotQualitySource(projectDir)`, `planQualityEvidence(projectDir,{run})`, `persistQualityReceipt(projectDir,request)`, `qualityStatus(projectDir)`.
- `planQualityEnable` returns READY/BLOCKED/IN_SYNC with project, root identity, source-bound plan fingerprint; apply exclusively creates policy and trusted runner (Task 2).
- `persistQualityReceipt` consumes validated bounded `results[]`, source/policy digests and optional reports, emits append-only `runs/<id>/receipt.json`; status revalidates receipt/report hashes, chain and current source.

- [ ] **Step 1: Write tests** for new Studio eligibility, immutable preview, idempotent enable, policy conflict and invalid/symlink source; expected result statuses and zero side effects.
- [ ] **Step 2: RED:** run `node --test packages/ai/test/quality-policy.test.mjs`; expect missing exports.
- [ ] **Step 3: Implement** policy/version, project-owned `.ludory/quality` storage, no-follow validation and stable source snapshot excluding generated quality/AI state.
- [ ] **Step 4: GREEN:** same test passes.
- [ ] **Step 5: Write tests** for valid receipt chain, report tamper, source drift, exclusive collision, malformed JSON, concurrent writer and path substitution.
- [ ] **Step 6: RED:** run `node --test packages/ai/test/quality-store.test.mjs`; expect missing exports.
- [ ] **Step 7: Implement** size-limited receipt writes, SHA-256 chained canonical receipts and integrity checks; preserve history, avoid cleanup of user files.
- [ ] **Step 8: GREEN:** same test passes. Commit `feat(quality): add opt-in policy and evidence contracts`.

### Task 2: Sandbox check execution, tool adapters and CLI

**Files:**
- Create: `packages/ai/src/quality-runner.mjs`, `packages/ai/src/quality-checks.mjs`, `packages/ai/test/quality-checks.integration.mjs`, `packages/studio/test/quality-cli.test.mjs`
- Modify: `packages/ai/src/quality-policy.mjs`, `packages/ai/src/index.mjs`, `packages/studio/src/cli.mjs`

**Interfaces:**
- Consumes policy/source/evidence Task 1.
- Produces `planQualityCheck(projectDir,{tier})` and `executeQualityCheck(plan,{apply,executor})`; fixed safe observed command `node --test .ludory/quality/quality.test.js` and source/report-bound results.
- Runner is a checked embedded test script installed by enable; it runs declared bounded test/Crapper/Dryer/Mutator executable arrays with `shell:false`, no install, and reports tool SHA/version/exit/structured reports. Tool path/sha are project-pinned; missing tool/version/coverage = BLOCKED.
- Studio adds `ludory quality enable|check|status|evidence`; unknown flags rejected, preview exits without execution, failed explicit check exits nonzero.

- [ ] **Step 1: Write behavior tests** for missing tool, wrong SHA, fake Codex narrative PASS, wrong/no command, successful observed execution with valid report, exit failure, interrupted check, and no host test process before Codex handoff.
- [ ] **Step 2: RED:** run `node packages/ai/test/quality-checks.integration.mjs` and observe missing behavior.
- [ ] **Step 3: Implement** pinned tool/version runner, bounded quick/deep check plans, Codex sandbox invocation and evidence validation; never promote simple JSONL/prose to independent QA.
- [ ] **Step 4: GREEN:** targeted AI tests pass.
- [ ] **Step 5: Write Studio CLI tests** for preview/apply/status/evidence semantics and frozen game rejection.
- [ ] **Step 6: RED:** run `node --test packages/studio/test/quality-cli.test.mjs`.
- [ ] **Step 7: Implement** argument routing, help and status/output codes.
- [ ] **Step 8: GREEN:** Studio tests pass. Commit `feat(quality): execute bounded sandbox quality checks`.

### Task 3: Automatic opt-in workflow hook and project-local skill

**Files:**
- Modify: `packages/studio/src/cli.mjs`, `packages/studio/test/native-workflow-cli.test.mjs`, `packages/studio/README.md`, `README.md`
- Create: `.agents/skills/ludory-engineering-quality/SKILL.md`, `packages/ai/test/quality-skill.test.mjs`

**Interfaces:**
- Consumes Task 2 `executeQualityCheck`.
- Produces automatic single quick quality invocation only after a successful, applied code-changing `workflow cycle` or Codex `workflow continue`; original workflow result status, bounded repairs and native event history stay unchanged. Quality result appears in sibling JSON field and has separate evidence ID.

- [ ] **Step 1: Write tests**: disabled/preview/unchanged source = no auto invocation, applied changed code = exactly one, failing workflow = no PASS; `EXECUTED_UNVERIFIED` unchanged.
- [ ] **Step 2: RED:** run `node --test packages/studio/test/native-workflow-cli.test.mjs`.
- [ ] **Step 3: Add** post-execution hook without background runner or stage advancement.
- [ ] **Step 4: GREEN:** targeted Studio tests pass.
- [ ] **Step 5: Add** source-local skill and provenance/docs; test skill discoverability, no global hooks, no unconditional git push.
- [ ] **Step 6: Run** `npm test`, `npm run check`, `node examples/core-session.mjs` and adjust only concrete failures via RED→GREEN regression tests.
- [ ] **Step 7: Commit** `feat(quality): integrate opt-in workflow checks and documentation`.

### Task 4: Review and PR

**Files:** none unless review discovers defects.

- [ ] **Step 1:** inspect `git diff main...HEAD`, verify safety, changed-file scope, no external writes/frozen game references.
- [ ] **Step 2:** review exact acceptance matrix against code and test outputs; retain Windows/tool compatibility as a named unverified external gate without host evidence.
- [ ] **Step 3:** run fresh complete `npm test`, `npm run check`, `node examples/core-session.mjs` and report totals, skipped, known limitations.
- [ ] **Step 4:** push only the feature branch and create PR; do not merge or claim Release PASS.
