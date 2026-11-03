# F6e: dependency, license, and template-media inventory

Date: 2026-11-03. Scope: the Ludory monorepo at the F6d `main` baseline
`1ca1b57116d612102ee1a8668a973eeabaff40c2` plus the F6e candidate
changes. This report records **technical inventory and observed advisory
results**, not legal ownership, source-to-binary provenance, or readiness to
publish games. No legacy game or platform was contacted or modified.

## Reproducible local inventory

Run from the repository root:

```sh
npm ci --ignore-scripts
node scripts/f6e-inventory.mjs --check
npm run check:security-inventory
```

The checked-in [CycloneDX 1.5-format component record](../evidence/f6e-components.cdx.json)
is generated with `node scripts/f6e-inventory.mjs --write`. It inventories
**103 component records** from three distinct, locally verifiable sources:

| Source | Count | Evidence boundary |
| --- | ---: | --- |
| npm root lockfile | 86 | All declared external packages, including platform-optional packages; exact versions and SHA-512 integrity from `package-lock.json` |
| Ludory workspace manifests and lockfile | 11 | First-party workspace names and versions; not third-party rights proof |
| separately vendored Web Helper runtime `node_modules` | 6 | Pinned `manifest.json`, actual package manifests and five pinned legal notices; not independently installed by root npm |
| **Total** | **103** | Source inventory, not a single combined installed or vulnerability-scanned dependency graph |

The document follows the CycloneDX 1.5 JSON shape and is regenerated and
byte-compared by a local check. It has **not** been independently certified
against an external schema. Native `npm sbom --sbom-format=cyclonedx` from
this Linux installation listed **50 installed components**; installed
platform-optional coverage is narrower than the lockfile inventory.

The check reads the vendored `LICENSE`, `THIRD_PARTY_NOTICES.txt` and the
three listed `LICENSES/*` texts, verifying manifest-declared sizes and SHA-256
digests. It fails on missing/extra runtime packages or manifest/package
version mismatches, and reuses the canonical Web Helper verifier for the
**entire 2,217-file runtime tree** (88,160,302 bytes, manifest SHA-256)
and the **216,615-byte** `browser-helper.cjs` artifact. Modified or additional
executable bytes fail the precheck. These hashes confirm *which bytes and
notices exist*, not whether the bundled prebuilt Web Helper can be reproduced
from source or whether distribution obligations have been met.

## Online advisory scan and remediation

The pre-change `npm audit --json --audit-level=low` was executed online
against the root lockfile. It returned exit code **1**, **one moderate**
advisory for direct dev dependency `fflate@0.8.2`:

- `GHSA-px8p-9vwx-vf98` / `CVE-2026-45820`: `unzipSync` could loop
  indefinitely on a malformed ZIP64 archive; affected range `>=0.8.0 <0.8.3`.
  The advised patch is `fflate@0.8.3`.
- Ludory's candidate builders use `zipSync`; `unzipSync` is also used by
  tests and fixtures. The advisory was **not** dismissed on the assumption
  that a dev-only package is harmless.

F6e pins `fflate@0.8.3` and updates `package-lock.json`. The second **online**
`npm audit --json --audit-level=low` returned exit code **0**, with
`info=0, low=0, moderate=0, high=0, critical=0, total=0` for the scanned
**root npm lockfile**. The earlier `npm audit --offline` returning zero is
explicitly **not** treated as evidence that no advisories exist. The vendored
Web Helper tree has no independent lockfile audit in this change and is
**outside** that root npm audit's coverage. The scan is time-dependent;
the committed local inventory check does not claim to rerun it.

References: [GitHub advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98),
[fflate releases](https://github.com/101arrowz/fflate/releases).

## First-party licensing and template assets

The repository root has **no root LICENSE**. Of 11 Ludory workspaces,
eight declare `UNLICENSED` and three omit `license` (`@ludory/ai`,
`@ludory/runtime-narrative`, `@ludory/studio-trust`). None of these metadata
values grants permission to third parties to redistribute Ludory or its
assets. The actual planned distribution/license policy is **OWNER_DECISION_REQUIRED**.

The [template asset ledger](../evidence/f6e-template-asset-rights.json) binds
two narrative-interactive SVG files by SHA-256:

- `assets/lighthouse.svg`: `850eca9c5f6829f7c4a5c3fe2267d174236bc83de568ed494c16e500a30cf772`
- `assets/shoreline.svg`: `b95df7d7019e16a4885deff503260c602832b0561f38eb2b190c06f44c85abb5`

Both have `provenanceStatus=UNVERIFIED`, `evidence=null`,
`rightsStatus=BLOCKED`. The check rejects edited, deleted or newly added
unlisted template image, audio, video, model and font assets (including GIF,
AVIF, MP4 and TTF). It also inventories any new non-JavaScript file in a
template `assets/` directory (e.g. KTX2 textures), independent of extension.
These hashes are **byte identity only**. The check
is deliberately fail-closed if someone edits the ledger to fabricate a
positive rights verdict; there is no automatic rights approval workflow.

## Remaining blockers and acceptance boundary

| Area | Current result | Remaining action |
| --- | --- | --- |
| Lockfile and vendored package inventory | `COMPONENT_INVENTORY_PASS` | Recheck every change; independently validate schema if a publication pipeline later requires certified SBOM |
| Root npm known advisories at observed scan time | `0` on second online scan | Rescan at actual release HEAD; separately cover vendored runtime |
| Web Helper notices, prebuilt and runtime byte integrity | `PASS` against pinned hashes | Verify distribution obligations and prior F6a.3 source-to-binary risk (`BLOCKED`) |
| Ludory license choice | `OWNER_DECISION_REQUIRED` | Select and review an actual root/workspace distribution license policy |
| Template media provenance | `UNVERIFIED`, rights `BLOCKED` | Supply original source/creator authorization per SVG or replace with rights-cleared assets |
| Host, real platform, official moderation | `NOT_RUN` | Separately scoped owner-authorized acceptance when needed |

`npm run check` now executes `check:security-inventory` as a deterministic,
**offline** integrity precheck. Its technical PASS must never set
`releaseReady=true`, `publicationAllowed=true`, clear a rights block, create
`v1.0.0`, or infer real Yandex/VK acceptance. The F6 freeze remains **BLOCKED**.
