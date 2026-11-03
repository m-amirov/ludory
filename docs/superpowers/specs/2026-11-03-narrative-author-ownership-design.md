# Narrative Author Ownership — Design

## Intent

Ludory must retain ownership of executable bootstrap/runtime files while letting Codex author and remove story content, media and their integrity manifest. Existing Studio-created games must be able to adopt the split without copying files, forging trust receipts or overwriting authored content. First consumer: `kiss-at-the-edge-of-the-world-ludory` PR #2.

## Approaches

1. **Selected A: versioned ownership separation.** Catalog declares a closed set of author-owned paths. New Studio component manifests track only immutable managed paths and record the author-owned paths separately. Legacy state is reclassified by an explicit SHA-confirmed, backup-backed transaction, with unchanged managed bytes verified before/after. This preserves provenance and blocks silent updates.
2. Ignore `CONFLICT` for filenames matching `story|assets` at runtime: unsafe; update transaction could still overwrite author content and host trust would silently weaken.
3. Keep game content outside the Studio project and merge at build time: possible later but conflicts with direct runtime/preview and current source layout.

## Invariants

- Only a trusted versioned template may declare author-owned paths. The canonical launcher (`src/main.js`), boot entry (`src/entry.js`) and runtime bundle (`assets/ludory-narrative.js`) can **never** be author-owned.
- Source story and narrative-assets proof must be regular, in-project files; referenced media must have matching digests. Removing unused template demo media is permitted.
- Existing v1 state is never silently reinterpreted. Migration requires a read-only preview, exact state-SHA and proposal-SHA consent, and explicit `--apply`. The proposal digest binds the author paths and current bytes, template and all managed output hashes. Original state bytes survive in an ownership transition archive; restore/recovery remains possible.
- A newly created schema-2 project records its original classification in the creation receipt. An older schema-1 receipt cannot justify direct schema-2 classification without a verified transition archive.
- Subsequent component updates replace only managed paths; author-owned bytes are never staged, overwritten or deleted. New template additions cannot collide with existing user files.
- Host trust remains per machine. Cross-host registration requires explicit hash confirmation; it verifies managed bytes and safe authored source/admission, not old generated content hashes.
- A tampered launcher, modified manifest, symlink/hardlink/special file, forged state transition, stale plan or re-entrant transaction blocks.

## Acceptance

- Fresh template creation emits separate managed/author path classes and their provenance; status IN_SYNC even after legitimate author edits and deletion of unused demo media.
- A v1 game edited like M2 S01 reports `NEEDS_USER_ACTION` for ownership migration; it never attempts to auto-overwrite content. Preview must show exact proposed detach set and state digest.
- Confirmed migration leaves every authored byte untouched, updates state transactionally, and allows verified template 1.2.2 upgrades.
- Cross-host consent behaves equivalently after migration; protected changes still reject both update and trust transfer.
- Negative and regression tests cover all these properties. No claims of browser, rights or release QA.
