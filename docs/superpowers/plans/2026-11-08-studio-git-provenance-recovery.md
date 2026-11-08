# Studio Git Provenance Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover legitimate missing Studio component-upgrade provenance from a complete local Git history with independent owner consent and without changing game files or silently granting Studio trust.

**Architecture:** A read-only Git historian provides bounded and verified commit snapshots; Studio validates ownership transitions, current project bytes and authored proofs; a separately consented host-only checkpoint anchors the recovered component state; ordinary `components trust` remains independently mandatory. Native backups continue to be the default source of provenance.

**Tech Stack:** Node.js 22+ ESM, `node:test`, `git` executable (offline read-only object inspection), SHA-256, Studio's protected filesystem and trust modules.

**Spec:** `docs/superpowers/specs/2026-11-08-studio-git-provenance-recovery-design.md`

## Global Constraints

- Only Ludory changes; do not write to the game repository, manually alter component receipts/states, simulate native archive witnesses, enable economy, publish or merge.
- Current `components update`/ `components trust` fail-closed behavior must not regress.
- Local **complete** Git history is required; never fetch from the network implicitly.
- Owner acceptance is explicit and separate for Git recovery and Studio host trust.
- Refuse existing mismatching host pins, corrupt native backups, stale digests, source path escapes and incomplete history.

## Review Focus

1. Git repository with only a synthetic/shallow head must fail rather than using unverified user-authored history.
2. A changed managed file in an intermediate commit without matching state hash must fail even if later restored.
3. A valid later native update after recovery must still link to the recovered host anchor; no universal bypass.
4. Recovery confirmation must be invalidated by authored-file or commit-history changes after preview.
5. Existing host trust with contradictory hash, or a corrupt real archive, must not be repaired by recovery.

---

### Task 1: Bounded offline Git history reader

**Files:**
- Create: `packages/studio/src/component-git-history.mjs`
- Test: `packages/studio/test/component-git-history.test.mjs`

**Interfaces:**
- Produces `collectComponentGitHistory(projectDir, {fromCommit,toCommit})` returning `{repositoryRoot, projectPath, commits:[{sha, parents, files:Map<string,{mode,bytes}>}]}`; throw on invalid/replaced objects, missing/shallow ancestors, ambiguous first-parent merges, unsafe repo/project paths or over-broad history.
- Each commit snapshot contains the specific Studio receipt/manifest/state and the managed paths declared by that commit, without using Git smudge/clean filters, remote operations or hooks.

- [ ] **Step 1: Write real temporary-Git-fixture tests** for full linear history, distinct managed blobs at each state, rejection of shallow/unrelated/merge history and symlink/path escape. The public interface is imported before its implementation.
- [ ] **Step 2: Run** `node --test packages/studio/test/component-git-history.test.mjs`. **Expected:** RED for missing `collectComponentGitHistory`.
- [ ] **Step 3: Implement** `collectComponentGitHistory()` using strict fixed-argument `git` object reads with bounded byte output, regular-file mode checks, explicit full SHAs and local-only history; never execute repo-configured helpers.
- [ ] **Step 4: Run** the same focused suite. **Expected:** PASS for all cases.
- [ ] **Step 5: Commit** reader and tests as `feat(studio): inspect bounded Git component history`.

### Task 2: Explicit host-side recovery checkpoint

**Files:**
- Modify: `packages/studio-trust/src/index.mjs`
- Modify: `packages/studio/src/component-trust.mjs`
- Test: `packages/studio/test/component-recovery-checkpoint.test.mjs`

**Interfaces:**
- Produces `registerComponentRecoveryCheckpoint(project, details)` (exclusive, separate canonical host-private file), `readComponentRecoveryCheckpoint(project)` (returns `null` when absent, throws on mismatch/corruption) and `assertComponentRecoveryCheckpoint(project, expected)`.
- Details include physical project root identity, original receipt+manifest SHA, anchored recovered state SHA and Git witness digest/commit SHAs.

