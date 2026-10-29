# Ludory 1.0 — completion and acceptance design

**Decision:** Approved by owner on 2026-10-30: complete Ludory before building the next production game. `N4` game adoption is deferred. The owner accepted **technical framework readiness** as the 1.0 target; game moderation and live publication are outside that target.

**Baseline:** `main` merge commit `2b2009ccb4856661ed4d6b0a88a0fd20d14495f0` (merged Narrative N3 PR #43), read on 2026-10-30. This is a design proposal for review, not an implementation or release certificate.

## 1. Product intent and boundaries

Ludory is a Codex-operated framework for authoring, validating, running, and packaging **new** browser games. A creator should be able to ask Codex to create and improve a game without manually wiring Studio, Core, AI workflow, Runtime, Connect, and Release. Its supported game genres include narrative games with deterministic offline interactions; genre-specific features remain optional. Targets for 1.0 are **Yandex Games and VK Games**, each with isolated SDK adapters, packages, and acceptance.

1. **No runtime paid AI or server requirement:** game runtime operates offline except for explicitly selected platform SDK functionality and game-owned assets/CDN where permitted. Codex-native ImageGen/Web review operations occur at development time with actual host capabilities; they are not implemented by embedding an OpenAI API key or a pretend AI fallback in games.
2. **Frozen games remain frozen:** CEOS, Starter Kit, «Поцелуй на краю света», «Season of Broken Hearts», their configs, saves, artwork, rights and historical evidence are neither changed nor migrated. No historical CEOS state import. Production-game development starts only after the 1.0 gate and a separate owner decision.
3. `@ludory/core` stays platform-neutral. Runtime controls scheduler, UI, audio, snapshots and optional Phaser. Narrative is an optional data-driven package. Connect owns host SDKs; Release owns publication checks and packaging decisions.
4. User files, dirty/unversioned new-game workspaces, authored assets, save data and evidence are protected; Studio actions have read-only preview and explicit apply when mutating.
5. Do not auto-close PRs, merge conflicts away, force-push, upload platform drafts, publish or submit moderation without explicit authorization. Every feature merges only after independent review, CI at exact HEAD and owner approval.

## 2. What “Ludory 1.0 ready” means

**Must be demonstrated on an isolated, new, non-production Studio fixture:**

- `ludory` can create, inspect, diagnose, and safely update a game, without silently overwriting user-managed files or requiring clean Git.
- A Codex-native development cycle can plan/continue, route source-bound authoring tasks, produce/review an image or return an explicit host blocker, and preserve receipts and recovery state. Actual Web DEV / ImageGen / independent review must be attested by the host to count as a live integration PASS; missing capabilities are `BLOCKED`, never mocked into PASS.
- Core/Runtime/Narrative can play an optional interactive graph and an engine-neutral or Phaser test scene, provide keyboard/touch and wide/portrait UI, audio focus/pause, Back, save/reload, and error recovery.
- Yandex and VK each have an independent connector, isolated output, save and ad behavior (including failure/no-reward), and actual automated SDK-contract/browser verification. A fake SDK yields **CONTRACT_PASS**, never live SDK approval.
- Release produces reproducible, inspectable target-specific bundles and source/hash-bound manifests with explicit release gates. It cannot emit `RELEASE_READY` when required metadata, assets, rights, host evidence or target tests are absent.
- Full relevant Node tests, syntax/check commands, browser smoke and the project smoke matrix succeed in GitHub CI on supported environments. Windows-specific file bytes and native-path behaviors are covered, not assumed from Linux.
- Source changes, statuses, remaining blocked external gates, upgrade instructions and operator use are documented. Tag/ship `1.0` only after final owner sign-off.

**Not required for the framework's 1.0 designation:** a fully written production game, physical-device certification when devices are unavailable, Yandex/VK console authorization, live ad inventory, real game moderation or store publication. Those gates remain separately named `NOT_RUN`/`BLOCKED` and must never be advertised as passed.

## 3. Approaches and selected strategy

| Approach | Tradeoff | Decision |
| --- | --- | --- |
| **A. Six isolated completion phases and a small disposable fixture** | More small PRs, clear ownership and test evidence; protects existing games | **Selected**: owner accepted F1–F6 order and completion before N4 |
| B. Implement remaining integrations in one large branch | Apparent speed, but wider conflicts, unclear cause of regression and difficult acceptance | Reject |
| C. Label existing Core/Runtime/Narrative code “1.0” and postpone Connect/Release | Fast nominal release but the promised VK/Yandex-ready Codex workflow is absent | Reject |

All F-phases must begin from the latest accepted `main`; use worktrees under `LUDORY/.worktrees/`. Do not stack stale Draft branches or equate historic test results with tests on a changed HEAD. A phase can be split into smaller bounded PRs as needed.

## 4. Ordered implementation phases

### F1 — Studio and Codex-native AI reliability

1. Re-evaluate draft [PR #10](https://github.com/m-amirov/ludory/pull/10) against current `main` before attempting a rebase or selective port. Preserve user-managed files, source/inode checks, version semantics, bounded backups and recoverability. Add regression tests for any root-cause change and Windows tests for component updates.
2. Compare superseded Draft [PR #11](https://github.com/m-amirov/ludory/pull/11) and obsolete CEOS [PR #5](https://github.com/m-amirov/ludory/pull/5) with merged capabilities. Report what is already covered; do not merge or close them automatically.
3. Audit actual dev workflow `start`/`continue`/task routing/ImageGen handoff/Web DEV/independent narrative-art-Quality gates. Separate **CLI contract tests**, **real host observed tests**, and **unavailable capability blockers**. Fix broken recovery and missing source binding without requiring old CEOS sessions or external OpenAI API.
4. Complete Studio/AI documentation for single-command Codex operation, capability/permission blockers and updating managed components.

**Gate F1:** safe component-update round trip and conflict matrix in real fresh projects, no changes to frozen projects; `npm test`, `npm run check`, Core example, Windows and Linux CI; valid current-host receipts for live integrations or accurate blocked classification. A fully automated art-pass cannot be claimed from a synthetic helper.

### F2 — Connect Yandex C3–C5

Implement approved specification `docs/superpowers/specs/2026-10-29-connect-yandex-design.md`: C3 namespaced Player cloud-save adapter, C4 fullscreen/rewarded ads, C5 independent Yandex entrypoint/archive and browser SDK-contract smoke. Preserve Runtime pause/manual-pause ownership and no reward without observed `onRewarded`. Do not silently replace failed cloud storage with local.

**Gate F2:** negative and concurrency tests, fake-SDK browser fixture with audio/save/Phaser lifecycle, deterministic bundle inspection. Real Console draft and actual ad inventory remain separate, owner-authorized live gates and are not a prerequisite for `FRAMEWORK_CODE_READY`.

### F3 — Connect VK

First create a distinct VK SDK design/owner review, then an isolated `@ludory/connect-vk` package and VK target build. Do not reuse Yandex connector or claim VK PASS from Yandex tests. Separate web/mobile launch, lifecycle, save and ads; preserve VK desktop wide mode and Android responsive behavior. Avoid silently adding game-specific logic to Core.

**Gate F3:** import without browser globals, explicit SDK absent/error contracts, lifecycle and persistence tests, browser desktop/mobile smoke, no cross-platform SDK contamination, target-specific bundle checks. Live VK console/real devices separate.

### F4 — Release MVP

Build a target-specific, preview-first Release pipeline consuming Studio receipts and source/art/rights manifests. Check package integrity, target identity, entrypoint, asset existence, archive content, required approvals, SDK contracts and provenance; report explicit `PASS`/`FAIL`/`BLOCKED` at each gate. Mutating archive/build operations must not overwrite user outputs on conflict; publishing remains owner-only.

**Gate F4:** reproducible hash-bound bundles from the same frozen input, negative manifest/corrupt asset/foreign SDK/rights tests, no `RELEASE_READY` with missing blockers; no real moderation/publication calls.

### F5 — End-to-end Ludory test fixture

Use a throwaway Studio-created fixture **inside Ludory tests**, not a commercial game and not a frozen repository. Exercise create -> run/continue -> narrative and optional Phaser scene -> photo/keepsake/message echo -> Back/save/reload -> AI handoff and honest external capability outcome -> two platform-specific dry-run packages. Test wide desktop and portrait mobile emulation, offline startup, pause/audio, corrupt saves, upgrade conflict and replay.

**Gate F5:** CI produces run IDs, exact tested HEAD, logs/screenshots, fixtures' hashes, target ZIP hashes, blocked reasons and non-destructive assertions. No claims of physical devices, live external review or platform moderation without direct evidence.

### F6 — Final audit and 1.0 freeze

Reconcile `docs/ROADMAP.md` with code, merge/evidence state and open PRs; audit dependency vulnerabilities, public API/versioning, generated-file provenance, licensing/rights flags and documentation. Freeze stable contracts and runnable operator quickstart. After independent review and all **technical** gates F1–F5 at exact release HEAD, request owner sign-off for the version tag. Record external platform gates as pending without mislabeling them.

**Gate F6:** owner accepts a versioned 1.0 candidate with evidence index and honest live-platform deferrals. N4/full game work starts only afterward.

## 5. Global evidence and stop rules

- Every PR has a stated current base/head, changed-file boundary, a failing negative/regression test before fixes when relevant, CI on exact commit and independent review; `PASS` claims quote checks, counts or artifacts.
- On unavailable Web DEV, ImageGen, browser, host, account, device, reviewer or license evidence, report `BLOCKED` with root cause. Do not substitute model output text or a synthetic verdict for real observations.
- On potential changes to user-owned files, third-party SDK controls, secrets, Git history or platform publishing, stop and obtain specific authorization.
- Support new project automation without mandating real-world game content. SDK/platform publication gates remain isolated per target.

## 6. Deferred work, decisions and implementer discretion

- N4 full-game adoption, rewriting 10 episodes, legacy save import/migration, real game's marketing/monetization and submission are deferred by owner until after F6.
- If current host cannot perform an authenticated AI art or reviewer operation, F1/F5 acceptance distinguishes testable engine behavior from unverified host capability. The owner may need to enable a supported host; this design never lowers the gate silently.
- The implementer may choose file boundaries, small PR split points, fixture narrative text/art, and exact CLI flag names consistent with existing contracts; no mass refactor solely for naming.
- Before each phase, audit current code and official platform docs for drift; do not assume older PR descriptions or `docs/ROADMAP.md` status prose are current.
