# Release MVP R1 — local verification design (2026-10-31)

## Intent and boundary

Ludory must verify a **specific** generated Yandex candidate ZIP before anyone considers it for release. C5 already builds ZIPs and produces local fake-SDK evidence, but those contracts do not certify a live platform, real advertising, rights, devices or publication readiness. The owner selected a staged, offline-first Release MVP; **nothing is uploaded, deployed or published** by R1.

## Approaches

1. **Chosen: independent fail-closed local Release package** with a read-only Studio command, separate integrity checks and explicit blocked live gates. Works with the C5 builder without modifying any game; another package can later add genuinely independent platform receipts.
2. All-in-one pipeline that drives Yandex Console: offers closer production evidence, but requires an owner account and permission to upload, and cannot be safely automated in this phase.
3. Documentation-only checklist: low cost but cannot enforce hash bindings or reject forged promotion from SDK-contract PASS.

## R1 contract

- CLI: `ludory release check --archive <candidate.zip> --receipt <c5-build-receipt.json> --sdk-evidence <yandex-c5-contract.json> --rights <rights.json> [--json]`. No `--apply`, game path, credentials, network, mutation or publishing subcommand.
- New isolated `@ludory/release` library; it must not import Core, Studio project writers, Connect runtime or the Yandex SDK. Inputs are **local snapshots** and are untrusted until checked.
- Archive check: read regular non-symlink ZIP (at most 100 MiB); inspect C5's deterministic **stored** ZIP format; reject encrypted/compressed/ZIP64 entries, path traversal, Windows-reserved or case-colliding names, duplicate entries, file-boundary corruption, nonregular ZIP layout and over-budget expanded size. Require one root `index.html`, C5's four required paths, valid Yandex-only project manifest, and no copied `sdk.js`.
- Build receipt check: rehash ZIP bytes and each entry; require one-to-one correspondence with `buildYandexCandidate` receipt (`sha256`, `files`: path, sha256, size). This shows consistency, **not authenticated build origin or a cryptographic signature**.
- C5 evidence check: schema/stage and `sdk: 'fake /sdk.js served only by fixture'` with `liveYandex: 'YANDEX_LIVE_NOT_RUN'` and `physicalDevices: 'NOT_RUN'`; exact ZIP SHA; no claimed `RELEASE_READY` / live PASS. Require PASS outcomes for five declared browser/device variants (Chromium, Firefox, WebKit desktop; Android Chromium and iPhone WebKit emulation). Evidence is user-supplied local data, not independently attested live testing.
- Rights declarations check: versioned document with exact `candidateSha256`, target `yandex-games` and one entry for each shipped media asset (images, audio, fonts), binding path + SHA with provenance (`owned`, `licensed`, `public-domain`) and a nonempty evidence reference. No generic `rightsApproved: true` override. An internally consistent declaration is **not** independent legal clearance.
- Output: versioned deterministic JSON gate list with `PASS`, `BLOCKED`, `FAIL` and machine-readable reason codes; aggregate `PASS_LOCAL` only when all four *local* gates pass, `BLOCKED` for missing inputs, `FAIL` for contradictions/tampering. Permanent `releaseReady: false`, `publicationAllowed: false`, separate `NOT_RUN` gates for live Yandex, owner publication authorization and rights clearance. CLI exit 0/2/1 for `PASS_LOCAL`/`BLOCKED`/`FAIL` respectively.
- The verifier must perform **zero writes** including on failure, must not read beyond bounded input files or dereference symlinks, and must not touch frozen CEOS, Starter Kit or game projects.

## Anti-goals and later gates

Do not claim source origin, signatures, rights legal sufficiency, genuine SDK acceptance or release readiness from manually supplied JSON. Do not introduce services, API keys, ad calls, Console automation, moderation submissions or a one-button publish feature. Later R2 requires real Yandex draft and device/browser observations, independent provenance and explicit owner authorization before any external writes. Connect VK has its **own** isolated target gates.

## Acceptance

Test a genuine generated C5 ZIP/receipt, valid five-variant fixture evidence and complete rights declarations: `PASS_LOCAL` / `releaseReady=false`. Alter archive, hashes, manifest or a single right: `FAIL`/`BLOCKED` with actionable reasons. Fake live PASS, truncated ZIP, symlinks, traversal and missing evidence cannot yield `PASS_LOCAL`. Entire Ludory Node suite, check command and Core example must pass on the final HEAD; document any sandbox-related baseline differences and do not call R1 a platform release.