- [ ] **Step 1: Add failing tests** for private file and no game writes, absence, immutability, corrupted record, wrong identity, existing contradictory trust pin.
- [ ] **Step 2: Run** `node --test packages/studio/test/component-recovery-checkpoint.test.mjs`. **Expected:** RED for missing host checkpoint APIs.
- [ ] **Step 3: Implement** host checkpoint under the existing private registry root and re-export through Studio boundary. Do not change `registerComponentTrust` semantics.
- [ ] **Step 4: Run** focused suite. **Expected:** PASS.
- [ ] **Step 5: Commit** checkpoint and tests as `feat(studio): pin owner-approved recovery evidence separately`.

### Task 3: Ownership-safe preview and recovery apply

**Files:**
- Modify: `packages/studio/src/component-updates.mjs`
- Test: `packages/studio/test/component-git-recovery.test.mjs`

**Interfaces:**
- Produces `previewComponentGitRecovery(projectDir, {fromCommit,toCommit,catalog})` with mode `component-recovery`, status, conflicts, witness paths+hashes, `recoverySha256` and no game writes.
- Produces `acceptComponentGitRecovery(preview, confirmedRecoverySha256)` that re-runs all verification then performs the host-only compare-and-create checkpoint.
- `verifyOwnershipHistory()` treats a valid host checkpoint as an **exact historical anchor**, including while traversing later real Studio archive transitions; a missing checkpoint never weakens existing verification.

- [ ] **Step 1: Write failing tests** for real 1.2.3→1.2.4 Git fixture with no backups, preview acceptance then separate trust and 1.2.5 update; negative cases for intermediate tampering, ownership regression, modified bytes/author proof, stale digest, contradictory pin, and corrupt real backup.
- [ ] **Step 2: Run** `node --test packages/studio/test/component-git-recovery.test.mjs`. **Expected:** RED for missing preview API.
- [ ] **Step 3: Implement** validation reusing `parseState`, `originalOwnershipMatches`, `versionCompare`, `checkedFile`, `assertAuthoredFilesSafe`, native transition constraints and new Git reader/host checkpoint. Require every historical snapshot managed file hash to match, and no intermediate file drift. No generated game writes.
- [ ] **Step 4: Run** focused recovery and existing `component-updates.test.mjs`. **Expected:** PASS; historical trust regression tests unchanged.
- [ ] **Step 5: Commit** integration and tests as `feat(studio): consent-gate Git recovery of component provenance`.

### Task 4: CLI, documentation and final gates

**Files:**
- Modify: `packages/studio/src/cli.mjs`
- Modify: `packages/studio/README.md`
- Test: `packages/studio/test/component-git-recovery-cli.test.mjs`
- Modify: this plan only if a documented ruling changes the implementation interface.

**Interfaces:**
- CLI `ludory components recover --project <path> --from-commit <full-sha> --to-commit <full-sha> [--accept-recovery-sha256 <sha256> --apply] [--json]`.

- [ ] **Step 1: Write failing real CLI tests** for preview, explicit apply, no-apply-without-digest, invalid digest, missing history, no game file changes and separate `components trust` requirement.
- [ ] **Step 2: Run** `node --test packages/studio/test/component-git-recovery-cli.test.mjs`. **Expected:** RED for unknown `recover` command.
- [ ] **Step 3: Implement** CLI parser/dispatch and README runbook with exact commands, limitations and recovery threat model.
- [ ] **Step 4: Run** CLI/recovery tests, `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`. **Expected:** 0 failures / exit 0; report skips honestly.
- [ ] **Step 5: Commit** as `docs(studio): document Git provenance recovery and CLI`.

## Delivery and safety gates

- Independent whole-branch code review examines host-root trust boundaries, immutable recovery anchor, Git parser/object safety and downgrade/ownership regressions. Resolve Critical/Important findings with failing regression tests.
- Publish updated head to existing **Draft PR #94**, attach exact source HEAD and local/CI evidence; do not mark Ready/merge until review and owner approval.
- Do not claim actual-game recovery PASS: current game checkout has synthetic single-commit history; game PR #3 stays Draft and untouched.
