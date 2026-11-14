# F6E — Rights Closure and Security Advisories

Date: 2026-11-14. Scope: Ludory `main` `592dd9232b34a94d81157411d4bd6bba71a3b67a` and game `main` `fe1b821554a71e37bcaa5520d7dadb4cf98482eb`.

This is an evidence and mechanical-package report. It is not an independent legal opinion, does not publish anything, and does not change the release-gate meaning.

## Changes

- Added an explicit allowlist for exactly two OFL notice paths, paired to the two redistributed fonts. Arbitrary `.txt` files remain excluded.
- Added source-side and candidate/archive-side font/notice pairing checks.
- Added regression coverage for a missing notice, a notice changed after planning, an arbitrary `.txt`, an archive missing a pair, and an arbitrary archive `.txt`.
- Added the game rights packet generator and the generated packet at `docs/evidence/f6e-platform-rights-packet.json` in the game repository. It binds source/export SHA-256 values, ZIP member receipts, provenance, notices, attribution obligations and owner confirmations.
- No PNG, WebP, TTF, C2PA-named source file, story, UI, SDK or platform-packing source was changed.

## Platform archives

The new archives were built from the host-bound QA checkout at the exact game commit and independently checked with `verifyNarrativePlatformCandidates`: `LOCAL_ARCHIVES_VERIFIED`, `releaseReady: false`, `publicationAllowed: false`.

| Target | ZIP SHA-256 | ZIP bytes | Expanded bytes | Members |
|---|---|---:|---:|
| Yandex | `ed271d4f89a1eda9033a69a93686831c974914c17325776b88ba38b0407f2b2a` | 31,681,477 | 31,669,021 | 82 |
| VK | `8a9cfa9240d21dee8607db930feb4cd79e4cddf0d4094e397f04886b63fceba7` | 31,694,277 | 31,681,471 | 85 |

The previous ZIP hashes are superseded. Both ZIPs contain, byte-for-byte from the build source, the two font files and:

- `assets/fonts/OFL-CormorantGaramond.txt` — SHA-256 `b2306305139223cbc000c2b9feffaa741687056066c227ba34de31c98eda0814`, 4,480 bytes;
- `assets/fonts/OFL-Manrope.txt` — SHA-256 `4b8929f05a122b7abb9059501dc7dc4df86f8c97d5a1769d60d82cf2d2795dde`, 4,480 bytes.

No `lighthouse.svg`, `shoreline.svg`, Web Helper file, `node_modules` or other unapproved text file is present in either game ZIP. The complete machine-readable member list is in the game rights packet and in the external receipts under `artifacts/f6e-rights-closure-20261114/final-candidates/`.

The trusted QA checkout uses CRLF for the OFL notices while the clean closure checkout uses LF. The exporter did not normalize either input; the packet records the bytes actually admitted to the verified ZIPs. This checkout-byte variance is recorded for owner visibility and is not a legal rights assertion.

## Rights status — game

`RIGHTS_PASS` remains **BLOCKED**.

- 69 resources are `PROVENANCE_DECLARED_ONLY`: 66 non-portrait game/branding resources plus the three branding resources. Their exact source paths, source SHA-256 values, export paths/hashes, provenance declarations, evidence pointers and attribution obligations are listed in the packet. The owner must confirm authority to distribute all 69 SHA-bound resources and any required attribution.
- The four requested portraits are mapped to `docs/migration/m4-mobile-assets.json` and retained as `UNVERIFIED`; generation, source references, SHA-256 and admission evidence do not independently establish a legal distribution grant, and no exact current row exists for them in the canonical `assets/provenance/rights-manifest.json`.

| Resource | SHA-256 | Technical evidence | Rights status |
|---|---|---|---|
| `assets/vis-s03-damir-portrait-v2.png` | `97f69e0ee7dc0ab5999b82518ae0e4521b86eaa5f5b0be17c14bd5ae7614fbde` | Built-in image generation 2026-11-11; reference `assets/cg/s03-editor-call-damir.png`; admission source commit `1e775f1fcd5269b2574b5a120a1f4f6f716ebb8c` | `UNVERIFIED` |
| `assets/vis-s38-alice-nick-ordinary-day-portrait-v2.png` | `fa2b4e6aad5d2a5a482f9b2ca8e2954dfad76b6b188729f1411d6ad9de9dfd2e` | Built-in image generation 2026-11-11; reference `assets/cg/s38-alice-nick-ordinary-day.png`; admission source commit `1e775f1fcd5269b2574b5a120a1f4f6f716ebb8c` | `UNVERIFIED` |
| `assets/vis-s39-alice-damir-cafe-portrait-v2.png` | `cb69e0ab2c8c442eda48335a0fbdf7b23c838839bbfd542709a1c55211c57cf8` | Built-in image generation 2026-11-11; reference `assets/cg/s39-alice-damir-cafe.png`; admission source commit `1e775f1fcd5269b2574b5a120a1f4f6f716ebb8c` | `UNVERIFIED` |
| `assets/vis-s39-alice-damir-cafe-walk-portrait.png` | `815361d1236108ff64644d33bf56bc1c477977a7d4e68ed7de78fef41d9060fe` | Built-in image generation 2026-11-12; reference `assets/vis-s39-alice-damir-cafe-walk.png`; admission source commit `1e775f1fcd5269b2574b5a120a1f4f6f716ebb8c`; independent art review issue is evidence of review, not a rights grant | `UNVERIFIED` |

