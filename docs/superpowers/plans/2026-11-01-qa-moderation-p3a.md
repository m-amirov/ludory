# P3a Pre-moderation QA Rules and CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a deterministic, read-only, target-specific `ludory qa simulate` pre-moderation report that checks actual candidate integrity, declarations and local listing/promo metadata without ever granting platform or publication approval.

**Architecture:** Add a small `@ludory/release` simulation orchestrator over existing `checkYandexRelease`, `checkVkCandidate` and `inspect*Archive`. Versioned rule packs specify which results may be automated and which remain `BLOCKED`; a strict metadata/promo reader binds evidence to the actual ZIP SHA. Studio CLI exposes one read-only command and preserves explicit denial of live-moderation authority.

**Tech Stack:** Node.js 22+ ESM, `node:test`, existing `fflate` test fixtures, existing Studio CLI; no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-qa-moderation-simulation-design.md` (P3a slice only).

## Global Constraints

- Base: `main` squash commit `0bc52216af9bdf8285e0002b12cbaa2aa28c64dd`; branch `feat/ludory-qa-moderation` in repo-local `.worktrees/qa-moderation`.
- New Studio-created games and candidate ZIPs only; no CEOS/Starter Kit migration or modification of game files.
- A ZIP alone cannot authenticate Studio origin: P3a treats the candidate as owner-designated, never emits an independently verified Studio-origin claim and never opens the original game project.
- Targets `yandex-games` and `vk-games` require distinct versioned packs; VK official moderation rule text is unverified and cannot yield a fabricated platform PASS.
- Read-only by default and for all P3a operations; no archive extraction/execution, browser launch, Web API, account access, upload, publication or moderation submission.
- `releaseReady:false`, `publicationAllowed:false`, `actualModeration:'NOT_RUN'` always; `PRECHECK_CLEAR` is **unreachable in P3a** while browser and independent content/visual reviewer evidence is unavailable.
- `FAIL` on demonstrated hash/format/contract violations, `BLOCKED` on absent or unauthenticated evidence; `ISSUES_FOUND` outranks `BLOCKED` when a required P0/P1 failure is observed.
- Keep `@ludory/core`, existing Yandex Release and VK Release public contracts unchanged. New public export is opt-in. No untrusted JSON field may promote itself to `MACHINE_OBSERVED` or `WEB_REVIEWED`.

## Review Focus

1. **Archive changes between two readers:** the simulator must verify the SHA independently before/reporting nested gates; a read race or unexpected mismatch is `FAIL`, never mixed candidate identities (Task 3 test).
2. **Symlinked/renamed promo file or root:** reject the local promotion evidence as `FAIL` using `readRegularBytes` and canonical relative paths (Task 2 test).
3. **Duplicate metadata keys or unknown attestation fields:** reject as `FAIL` instead of silently accepting the last key or a fake `MACHINE_OBSERVED` (Task 2 test).
4. **Positive fake SDK or self-declared listing fields:** PASS only for the explicit local contract/data-integrity scope; live SDK, visual/content/platform acceptance remain `BLOCKED` (Task 3 test).
5. **One failed requirement plus missing subjective review:** return `ISSUES_FOUND` with the failure and still enumerate the blocked reviews (Task 3 test).

---

### Task 1: Pinned, separate moderation rule packs

**Files:**
- Create: `packages/release/src/moderation-rules.mjs`
- Test: `packages/release/test/moderation-rules.test.mjs`

**Interfaces:**
- Produces `getModerationRulePack(target: 'yandex-games' | 'vk-games')` -> frozen `{schemaVersion:1, target, revision:'2026-11-01-p3a', sources:[{url,checkedAt,verified}], rules:[{id,domain,severity,required,evidenceMode,policyRef}]}`; invalid targets throw `ReleaseInputError('QA_TARGET_INVALID', ...)`.
- Rule IDs in both packs: `archive`, `build-receipt`, `media-declarations`, `listing-metadata`, `promo-integrity`, `browser-observation`, `visual-ux`, `content-review`, `promo-review`, `platform-policy`. Yandex additionally includes `sdk-contract`; VK additionally includes `bridge-contract`. `policyRef` is a source URL or `null` for a purely Ludory rule. `sources[].verified=false` for inaccessible VK official docs.

- [ ] **Step 1: Write test** that `getModerationRulePack('yandex-games')` has a verified Yandex source, a `sdk-contract` rule and no `bridge-contract`; VK has the inverse target rule and an unverified official source; both have exact `revision`, distinct rule arrays, no mutable shared state and reject unknown targets.
- [ ] **Step 2: Run RED:** `node --test packages/release/test/moderation-rules.test.mjs` -> expected missing module/export.
- [ ] **Step 3: Implement** `getModerationRulePack` using fixed tables and freezing/copy-on-return as appropriate; no web fetch and no inferred official VK requirement text.
- [ ] **Step 4: Run GREEN:** same command -> 0 failures.
- [ ] **Step 5: Commit:** `git add packages/release/src/moderation-rules.mjs packages/release/test/moderation-rules.test.mjs && git commit -m 'feat(qa): pin platform-specific simulation rule packs'`.

### Task 2: Strict local metadata, promotional files and VK media declarations

**Files:**
- Create: `packages/release/src/moderation-evidence.mjs`
- Test: `packages/release/test/moderation-evidence.test.mjs`

**Interfaces:**
- Produces `inspectModerationEvidence({target,candidateSha256,projectId,metadataPath,promoRoot,rightsPath,mediaFiles})` -> `{listing:{status,reasonCode},promo:{status,reasonCode},media:{status,reasonCode}}` (plus safe bounded details only). Inputs are read-only paths; `mediaFiles` is the verified archive's `[{path,sha256,size}]`.
- Metadata JSON v1: `{schemaVersion:1,target,candidateSha256,projectId,listing:{name,description,howToPlay,category,version,platforms,orientation},content:{ageRating,contentWarnings},promo:[{kind:'icon'|'cover',path,sha256}]}` with unique `kind`, SHA-256, and file path relative to `promoRoot`. `platforms` is a nonempty subset of `['desktop','mobile']`; `orientation` is `'auto'|'portrait'|'landscape'`. `ageRating` is a bounded source declaration string, not a certified platform age label; `contentWarnings` is a bounded array of strings. Exact root/member field sets, duplicate object-key detection and a 1 MiB cap apply. `listing` textual fields must be nonempty bounded strings, not a claim of actual Console fields.
- `--metadata` missing -> listing and promo `BLOCKED`. Unavailable promo bytes/root -> promo `BLOCKED`; malformed JSON, invalid path, symlink, unexpected fields, changed digest or candidate mismatch -> corresponding `FAIL`. Both targets accept the same local data contract but VK official listing-field *policy interpretation* stays blocked.
- For VK, `rightsPath` is optional but required for complete local media declarations: `{schemaVersion:1,target:'vk-games',candidateSha256,assets:[{path,sha256,provenance:'owned'|'licensed'|'public-domain',evidence}]}` exactly one per shipped media. No rights/legal clearance is inferred. For Yandex use the existing `checkYandexRelease` rights gate instead of a second validator.

- [ ] **Step 1: Write tests** with temp real promo files and synthetic archive `mediaFiles`: valid source-bound metadata (including age/content disclosures)+VK declarations are local `PASS`; absent required fields/inputs `BLOCKED`; bad SHA/target, duplicate keys, forbidden extra attestation field, invalid disclosures, traversal/symlinks, mismatched asset declaration and changed bytes `FAIL` or explicitly `BLOCKED` when data is merely missing.
- [ ] **Step 2: Run RED:** `node --test packages/release/test/moderation-evidence.test.mjs` -> missing module/export.
- [ ] **Step 3: Implement** `inspectModerationEvidence` reusing `readRegularBytes`, `SHA_256`, archive media paths and `ReleaseInputError` classifications; make no output files or mutations.
- [ ] **Step 4: Run GREEN:** same command -> 0 failures.
- [ ] **Step 5: Commit:** `git add packages/release/src/moderation-evidence.mjs packages/release/test/moderation-evidence.test.mjs && git commit -m 'feat(qa): validate local listing promo and VK media evidence'`.

### Task 3: Compose bounded QA findings without release authority

**Files:**
- Create: `packages/release/src/moderation-simulation.mjs`
- Modify: `packages/release/src/index.mjs`
- Test: `packages/release/test/moderation-simulation.test.mjs`

**Interfaces:**
- Consumes `getModerationRulePack`, `inspectModerationEvidence`, `checkYandexRelease`, `checkVkCandidate` and `inspectYandexArchive`/`inspectVkArchive`.
- Produces `simulateModeration({target,archivePath,receiptPath,sdkEvidencePath,rightsPath,metadataPath,promoRoot})` -> `{schemaVersion:1,kind:'moderation-simulation',target,candidateSha256,rulePack:{revision,sources},status:'ISSUES_FOUND'|'BLOCKED'|'PRECHECK_CLEAR',checks:[{id,status,reasonCode,severity,evidenceSha256?}],findings:[{id,severity,reasonCode}],unverifiedScopes:[id],reviewProvenance:'NOT_RUN',actualModeration:'NOT_RUN',releaseReady:false,publicationAllowed:false}`. All `checks` ordered according to the pack; no external I/O beyond safe file reads.
- Existing Yandex/VK local gates map one-to-one to local QA rule IDs. VK `bridge-contract` is a distinct **local bundle check**, not live `VKWebAppInit` proof. Non-executed browser, visual, content and promo reviews are always `BLOCKED`/`NOT_RUN` with exact reasons. Unverified VK policy remains `BLOCKED`.
- Fixed unresolved reason codes: `BROWSER_NOT_RUN`, `VISUAL_REVIEW_NOT_RUN`, `CONTENT_REVIEW_NOT_RUN`, `PROMO_REVIEW_NOT_RUN`, `LIVE_PLATFORM_NOT_RUN`; VK's official rule interpretation uses `POLICY_SOURCE_UNVERIFIED`. A report may mark `platform-policy` as `BLOCKED` even if all technical archive gates are locally green.

- [ ] **Step 1: Write tests** that valid synthetic Yandex/VK ZIP+receipt yield candidate-bound reports with local PASS but overall BLOCKED and denial fields; corrupt ZIP/receipt, changed candidate between validators and a P1 violation plus absent reviewer yield ISSUES_FOUND; no user JSON self-report can assert a browser/visual PASS; stable ordering and no temp changes.
- [ ] **Step 2: Run RED:** `node --test packages/release/test/moderation-simulation.test.mjs` -> missing export.
- [ ] **Step 3: Implement** simulator and export through `@ludory/release`; if archive inspection fails, preserve its ReleaseInputError code as local FAIL and keep dependent gates BLOCKED. Re-inspection must agree with underlying Release report SHA before combining.
- [ ] **Step 4: Run GREEN:** same command -> 0 failures.
- [ ] **Step 5: Commit:** `git add packages/release/src/moderation-simulation.mjs packages/release/src/index.mjs packages/release/test/moderation-simulation.test.mjs && git commit -m 'feat(qa): compose fail-closed moderation simulation report'`.

### Task 4: Studio CLI, operator docs and full regression gate

**Files:**
- Modify: `packages/studio/src/cli.mjs`
- Modify: `packages/release/README.md`
- Modify: `packages/studio/README.md`
- Test: `packages/studio/test/qa-cli.test.mjs`

**Interfaces:**
- `ludory qa simulate --target <yandex-games|vk-games> --archive <zip> --receipt <json> [--sdk-evidence <json>] [--rights <json>] [--metadata <json> --promo-root <directory>] [--json]` invokes `simulateModeration()` once with read-only arguments. Yandex requires `--sdk-evidence` and `--rights`; VK may report missing rights as BLOCKED. Reject unknown options, duplicates and `--apply`.
- Exit `1` for `ISSUES_FOUND` or invalid command, `2` for `BLOCKED`, `0` only for a future honestly verified `PRECHECK_CLEAR` (unreachable in this slice). Always print JSON on `--json`, otherwise a bounded readable summary with target, actual SHA, required failures, blocked scopes and the denial fields.

- [ ] **Step 1: Write tests** using Studio's `runCli` harness and real temporary C5/V5 candidates: `--json` matches the public report, help documents command, no files change, failed candidate is nonzero, blocked evidence is exit 2, `--apply` and unknown/missing parameters exit 1 and never launch/submit.
- [ ] **Step 2: Run RED:** `node --import ./packages/studio/test/setup-trust-env.mjs --test packages/studio/test/qa-cli.test.mjs` -> command not recognized.
- [ ] **Step 3: Implement** CLI argument branch and docs with reproducible command examples, source-trust limitations, the difference between local SDK mock, simulation, live moderation and real Release.
- [ ] **Step 4: Run GREEN:** same command -> 0 failures.
- [ ] **Step 5: Run full verification:** `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`, `git status --short`. Full test run must exit 0, including Quality integration, before claiming PASS. If sandbox child-process `EPERM` appears, rerun with the permitted non-sandboxed test profile rather than altering production code.
- [ ] **Step 6: Commit:** `git add packages/studio/src/cli.mjs packages/release/README.md packages/studio/README.md packages/studio/test/qa-cli.test.mjs && git commit -m 'feat(studio): expose read-only moderation QA simulation'`.
- [ ] **Step 7: Independent review / PR handoff:** inspect diff against base and acceptances, address Critical/Important findings with regression tests, verify exact GitHub HEAD and CI, open PR; no squash-merge without the owner's separate authorization.

## Follow-on plans (separate approval and review gates)

- **P3b:** opt-in isolated Playwright current-build capture, source-bound original screenshot+state evidence, offline network restrictions, tests for stale/replayed captures. No browsing untrusted games by default.
- **P3c:** independent, image-witnessed Web DEV moderator packet and receipt reconciliation; absence of the verified route yields BLOCKED. No Node API invocation or invented model identity.
- **P3d:** comprehensive two-target synthetic acceptance, zero-write verification, browser CI, rulebook refresh review. `PRECHECK_CLEAR` remains a scoped simulation status and never implies Yandex/VK publication readiness.

All three follow-on slices implement the same approved P3 spec, but need separate implementation plans once P3a interfaces and evidence boundaries are exercised.
