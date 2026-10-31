# @ludory/release — Release MVP R1

Read-only local Yandex candidate verification. No network calls, uploads, publication, moderation or mutation of games/artifacts.

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