The fonts are mechanically paired with their OFL notices in both ZIPs; this removes the packaging omission but does not turn a notice, hash, Git history, C2PA or generation statement into an independent legal `PASS`.

## Rights status — Ludory

`RIGHTS_PASS` remains **BLOCKED** for Ludory framework/template distribution. `lighthouse.svg` and `shoreline.svg` remain template assets with no sufficient legal evidence in `docs/evidence/f6e-template-asset-rights.json`; they were not copied into the game ZIPs, so that Ludory blocker is not transferred to the game archive and is not thereby resolved. Vendored Web Helper is development-only for this game packet and is absent from both game ZIPs; its separate Ludory provenance obligation remains open.

## Security advisories

For Ludory `main` commit `592dd9232b34a94d81157411d4bd6bba71a3b67a`, with package-lock SHA-256 `caef6afb9103f72dac44c00e7702db4777193c1fd8348e271d2552fee740961e`:

- `npm ci --ignore-scripts`: exit 0;
- `npm audit --json --audit-level=low`: exit 0, 0 info/low/moderate/high/critical vulnerabilities, 112 dependency records;
- `npm run check:security-inventory`: exit 0, `COMPONENT_INVENTORY_PASS`, 105 components; its legacy output remains `rightsStatus: BLOCKED`, `advisories: NOT_RUN` and was not rewritten;
- `npm run check`: exit 0.

The vendored Web Helper was audited separately for `@mixmark-io/domino@2.2.0`, `playwright-core@1.62.0`, `tiktoken@1.0.22`, `turndown@7.2.0`, `turndown-plugin-gfm@1.0.2` and `zod@4.6.6`: exit 0 and 0 reported advisories. Its artifact SHA-256 is `c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7`; the verified 2,217-file runtime tree is 88,160,302 bytes with SHA-256 `3da4d490af2996bb7a04625fe8fa3f76b1fbb0dd72e93fc4533b6e05ee157d20`; notices integrity passed. `byteReproducible: false` remains a supply-chain/provenance blocker, not an advisory count.

## Verification results

- Ludory focused rights/export/archive tests: 21/21 pass.
- Release archive plus Yandex/VK candidate tests: 39 pass, 1 filesystem-specific skip.
- Game rights packet test: pass.
- Source media integrity check over 75 PNG/WebP/TTF/C2PA-named files: 0 changed files.
- The full game suite also contains pre-existing Windows/cwd-dependent failures in M1/M3 tests (for example fixture paths with newlines and a hard-coded `/game/` suffix); these are outside the rights/export change and are not reclassified as F6E PASS.

## Gate matrix

| Gate | Result | Evidence |
|---|---|---|
| `LOCAL_ARCHIVES_VERIFIED` | `PASS` | New ZIP receipts and independent verifier |
| `PACKAGE_PASS` | `PASS` for the rebuilt local archives only | Updated ZIP hashes, member hashes, expanded sizes, notices and source-media integrity |
| `SECURITY_ADVISORIES_PASS` | `PASS` for the scanned root and vendored dependency snapshots | Raw audit JSON, exit codes and commit/lock hash in `docs/evidence/f6e-security-scan-2026-11-14.json` |
| `RIGHTS_PASS` — game | `BLOCKED` | 69 owner confirmations and four portrait rights records remain incomplete |
| `RIGHTS_PASS` — Ludory | `BLOCKED` | Template SVG legal evidence missing |
| `RELEASE_READY` | `NOT_DECLARED` | Mandatory rights gates remain unresolved |

No publication, merge or release-gate override was performed.

## Required owner decisions / next step

Next step: the owner should review and sign one SHA-bound batch attestation for the 69 declarative-provenance resources, and provide legal/source evidence for the four portrait records (or explicitly reject/replace them); separately, the Ludory owner must resolve the two template SVG rights records. After those documents are present, rerun the rights gate against the unchanged packet and current archive receipts.
