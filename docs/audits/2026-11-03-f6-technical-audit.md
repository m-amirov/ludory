# F6 technical audit — 2026-11-03

**Outcome:** `F6_AUDIT_RECORDED / V1_FREEZE_BLOCKED`. This is a completed technical
audit and an evidence-backed remediation list, **not** a `1.0.0` release
certificate, owner sign-off or permission to create a tag. No production game,
old CEOS/Starter Kit repository, platform account or release was modified.

## Basis, scope and evidence

- Reviewed GitHub `main` at [`a2e12b5`](https://github.com/m-amirov/ludory/commit/a2e12b50cbfa087ef5d1845ea66cd9550c6b9254) (merged PR #71). The local audit checkout at `4ff02a2` has the same tracked Git tree `b6718857e96f234f3de705bdab8b5cd7364c6661`; the differing commit IDs reflect the GitHub squash merge. The F6 documentation changes themselves need **new exact-HEAD CI** before merge.
- Compared the [1.0 acceptance design](../superpowers/specs/2026-10-30-ludory-v1-completion-design.md), package exports/versions, Studio/AI trust, Core/Runtime/Narrative, Yandex/VK Connect, Release gates, template build scripts, vendored helper manifest, licensing notices, open PRs and hosted checks.
- `npm test`: **1023 pass, 16 skip, 0 fail**; separate Quality integration: **18 pass, 0 fail**. `npm run check`, `node examples/core-session.mjs`, `npm ls --all --json` exited 0. Focused independent review: Release/Studio-origin 96/96 and Connect-ad 36/36 tests; these counts are subsets, not additional unique full-suite tests.
- Recomputed tracked template bundles without editing their committed bytes: Runtime **58,324 B**, narrative **63,450 B**, Yandex **48,586 B**, VK **45,204 B + 4,381 B**; `check:narrative-template`, `check:yandex-template`, `check:vk-template`, `check:c5-scripts`, `check:v5-scripts` exited 0. This verifies deterministic build output for the checked source/dependencies/environment, not signed source provenance.
- On a **fresh temporary Studio-created narrative-interactive game**: `create` preview and `--apply`, `inspect` (`CURRENT`), components status (`IN_SYNC`), F5b2 source plan (`READY_TO_DERIVE`), platform builds (`CANDIDATES_BUILT_LOCAL`) and independent re-verification (`LOCAL_ARCHIVES_VERIFIED`) succeeded. Building again into distinct empty output directories yielded equal SHA-256 for the two independent ZIPs:

  | Candidate | Two-run SHA-256 | Scope |
  | --- | --- | --- |
  | Yandex | `435badc939bcada45ed3fe43fe6d4e6c63ee31ececd2c10ca54d5357d2f7827c` | Locally derived, not live SDK |
  | VK | `48e6e29e38cb7912c6da788a71e121db75c7e89ae413ae89d365b471e2cd0f48` | Locally derived, not live SDK |

  The VK read-only `release vk-check` verified archive/receipt; live SDK,
  hardware, rights, moderation and publication authorization stayed `NOT_RUN`,
  with `releaseReady:false` and `publicationAllowed:false`. Temporary build
  outputs were **not** checked into Ludory or submitted to any platform.
- **Replay recipe for these exact two ZIP hashes:** from the audited source
  tree with installed lockfile dependencies, choose a new empty directory
  outside Ludory and run
  `node packages/studio/bin/ludory.mjs create --project <empty-game-dir> --id f6-audit-story --title "F6 Audit Story" --lang ru --profile narrative-game --template narrative-interactive --targets yandex-games,vk-games --apply --json`.
  Then use [the executable dual-export example](../OPERATOR_QUICKSTART.md#4-generate-independent-local-platform-candidates)
  with that game directory, and repeat into another empty output directory.
  The nine audited public/source input files resolved to
  `sourceDigest:1540315b14eafb713abcae5ffa39593a8e92ed9daed6279bf547770bdc53666e`
  (the Studio trust receipts are separate). Assert the digest **before**
  comparing the two ZIP SHA-256 values above. A fresh recreation in a
  different temporary game path produced that same digest and both exact ZIP
  hashes twice more. These are locally replayed measurements, not archived,
  signed CI artifacts; other source/dependency versions need their own proof.
- Most recent independently checked full [PR #71 Core CI](https://github.com/m-amirov/ludory/actions/runs/41577173658) completed successfully on Ubuntu/Windows, Node 22/24 (4/4 jobs), alongside [Runtime browser R6](https://github.com/m-amirov/ludory/actions/runs/41577173647) success. That is evidence for the **pre-F6 audited source tree**; it cannot replace checks on a future release/tag HEAD. F5b3's earlier 22 mock-SDK scenarios also do not establish production SDK approval.

### Acceptance design F1–F5 coverage and limits

The [approved 1.0 design](../superpowers/specs/2026-10-30-ludory-v1-completion-design.md)
requires distinct evidence for each phase. No combined `F1–F5_GLOBAL_PASS`
was produced by this audit:

| Gate | Observed technical coverage | Still not observed / scope decision |
| --- | --- | --- |
| **F1 Studio/AI** | Native workflows, component trust, recovery and Quality have passing local/CI contract tests | [F1 host-evidence inventory](2026-10-30-f1-ai-acceptance.md#real-host-and-release-gates-not-exercised) records **zero real-host PASS**: authenticated Web DEV, image-agent `$imagegen`, independent narrative/art review, verified binary browser upload and live interruption recovery remain `BLOCKED`. A configured model or synthetic response is not an attestation. Owner must explicitly defer unavailable live host integration or obtain observed receipts before 1.0 claim |
| **F2 Yandex Connect** | C3–C5 unit/negative tests, bundle, simulated SDK and candidate contracts | Actual Yandex SDK, ads, cloud saves and Console/Draft not run; outside current marketplace gate |
| **F3 VK Connect** | V1–V5 API/negative tests, target-specific Bridge bundle, mock-SDK/browser evidence | Actual VK SDK, portal, device and ad inventory not run; outside current marketplace gate |
| **F4 Release** | R1–R3 local checks, VK static check, independent ZIP hashes and deny-publication invariants | Third-party rights and live platform receipts have no approval; local PASS does not authorize upload |
| **F5 end-to-end fixture** | Paired same-source F5b1–F5b3 local narrative ZIPs and **22** prior browser mock-SDK scenarios; separate test suites exercise Phaser, Back/save/replay, corrupt storage, upgrade conflicts and bounded workflow cycles | A single unified *real-host* Codex/Web/ImageGen → optional Phaser → both ZIPs evidence run with all original F5 design cases has **not** been observed. The later owner decision waived offline startup and real platform checks, **not** missing host attestation. Keep independent contract tests distinct from one-run integrated acceptance |

These unobserved host/integration cells are an explicit **F6 freeze blocker or
owner-decision item**, not a hidden equivalence between mock coverage and
real-host proof.

## Confirmed findings

| Priority | Evidence / root cause | Required disposition before `1.0.0` |
| --- | --- | --- |
| **P1 — Yandex ad pause can hang indefinitely** | `packages/connect-yandex/src/ads.mjs`: an ad that calls `onOpen` but never calls `onClose`/`onError` has no deadline, leaving its Promise pending and Runtime `PAUSED`. Independently reproduced with a silent injected SDK; `destroy()` cancels and restores Runtime. VK ads already have a bounded timer. Existing successful ads tests do not cover this missing-callback case. | Add a validated bounded callback timeout, release the scoped pause, reject without reward, and test timeout/destroy/reentry/lifecycle interactions. This is a framework resilience bug, not an actual live SDK incident. |
| **P1 — installed Web Helper drops license notices** | `packages/ai/src/helper-supply.mjs` installs helper, manifest and vendored `node_modules` into the DEV runtime, but omits the pinned vendor's `LICENSE`, `THIRD_PARTY_NOTICES.txt` and `LICENSES/` declared by `packages/ai/vendor/codex-chatgpt-web/manifest.json`. Vendored `tiktoken`'s MIT text is supplied separately in `LICENSES/`. | Copy/verify the complete vetted notice set with the installed helper and add a regression check. Legal significance of each notice still needs review; source repo presence alone does not establish installed-copy compliance. |
| **P1 — Web Helper source provenance not fully established** | Pinned artifact/2,217-file runtime passes current SHA/tree integrity (`helper c126dd6b…d683b4a7`; runtime `3da4d490…51d20`), but manifest explicitly declares Bun prebuilt `byteReproducible:false`. | Reproduce from pinned source/build tools or have the owner explicitly accept the documented residual supply-chain risk. Do not report `SUPPLY_CHAIN_PASS` solely from hashes. |
| **P2 — Yandex builder/Release size contract mismatch** | `scripts/build-yandex-candidate.mjs` bounds summed inputs, but does not bound final stored ZIP or receipt, while `packages/release/src/archive.mjs` limits ZIP to 100 MiB and `check.mjs` limits receipt to 1 MiB. VK builder checks both outputs. | Align output guards before writing, with ZIP/receipt boundary tests. This can produce an unusable local candidate near limits. |
| **P2 — low-level AI trust contract broader than implementation** | `@ludory/ai` exports low-level `commitNewRun`/`commitNativeEvent`; the Store layer can write receipts for a valid foreign project without Studio-origin verification. F1c tests intentionally rely on this; high-level Codex/Web/Studio mutation paths independently enforce origin trust. | Explicitly designate low-level Store APIs internal/privileged or extend the guard consistently. Do **not** imply every exported AI write is host-trusted today. |
| **P2 — F5b2 programmatic API scope and versioning unresolved** | F5b2 is imported by relative monorepo path, but `@ludory/studio` (private) does not export it as a package API. Root/11 workspace packages/lockfile and CLI still say `0.1.0`. | Decide which symbols are supported public API, freeze contracts, and align/tag a coherent version only after owner sign-off; a `v1.0.0` tag alone would leave packages/CLI at `0.1.0`. |
| **P2 — incomplete license/security/asset attestation** | `npm audit --offline` reported zero advisories, but no current comprehensive root + vendored-runtime SBOM scan was proven; no root `LICENSE`, several first-party workspaces explicitly declare `UNLICENSED` while others omit a license field, and template SVG SHA attestations do not establish ownership/rights. Bundled VK Bridge and SWC license texts are included. | Produce a current advisory/SBOM record covering vendored runtime, decide distribution/license terms and document template image provenance. `UNLICENSED` is not permission to redistribute. |

No P0 was confirmed. An absent vulnerability finding is **not** proof that all
packages are vulnerability-free. The official moderation, third-party content
rights, physical devices, live Yandex/VK ads/SDK and marketplace publication
gates remain deliberately outside this framework milestone and `NOT_RUN`, not PASS.

## Draft PR disposition (read-only review)

Exactly four PRs were open Draft against `main` during this audit; each is
diverged and not currently mergeable. No PR was closed, rebased or merged.

| Draft | Unique work / current overlap | Recommendation |
| --- | --- | --- |
| [#5](https://github.com/m-amirov/ludory/pull/5) | CEOS bridge not in main; native AI replaces it by design | Archive after owner consent; do not merge CEOS integration |
| [#10](https://github.com/m-amirov/ludory/pull/10) | Old component updater; independently superseded by secure F1a [#46](https://github.com/m-amirov/ludory/pull/46) | Check any unique acceptance requirement, then archive; do not replace current trust code |
| [#11](https://github.com/m-amirov/ludory/pull/11) | Routing preflight implemented and evolved via [#12](https://github.com/m-amirov/ludory/pull/12) | Archive as duplicate after owner consent |
| [#66](https://github.com/m-amirov/ludory/pull/66) | Older F5a had unique screenshot/hash/invalid-PNG evidence; F5b1–3 covers the **paired same-source** platform candidates instead | Review selective regression test reuse, then archive; do not merge wholesale. Its exact HEAD Core/browser CI was successful, despite stale PR description |

## F6 freeze decision

- **Completed:** source/API/gate review, dependency/license risk inventory,
  reproducibility checks, fresh local sample game and dual-platform candidates,
  Draft triage, the [operator quickstart](../OPERATOR_QUICKSTART.md), and this evidence index.
- **Blocked:** remediation/explicit acceptance of the three P1 risks above;
  F1 real-host and unified F5 integration gaps (or explicit owner deferral);
  version/package/API contract decision; current comprehensive dependency and
  vendored runtime security review; and final exact-release-HEAD CI plus owner
  approval. These cannot be silently converted to PASS by historical CI.
- **No tag or release:** `v1.0.0` was neither created nor authorized by this audit.
  The next implementation should address independently bounded defects in PRs,
  test them and return for a final owner freeze decision.

Result: **the F6 *audit* is complete; technical `1.0.0` freeze is not yet
accepted.** An unchanged frozen game does not become a migration candidate by
this report.

## Post-audit follow-up (2026-11-03)

- F6a.1 bounded Yandex ad callback timeout was merged as [PR #73](https://github.com/m-amirov/ludory/pull/73).
- F6a.2 installed pinned Web Helper notices were merged as [PR #74](https://github.com/m-amirov/ludory/pull/74).
- [F6a.3 provenance investigation](2026-11-03-f6a3-web-helper-provenance.md)
  verified the immutable upstream tag and replayed both vendored patches
  against exact upstream source blobs. **Binary reproducibility remains
  NOT_RUN and source-to-binary provenance BLOCKED** pending a Bun 1.4.0
  rebuild/byte comparison or explicit owner exception. This addendum does
  not revise the original audit's point-in-time findings or clear release.
