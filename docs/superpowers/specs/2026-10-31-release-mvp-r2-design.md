# Release MVP R2 — Yandex field-test preflight (2026-10-31)

## Purpose and constraints

The owner approved the next staged Release MVP step **without uploading or publishing a game**. R1 in `main` validates a C5 candidate ZIP and local fake-SDK evidence, but it cannot establish real Yandex behavior. R2 prepares a reproducible, candidate-bound test matrix for a future owner-authorized real Draft session. It must not contact a remote host, acquire credentials, upload, mutate a game, or report release readiness.

## Approaches

1. **Selected: read-only preflight and untrusted field-observation reconciliation.** Reuse R1's exact ZIP/receipt/local SDK/rights checks, expose required real-host and physical-device observations, and make missing, negative or self-declared evidence visible without promoting it to an authoritative PASS. This can be implemented and tested entirely offline.
2. Browser automation against a live Yandex Draft URL could provide stronger direct observations, but requires an existing owner-provided Draft and separate authorization for platform access. Out of scope now.
3. A free-form checklist alone would not bind observations to a particular ZIP or detect contradictory evidence.

## R2 contract

- New `@ludory/release` export `planYandexFieldTests(options)` accepts the same required paths as `checkYandexRelease` plus optional `fieldEvidencePath`. It calls R1, does not change R1 semantics or files, and returns a deterministic JSON report.
- Studio adds `ludory release plan --archive ZIP --receipt JSON --sdk-evidence JSON --rights JSON [--field-evidence JSON] [--json]`. No `--apply`, network, account, game path, or write mode.
- Report: `schemaVersion: 1`, `kind: 'yandex-field-test-plan'`, `status: 'READY_FOR_FIELD_TEST'|'BLOCKED'|'FAIL'`, `candidateSha256`, `localStatus`, `checks`, `fieldEvidenceGate`, `releaseReady: false`, `publicationAllowed: false`.
- `READY_FOR_FIELD_TEST` means only that the four R1 local checks passed and no supplied field observation reported a failure. **It is never a platform PASS, release approval or permission to upload.** Missing real observations do not block the preparation step; their check rows stay `NOT_RUN`.
- The fixed real-world matrix covers SDK initialization, Loading API, authenticated Player, cloud storage, interstitial/rewarded ads, Chromium/Firefox/WebKit desktop, Android Chromium/iPhone WebKit emulation, and Android/iOS physical devices. Each row has stable `id`, `status`, `reasonCode`. Initial status is `NOT_RUN`, never inherited from the five C5 fake-SDK variants.
- Optional field-evidence JSON has exactly `{schemaVersion:1,target:'yandex-games',candidateSha256:<ZIP SHA>,source:'USER_DECLARED',observations:[{id,status}]}`. Allowed observation statuses: `PASS`, `FAIL`, `NOT_RUN`. Extra/duplicate/unknown check IDs, mismatched SHA, fake `HOST_OBSERVED`/attestation fields, oversized JSON and symlinks are rejected as `FAIL`.
- Self-reported `PASS` always becomes `BLOCKED`/`UNVERIFIED_SELF_REPORT` in the corresponding check, not `PASS`. Self-reported `FAIL` becomes `FAIL`/`REPORTED_FIELD_FAILURE`; `NOT_RUN` stays `NOT_RUN`. Even an all-PASS self-report never proves the platform. The optional evidence gate is `NOT_RUN` if omitted and `BLOCKED` for a valid self-report; invalid input is `FAIL`.
- A missing explicitly specified evidence file yields `BLOCKED`, not an implicit empty PASS. A malformed file or mismatch yields `FAIL`. Negative observations yield overall `FAIL`. R1 `FAIL` always remains `FAIL`; R1 `BLOCKED` remains `BLOCKED` unless R2 has a `FAIL`.
- Read-only bounded files, deterministic order and reason codes, no console output containing raw field evidence, no writes under game projects. Use the existing `ReleaseInputError` and `readRegularBytes` implementation.

## Acceptance and later work

Automated tests must prove: R1 PASS_LOCAL → R2 READY_FOR_FIELD_TEST while all real-host/device checks remain NOT_RUN; R1 FAIL/BLOCKED propagate; valid all-PASS self-report remains UNVERIFIED; self-reported failure blocks; mismatched/forged evidence fails; no `--apply`; no writes. Run `npm test`, `npm run check`, Studio CLI integration against a real C5 builder, and Core example. Follow-up stage R3 may add an independently witnessed real Draft browser runner only after owner authorizes access to an existing Draft; all platform/rights/publication gates remain closed until then.
