# M2 S01 ownership migration rehearsal — 2026-11-03

## Input and boundary

- Read-only source: `m-amirov/kiss-at-the-edge-of-the-world-ludory`, branch `feat/m2-canonical-s01` (game PR #2), `game/` directory.
- Rehearsal operated only on a temporary **copied** `game/` directory with an isolated Studio host-trust registry. The real game working tree, its receipts and its state were not modified.
- Ludory implementation based on `feat/narrative-custom-title` (PR #82), extended by `feat/narrative-author-ownership` (issue #81).

## Observed steps

1. Existing state had schema 1 and `narrative-interactive` 1.2.0; SHA mismatches were confined to author story, proof, and missing demo SVGs. The old launcher/runtime hashes matched.
2. `components trust --json` on the copied host returned `NEEDS_USER_ACTION`, proposed the four author paths separately from managed launcher/runtime paths, and produced state SHA `a3a7a6de38b34b6eff6de00338907dfdb1edcda152dcd103c14382e6d712003a`.
3. An explicit trust `--accept-state-sha256 <SHA> --apply` returned `TRUSTED`; the distinct `components adopt --json` preview returned `NEEDS_USER_ACTION` for the same state digest. Adoption also displayed the exact planned managed writes and a separate proposal SHA `b30867a37fd0398f422fda235c68cfb11cd26c8aa3d397a725cdc9305f9905ca`, binding the author detach set, current author bytes, updated template and all managed output hashes.
4. `components adopt --accept-state-sha256 <SHA> --accept-proposal-sha256 <proposal-SHA> --apply` returned `APPLIED`. Changes were strictly `index.html`, `src/main.js`, and `ludory.components.json`; the original state was retained in a `.ludory-components-backup-*` archive.
5. `components status --json` returned `IN_SYNC` with template `1.2.2` and schema 2. S01 source and proof hashes before and after matched exactly:

   | Author file | SHA-256 before and after |
   | --- | --- |
   | `game/src/story.js` | `ecddb280fb6eef32c83d1b150d4e2772f5682f9d199f6887148fa865fe3571cb` |
   | `game/narrative-assets.json` | `fa099ed3c0273533ee71e37f287590ef9641c62a537898967e418ac577737601` |

6. Re-import of the copied S01 narrative graph and catalog succeeded (`s01-airport` start scene); its manifest title resolved to `Поцелуй на краю света · Ludory`.
7. `planNarrativePlatformExport()` returned `READY_TO_DERIVE`; independent local Yandex and VK candidate generation and verification returned `CANDIDATES_BUILT_LOCAL` → `LOCAL_ARCHIVES_VERIFIED`.

## Verification scope

- Ludory targeted catalog, narrative and component tests: 87 pass, 11 skips, 0 failures.
- Full `npm test`: exit 0 (main Node test suite and independent quality integration: 18 pass).
- Full `npm run check`: exit 0.
- Negative tests cover forged schema-2 classification without transition, preview-to-apply catalog/proposal drift, stale author plans, same-host tampering, new-host consent drift, symlinks, missing demo media, a combined file-count overflow and failed component publication with retained backup.
- Physical browser/mobile QA, real SDK field tests, image rights, moderation and publication: **NOT_RUN**. Local candidate verification does not grant release readiness.
