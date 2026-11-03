# F6e — security, license and asset evidence inventory

Date: 2026-11-03. Approved context: continue the F6 remediation roadmap after
F6d; no `1.0.0` freeze, no platform publication, no migration of frozen games.

## Goal and boundaries

Produce an independently repeatable snapshot of what Ludory ships or pins:
the root npm lock graph (including platform-optional entries), all 11 local
workspaces, the six separately vendored Web Helper runtime packages, notice
integrity, and the two narrative template SVGs. Every item must have its own
source identity and an honest rights/security status. A clean hash or license
label is **not** evidence of ownership or vulnerability clearance.

## Approaches

1. Report-only, manual inventory: smallest diff, but becomes stale with any
   lockfile, helper or template change; rejected for lack of repeatability.
2. **Chosen — deterministic source-local inventory with a check gate:** derive
   CycloneDX-compatible package components from tracked lockfile/manifests,
   verify pinned vendor notices, and bind an explicit unresolved-rights ledger
   to template SHA-256. No new runtime dependency or external scan service.
3. Introduce an online scanner plus licensing-approval system: valuable for a
   future release, but unstable under network restrictions and cannot make an
   owner/legal rights decision automatically; deferred.

## Required behavior

- `scripts/f6e-inventory.mjs` generates a deterministic CycloneDX 1.5
  component inventory from lockfile npm packages, workspace manifests and the
  six helper runtime packages named in the vendored manifest. Preserve the
  source class and exact version/license *claim*; convert SHA-512 lock SRI to
  standard digest bytes, without claiming any external vulnerability scan.
- Verify helper notice SHA-256 and bytes from its manifest. Reuse the existing
  helper-supply verifier to check both the prebuilt artifact digest and the
  full vendored runtime tree against the manifest, rejecting changed/extra
  executable files as well as missing or inconsistent package manifests.
- `docs/evidence/f6e-template-asset-rights.json` lists exactly the template
  image/audio/video/model/font assets with fixed SHA-256 and status `UNVERIFIED` until separately
  reviewed rights evidence exists. Fail the technical integrity check for a
  missing/edited/unlisted media file. An integrity PASS keeps rights `BLOCKED`.
- `node scripts/f6e-inventory.mjs --check` must compare freshly generated BOM
  bytes with the committed version. `--write` is a maintainer action for a
  deliberate update; neither mode rewrites game projects or source assets.
- Integrate the read-only `--check` with `npm run check` and cover failure
  cases using bounded fixtures. `npm audit --offline` is informational only.
- Remediate the observed `fflate@0.8.2` ZIP64 parsing advisory by updating
  the pinned dev dependency to `0.8.3` and rerunning online `npm audit` and
  candidate/test checks. Report the advisory and exact scan outcome.

## Release meaning

F6e yields `COMPONENT_INVENTORY_PASS` at most. Vendor provenance, unknown
first-party distribution terms, template graphic rights and unverified live
host/platform evidence remain individually `BLOCKED`/`NOT_RUN`. No generated
BOM, unit test or npm audit result authorizes `1.0.0`, redistribution or a
game upload.
