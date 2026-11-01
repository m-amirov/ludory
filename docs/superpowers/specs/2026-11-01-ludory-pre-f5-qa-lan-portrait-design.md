# Ludory before F5 — moderation QA, LAN preview and narrative mobile portrait

**Decision:** On 2026-11-01 the owner selected **B: simulated moderation QA with at most two Codex repair-and-recheck cycles**. The other two requested features are a simple local-network preview of a fresh build and portrait-first mobile presentation for visual novels. This document is a design awaiting owner approval, **not** an implementation or a moderation certificate.

**Baseline:** Remote `main` at `b98b157e428237622fbfb28a344d5df54580ef15` (VK V5 squash merge). Implement before the disposable end-to-end fixture F5 and final freeze F6 in the approved [Ludory 1.0 completion design](2026-10-30-ludory-v1-completion-design.md).

## 1. Outcome and boundaries

The creator can (1) serve the **current, newly built** game to phones/computers on the same LAN without uploading it to a platform, (2) author a visual novel whose mobile layout favors portrait while desktop stays wide, and (3) ask Codex to simulate Yandex/VK moderation, inspect game behavior and presentation, repair confirmed defects within explicit scope, and rerun genuinely independent QA.

- These are **development-time** capabilities for trusted, **new Studio games**. Neither Core nor the game runtime gains an AI service, persistent server or embedded API key. Frozen production games, CEOS/Starter Kit and user-owned files remain untouched.
- Local QA is **not Yandex/VK moderation**. It does not submit drafts, access platform consoles, certify rights, claim physical-device checks, declare `RELEASE_READY` or bypass existing release gates. SDK fakes prove contracts, not live provider compliance.
- The Ludory CLI prepares/verifies deterministic data and source-bound packets. The primary Codex agent performs bounded creative repairs and invokes a genuinely independent, authenticated Web DEV reviewer only if its actual host route is available. A Node CLI must not impersonate agents, a browser or a Web reviewer.
- Read-only plans are default. Creating build artifacts, starting LAN exposure, recording receipts and modifying source require explicit operator commands; repair is additionally constrained to reviewed paths. Never auto-merge, push, publish, submit moderation or change third-party console settings.

## 2. Strategies considered

| Strategy | Tradeoff | Decision |
| --- | --- | --- |
| A. Inspect, report findings, stop | Smallest risk, but repetitive manual repair orchestration | Not selected |
| **B. Inspect, bounded Codex repair, independent reinspection** | Faster iteration with strict provenance and escalation | **Selected**; maximum **2** repair cycles |
| C. Unbounded autonomous retries until PASS | Hides regressions, exceeds source authority, may fabricate success | Rejected |

## 3. Feature P1 — latest-build LAN preview

### Operator contract

Proposed CLI syntax (final naming may align with existing conventions):

```text
ludory preview --project <new-studio-game> [--target web|yandex|vk] [--port 4173] [--json]
ludory preview --project <new-studio-game> --lan [--target web|yandex|vk] [--port 4173] [--json]
```

1. On invocation, validate the trusted Studio origin and resolved project root, compile **from current source**, write to a dedicated, disposable build directory and verify `index.html`, asset references and a build digest. **Never silently serve an older build** after a failed build. Existing user output directories are not overwritten; conflicts stop with a clear reason.
2. Serve only an allowlisted, static **built output root**; not the project root, `.git`, `.ludory`, sources, secrets or arbitrary filesystem paths. Reject traversal, symlink escape, malformed encodings and directory listing; omit source maps/private manifests from the served distribution. A release-target build and a local playable/dev build must be clearly differentiated.
3. The default binds `127.0.0.1`. Only `--lan` opts into a private IPv4 LAN interface, prints the usable `http://<lan-ip>:<port>/` URL and, where terminal support permits, a QR code. Reject/publicly warn on missing suitable private interface rather than binding blindly to a public address. No UPnP, firewall changes, tunnel or internet exposure.
4. Give actionable errors for unavailable port, blocked firewall, separate Wi-Fi/guest network and missing network interface. `Ctrl+C` shuts down the server. An optional future `--watch` must rebuild atomically and clearly report failures; v1 may use restart-to-rebuild, documented as such.
5. Browser/device tests use the **same served bytes** identified by a build hash. Yandex/VK SDK APIs not accessible outside the host portal remain `MOCKED` or `NOT_RUN`, never live checks. A platform-neutral `web` preview is always clearly labeled.

### Acceptance

- Edit a source file, launch preview, and observe changed built output and different digest; build error must stop rather than show stale content.
- Open the same URL on desktop and a phone in the same LAN (if an actual phone/network is available); automated network tests cover loopback and private-LAN binding without pretending to have a physical device.
- Probe encoded `..`, absolute paths, symlinks, hidden files, `.env`, `.git` and another project: none may be served. Default loopback must not be reachable on LAN; no implicit exposure or persistence after stop.

## 4. Feature P2 — portrait-first narrative mobile UI

