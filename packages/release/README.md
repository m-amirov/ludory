# @ludory/release — Release MVP R1

Read-only local Yandex candidate verification. No network calls, uploads, publication, moderation or mutation of games/artifacts.

## P3b.1: Verified inert ZIP staging (no browser execution)

`stageQaCandidate({ target, archivePath, candidateSha256 })` materializes an already
independently verified Yandex C5 or VK V5 candidate into a private temporary
directory. This helper reuses Release's canonical stored-ZIP parser, bounds and
CRC checks, and verifies the exact candidate SHA-256 before writing anything.
Every staged file is rehashed. `cleanup()` is idempotent and refuses to delete
a staging directory if its identity has changed. The original ZIP and Studio
project are never modified.

**This function only copies inert bytes.** It does not run the game or a
browser, does not establish OS/container isolation, and creates no browser
observation evidence. Do not serve staged content in an unsandboxed browser,
especially not with Chromium `--no-sandbox`. Until P3b.2's verified,
network-restricted, credential-free execution environment is implemented,
the `browser-observation` QA check must remain `BLOCKED/BROWSER_NOT_RUN`.
No release or moderation permission is implied.

## P3a: Read-only pre-moderation QA simulation (Yandex / VK)

Use `simulateModeration()` or the Studio command to inspect a **specific, already built** candidate. P3a does not run the game, open a browser, contact Yandex/VK, upload assets, submit to moderation, or mutate the ZIP/project. The owner must designate the candidate; a ZIP alone cannot independently prove Studio origin.

```sh
node packages/studio/bin/ludory.mjs qa simulate \
  --target yandex-games --archive candidate.zip --receipt receipt.json \
  --sdk-evidence yandex-c5-contract.json --rights rights.json --json

node packages/studio/bin/ludory.mjs qa simulate \
  --target vk-games --archive vk-candidate.zip --receipt vk-receipt.json \
  --rights vk-rights.json --json
```

The Yandex C5 SDK evidence is a **local simulated-browser contract**, not a live Yandex session. The VK Bridge gate verifies the **bundled local bridge**, not a production `VKWebAppInit`. VK rights declarations are optional as command input but missing declarations result in `BLOCKED`. The existing Yandex Release R1 rights and C5 evidence checks remain required.

Optional `--metadata listing.json --promo-root ./promo` checks bounded, source-bound declarations and actual local icon/cover bytes. The JSON contract is:

```json
{
  "schemaVersion": 1,
  "target": "yandex-games",
  "candidateSha256": "<actual ZIP SHA-256>",
  "projectId": "<project ID from ZIP>",
  "listing": {
    "name": "Example Game",
    "description": "A short description",
    "howToPlay": "Tap to continue",
    "category": "visual-novel",
    "version": "1.0.0",
    "platforms": ["desktop", "mobile"],
    "orientation": "portrait"
  },
  "content": { "ageRating": "12+", "contentWarnings": [] },
  "promo": [
    { "kind": "icon", "path": "icon.png", "sha256": "<actual icon SHA-256>" },
    { "kind": "cover", "path": "cover.webp", "sha256": "<actual cover SHA-256>" }
  ]
}
```

For VK, change `target` to `vk-games` and supply a candidate-bound `--rights` declaration with the same asset/provenance format shown below (using `vk-games`). `listing.version` must equal the version independently read from the candidate ZIP manifest. Each `promo.path` is relative to `--promo-root`; both files must exist, be regular PNG/JPEG/WebP with matching SHA-256, structurally valid image data and bounded nonzero dimensions. Structural parsing is **not** image-quality review or guaranteed full JPEG/WebP pixel decoding. Symlinked inputs and static symlinked parent directories are rejected; an adversary concurrently replacing path ancestry during inspection remains outside the guaranteed snapshot model. `ageRating`, `contentWarnings`, listing fields, media provenance and promotional copy are owner declarations, **not** legally verified or approved platform fields. Unknown attestation fields and duplicate JSON keys are rejected.

Reports have an ordered target-specific rule pack revision, actual candidate SHA, per-rule `PASS`/`BLOCKED`/`FAIL`, P0/P1 findings and unresolved scopes. Observed local evidence carries `evidenceSha256` where available: for promo integrity the digest covers the original metadata-byte hash and both verified image hashes in declared order; inherited local Release evidence is re-read for a bounded SHA snapshot. This is reproducibility information, **not** a signed or immutable evidence attestation; re-run QA if any inputs can have changed. `ISSUES_FOUND` (CLI exit `1`) means a local required failure; `BLOCKED` (exit `2`) means independent checks are pending. Browser observation, visual UX, content, promo judgment and live platform moderation cannot pass in P3a, so exit `0` / `PRECHECK_CLEAR` cannot currently occur. A missing/mismatched receipt or declaration cannot be repaired by editing the report.

