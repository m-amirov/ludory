# Connect VK V5 — Local Candidate Packaging and Verification

## Intent

Make a new, Studio-created VK-only Ludory game reproducibly packageable for a **local** field-test candidate. A valid local ZIP must not be mistaken for VK Hosting acceptance, SDK/device validation, rights clearance or permission to publish.

## Approach

- **Selected:** mirror the proven Yandex C5 admission/ZIP contract with a VK-specific builder; reuse the existing strict Release ZIP inspector by parameterizing only its required paths and platform target. Expose a read-only, hash-bound VK candidate check.
- Alternative: generalize both platform builders now. That would change a stable Yandex release path and enlarge risk without supporting another target yet.
- Alternative: zip the game directory directly. That would leak local evidence, Studio receipts, scripts and possibly secrets, and would not bind managed SDK bytes.

## Contract

- Input must be a registered, independently trusted Studio project from `web-game/vk-runtime`, with target exactly `['vk-games']`. No transfer, migration or auto-enrollment.
- Output is a new ZIP **outside** the game root; never overwrite an existing output. Build does not edit the game, Studio trust state or any frozen project.
- Required shipped files: `index.html`, `src/main.js`, `ludory.project.json`, both owned local bundles (`assets/ludory-vk.js`, `assets/vk-bridge.js`), and both license notices (`licenses/vk-bridge.txt`, `licenses/swc-helpers.txt`). Optional files are limited to regular media under `assets/` (`png`, `jpg`, `jpeg`, `webp`, `svg`, `ogg`, `mp3`, `wav`, `woff2`).
- Verify all managed bundle and license bytes against both Studio receipt and component hashes; manifest against Studio receipt. Require exactly one HTML module entrypoint to `src/main.js`, no `<base>` and no foreign/Yandex SDK references. Source entrypoint must load the two local bundles; do not fetch a remote VK Bridge.
- Reject symlink paths, nonregular files, unsafe path segments, case-colliding entries, missing files, and sizes above 25 MiB per file or 100 MiB total (local safety caps, **not** VK platform limits).
- Write a deterministic, stored ZIP with stable ordering and timestamps and return `{archivePath, sha256, files}`.
- An independent read-only verifier checks ZIP layout, member CRCs, manifest, required files, receipt SHA and full entry hash list; it must never take claimed SDK/live evidence as proof. Its best status is `PASS_LOCAL`, with `releaseReady=false`, `publicationAllowed=false` and live VK, physical devices, rights clearance, moderation and owner publication authorization `NOT_RUN`.
- Existing Yandex builder and Release semantics remain unchanged.

## Acceptance

- Real Studio fixture: two ZIP builds are byte-identical; only allowed files ship; all independent receipt hashes agree.
- Invalid trust/target, tampered Bridge, moved/duplicate SDK references, symlinks, existing or in-project output all fail **before** writing a candidate.
- Inspector rejects corrupted ZIP, wrong target, missing required VK bundle/license and changed receipt, while Yandex inspector regression suite stays green.
- Full `npm test`, `npm run check`, VK template reproducibility check and Core example run. CI runs on PR HEAD before any merge; no autonomous merge or publication.