1. New **narrative/visual-novel** templates declare a preferred mobile presentation of `portrait`; other genres keep their defaults. Preserve desktop wide mode and author ability to opt out per **new** project. Do not rewrite created or frozen games during a component update without source ownership and explicit approval.
2. Responsive CSS and viewport metadata prioritize comfortable portrait reading: scene art composition, text legibility and line length, tap targets, choice controls, safe-area insets, software keyboard and scroll within dialogue rather than unintentional page scroll. Maintain semantic focus order and accessible zoom; do not prohibit landscape use.
3. Preference is not a promise of operating-system orientation lock. Host-console orientation is configured separately when supported; expose the intended value in target metadata/checklists, with `MANUAL_PLATFORM_SETTING` until observed. In a landscape-held phone, present usable fallback/optional rotation hint, without losing state.
4. Distinguish viewport shape from device category so narrow desktop windows and large phones remain usable. Do not regress desktop wide art composition or generic Runtime/Phaser layouts. Progress/save and audio must survive viewport resize and orientation changes.

### Acceptance

- Browser snapshots and interaction tests at representative narrow portrait Android/iPhone, phone landscape, tablet and desktop wide sizes; no clipped text/buttons, unwanted page overflow, focus traps or control loss.
- Choice → dialogue → Back → save/reload works before and after resize/rotation; desktop and other templates remain behaviorally unchanged.
- Yandex's official requirements explicitly test resizing/orientation and progress retention; treat these as evidence-backed checks, not a guarantee of console orientation settings.

## 5. Feature P3 — simulated moderation QA with strategy B

### Relationship to existing Ludory systems

- `ludory quality check` remains Engineering Quality (tests/tool checks), **not** independent gameplay or platform moderation. Reuse its receipts and deterministic tests, but do not rename a Quality PASS into moderation PASS.
- Existing `workflow cycle --repairs 0|1|2` demonstrates a bounded Codex test-repair mechanism; QA reuses source-bound execution patterns and stop semantics without reusing its test result as an independent reviewer verdict.
- The Yandex Release gates and VK `moderation: NOT_RUN` remain unchanged. A simulated report may be attached as **advisory evidence** only, never fill real console, device, legal/rights or platform moderation gates.

### Proposed operator contract

```text
ludory qa moderation plan --project <new-studio-game> --targets yandex,vk [--json]
ludory qa moderation run --project <new-studio-game> --targets yandex,vk --apply [--json]
ludory qa moderation run --project <new-studio-game> --targets yandex,vk --repair --in-scope <path;path> --mutation-boundary <text> --apply [--json]
ludory qa moderation status --project <new-studio-game> [--run latest|<id>] [--json]
ludory qa moderation evidence --project <new-studio-game> --run <id> [--json]
```

`plan` is non-mutating. `run --apply` captures the initial QA run. **One explicit opt-in** with `--repair --in-scope ... --mutation-boundary ... --apply` authorizes Codex to perform **up to two automatic repair/review rounds**, without asking again for every safe in-scope patch. The allowlist and boundary are pinned to that run, cannot silently expand after a finding, and must exclude protected/user-managed files. Codex workspace instructions alone are not a filesystem sandbox: compare pre/post file identities, hashes and changed paths after each round; unexpected writes, out-of-scope fixes or missing authorization stop with `ESCALATE`, preserving evidence for owner inspection (no destructive auto-rollback). The CLI issues source-bound repair/review packets and checks receipts; it does not secretly spawn a Web session or self-attest independent inspection. The exact repair CLI naming is implementer discretion as long as explicit consent and limits survive restart/recovery.

### QA evidence pipeline

1. **Pin candidate**: trusted new Studio game, selected target(s), source tree digest, build digest, dependency versions, requirement-checklist revision/URL/check date and a unique immutable QA run ID. Two targets produce separate subreports; do not infer VK from Yandex.
2. **Deterministic technical stage**: build/archive inspection, entrypoint/asset integrity, SDK/ad/save/audio lifecycle contracts, focus/tab switch, no-reward ad failure, pause/resume, offline startup where applicable, reload and orientation/resize, keyboard/touch/navigation, text/overflow, runtime errors and supported browser emulations. Per rule, attach observed command, environment, exit code, screenshot/log and exact artifact digest. Where no actual SDK/portal/device is available, explicitly mark `MOCKED`, `NOT_RUN` or `BLOCKED`.
3. **Independent experiential review**: a separate authenticated GPT-6 Sol(Web) DEV reviewer, when **actually observed/attested**, receives minimal reviewed source context plus fresh screenshots, navigation trace and/or real browser recording of this build. It evaluates onboarding, clarity of goals/controls, scene pacing and finish, text and language, portrait readability, contrast, visual cohesion, confusing choices and potentially problematic presentation. It returns finding IDs with severity, relevant evidence and actionable recommendations. A text-only simulated response, unobserved image upload, primary-agent self-review or missing host is `BLOCKED`, not PASS.
4. **Aggregate**: normalize findings by platform and by type (`TECHNICAL`, `EXPERIENCE`, `PLATFORM_MANUAL`). Levels `P0`/`P1` block the simulated result, `P2` are nonblocking recommendations. Missing mandatory **local** evidence or independent reviewer gives `BLOCKED`; conflicting observations require recheck rather than optimistic pass. Produce a human-readable report plus machine-readable source-bound receipt. Include known unknowns and a prominent **`SIMULATED — NOT PLATFORM APPROVAL`** label.
5. **Repair loop B**: Codex proposes a concrete patch for observed P0/P1 issues within the new game's authorized files; verifies root/path/ownership and protected-file exclusions; writes only after explicit repair application authorization. Rebuild from changed source, rerun deterministic technical QA **and a fresh independent review** against the new digest. Every iteration records parent/source/build/reviewer receipt IDs and findings resolved/regressed. Never carry a prior reviewer PASS across a changed build.
6. **Stop**: initial review plus **at most 2 repairs and 2 independent reinspections**. Stop early on no blocking findings, unsafe change, missing executor/Web host, stale source, ambiguous rights/content issue, or unaddressed user choice. After the limit, unresolved P0/P1 yields `ESCALATE` with remaining findings; a P0 regression stops immediately. Do not rewrite the source to silence checks, broaden scope silently or retry indefinitely.

