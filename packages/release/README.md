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