The report always retains `reviewProvenance: "NOT_RUN"`, `actualModeration: "NOT_RUN"`, `releaseReady: false` and `publicationAllowed: false`. Yandex sources are pinned to the pack revision; official VK moderation policy source verification is incomplete, so `platform-policy` explicitly remains `BLOCKED/POLICY_SOURCE_UNVERIFIED`. **Nothing in this simulation permits a moderation submission or publication.**

## VK V5 local candidate check (separate from Yandex R1/R2)

`ludory release vk-check --archive <vk-candidate.zip> --receipt <build-receipt.json> --json` runs the read-only `checkVkCandidate()` API against a stored VK-only ZIP created by `scripts/build-vk-candidate.mjs` and the complete builder receipt. The ZIP must include its own pinned local VK Bridge and Runtime bundles and both third-party licenses. The verifier independently checks ZIP layout, member CRCs, VK manifest, hashes and the full receipt. No game files are changed.

The maximum status is `PASS_LOCAL`. It is **not** an SDK/device test, a rights certificate, a production VK Hosting observation or publication permission. `platform-live`, `physical-devices`, `rights-clearance`, `moderation` and `owner-authorization` remain `NOT_RUN`; `releaseReady` and `publicationAllowed` always remain `false`. The existing Yandex R1/R2 protocols remain unchanged.

```js
import { checkYandexRelease } from '@ludory/release';
const report = checkYandexRelease({ archivePath, receiptPath, sdkEvidencePath, rightsPath });
```

Inputs:

1. `archivePath`: unmodified C5 `buildYandexCandidate` ZIP (deterministic uncompressed/stored ZIP; other ZIP formats intentionally blocked).
2. `receiptPath`: saved JSON output from `buildYandexCandidate`, containing `sha256` and the **complete** `files` array.
3. `sdkEvidencePath`: local `yandex-c5-contract.json` from C5 browser smoke, with five variants and explicitly `YANDEX_LIVE_NOT_RUN`.
4. `rightsPath`: manually prepared versioned declarations, e.g.:

```json
{
  "schemaVersion": 1,
  "target": "yandex-games",
  "candidateSha256": "<actual archive SHA-256>",
  "assets": [
    {"path": "assets/cover.png", "sha256": "<actual asset SHA-256>",
     "provenance": "owned", "evidence": "Local original image and author ledger reference"}
  ]
}
```

Every shipped media file (image/audio/font) must have exactly one declaration. Allowed provenance values: `owned`, `licensed`, `public-domain`. Evidence is a human-checkable reference, **not an independently authenticated license**. Auto-discovered hash consistency does not prove copyright permission.

Exit statuses: `PASS_LOCAL` means only the ZIP, builder receipt, C5 simulated-browser results and declarations agree. `BLOCKED` means missing information; `FAIL` means an invalid/mismatched input. Independently of local status, `releaseReady=false`, `publicationAllowed=false`. R1 has no signature trust anchor and no production Yandex receipt. Real Draft, physical-device coverage, human rights clearance and explicit owner authorization remain `NOT_RUN`.

## R2: Field-test readiness plan (offline)

`planYandexFieldTests` and `ludory release plan` reuse the same four input files as R1. The report inventories 13 real-host, browser and physical-device checks in a deterministic order. If local R1 checks pass, `READY_FOR_FIELD_TEST` means a candidate can **be considered** for separately authorized testing; it does not mean it was tested or may be uploaded.

Optionally supply a `--field-evidence` file containing only these fields:

```json
{
  "schemaVersion": 1,
  "target": "yandex-games",
  "candidateSha256": "<actual archive SHA-256>",
  "source": "USER_DECLARED",
  "observations": [
    { "id": "sdk-initialization", "status": "PASS" },
    { "id": "ads-rewarded", "status": "NOT_RUN" }
  ]
}
```

Supported check IDs: `sdk-initialization`, `loading-api`, `player-authenticated`, `cloud-storage`, `ads-interstitial`, `ads-rewarded`, `desktop-chromium`, `desktop-firefox`, `desktop-webkit`, `mobile-android-emulated`, `mobile-ios-emulated`, `physical-android`, `physical-ios`.

Self-reported `PASS` maps to `BLOCKED/UNVERIFIED_SELF_REPORT`, while self-reported `FAIL` blocks the plan. There is intentionally **no** `HOST_OBSERVED` input accepted from ordinary JSON: an editable file cannot attest its own provenance. Live Yandex, real-device acceptance and independent rights or publication authorization require a later separately authorized procedure. R2 performs no network operations or writes; `releaseReady=false` and `publicationAllowed=false` remain permanent.