### Status semantics

| Result | Meaning |
| --- | --- |
| `QA_SIMULATION_PASS` | All in-scope observed checks and independent review meet the simulated QA policy; P2 notes may remain. **No real platform approval.** |
| `REWORK` | P0/P1 findings; repair permitted only with authorization and remaining budget. |
| `BLOCKED` | Missing/unverified reviewer, browser, trustworthy provenance or required evidence; also unsafe/stale source. |
| `ESCALATE` | Two repair cycles consumed, persistent P0/P1, a dangerous regression or a decision outside scope. |
| `NOT_RUN` | Nothing observed for that stage/target, including real platform submission. |

The receipt always contains `platformModeration: NOT_RUN`, independent of `QA_SIMULATION_PASS`; manual legal, rights, live SDK, developer-console and physical-device checks remain separately pending. Evidence includes exact HEAD/source/build digest, run/round ID, timestamps, observed model/host or reason code, screenshots/log hashes, affected paths and full finding history. Crash/recovery is append-only; a timed-out host may still be active and cannot be blindly restarted or marked successful.

### Acceptance and negative cases

- A deterministic fake SDK with a real browser trace yields only SDK `CONTRACT_PASS`; no fabricated live SDK/moderation approval.
- Inject a clipped mobile choice, focus-audio leak, save-loss-on-rotate and rewarded-ad-without-reward defect in a disposable new game: corresponding technical or experiential findings are evidenced; after a real bounded fix the candidate is rebuilt and reinspected independently.
- Reject a swapped screenshot, changed source, missing reviewer attestation, stale review, falsified exit code, malicious relative path, symlink escape, unexpected rewrite of a user file and conflicting target identity.
- At cycles 0/1/2 assert no third repair, no status upgrade on `BLOCKED`, no self-review counted as independent, and `ESCALATE` with unresolved P0/P1; simulate interrupted host execution and explicit recovery.
- Ensure no write to frozen projects, real platform consoles, third-party SDK settings, generated art without rights review, or other repositories.

## 6. Delivery order and PR gates

1. **P1 — LAN preview:** small Studio/build/server package with security and current-build tests; operator quickstart.
2. **P2 — narrative portrait:** template/profile metadata, Runtime Narrative CSS/viewport and browser regression matrix; unchanged desktop behavior.
3. **P3 — simulated moderation QA B:** checks/receipts, authenticated independent review handoff, two-cycle controlled repair, honest blockers and documentation. If needed, split deterministic QA and reviewer/repair into separate PRs without weakening acceptance.
4. Then resume **F5** end-to-end disposable fixture, incorporating preview, portrait and QA outcomes; then **F6** release audit/tag decision.

Each feature starts from the then-current accepted `main` in a separate worktree under `.worktrees`, uses failing/regression tests before implementation and runs `npm test`, `npm run check`, `node examples/core-session.mjs` for Core/Studio changes plus relevant Playwright/browser tests. Independent code review, exact-HEAD CI and the owner's explicit approval are required before each merge. Unavailable physical device/Web DEV/portal evidence is reported honestly, not quietly omitted.

## 7. Open implementation choices (not product decisions)

- Placement of the isolated build output and use of an existing build adapter vs. a minimal new `web` adapter; choose the smallest way that serves exactly verified runtime bytes, without mixing SDKs.
- QR code implementation and optional watch mode after safety tests; URL print is mandatory.
- Precise CLI subcommand names and per-target checklist identifiers may follow existing Studio/Release patterns; all preview/apply, source-binding, independent-host and two-cycle guarantees are fixed by this design.
- Platform requirement snapshots must be periodically refreshed from primary official sources. As of this design, Yandex references include [full requirements](https://yandex.com/dev/games/doc/en/concepts/requirements), [moderation](https://yandex.com/dev/games/doc/en/concepts/moderation), [correct display](https://yandex.com/dev/games/doc/en/requirements/1/10) and [draft orientation](https://yandex.com/dev/games/doc/en/console/add-new-game/draft). Do not claim a VK-specific rule until its current primary wording is verified; mark it `RULE_SOURCE_UNVERIFIED` if unavailable.
