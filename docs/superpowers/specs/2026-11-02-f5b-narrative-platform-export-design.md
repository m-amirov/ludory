# F5b — one narrative source, two SDK candidates

**Decision:** The owner approved approach A on 2026-11-02: Studio derives separately validated Yandex/VK candidates from one trusted narrative source. This is a new-game workflow only; no frozen project is touched.

## Intent and scope

An author edits **one** Studio `narrative-interactive` game, with a single id/version and story content. Ludory takes a source-bound snapshot once, generates platform-specific temporary Studio projects, integrates the respective local SDK adapter and narrative runtime, and builds two independent ZIP candidates. The two ZIP receipts must refer to the same source snapshot digest. The resulting source game stays untouched; candidate output admission is exclusive and must never overwrite an existing file.

This design builds on existing `planPreviewBuild` / `buildPreview` for source admission, `planCreate` / `applyCreatePlan` for target-specific Studio provenance, and the existing Yandex/VK candidate builders and Release inspectors. It does not loosen their constraints to accept a different template or forge their managed hashes.

## Approaches

1. **Chosen: target-specific derived Studio projects.** Reuse existing SDK candidate and release contracts, with a separate export coordinator binding both generated results to one trusted narrative snapshot. This involves a platform-specific narrative bootstrap but avoids changing the security contract of the packagers.
2. New universal dual-target ZIP builder. It could avoid the temporary SDK projects, but would duplicate platform/Release validation, expand the trust surface and complicate negative tests. Not chosen for 1.0.
3. Independently author two SDK games, as in the F5a smoke fixture. This does not attest that the packages contain the same narrative game and is inadequate for acceptance.

## Runtime design

- **Admission and source pin (F5b1):** accept only a host-trusted `narrative-interactive` Studio origin with a `narrative-game` profile and both declared `yandex-games`/`vk-games` targets. Read the exact receipt/components/manifest bytes and bind their hashes to the host pin; canonicalize physical Windows paths, including legitimate NTFS aliases. A read-only plan pins source identity and deterministic `sourceDigest`/file hashes; executing against a changed source fails closed. The plan is not a release or packaging certificate.
- **Build derivation (F5b2):** from the pinned, freshly verified snapshot, generate fresh `yandex-runtime` and `vk-runtime` Studio project roots using the same game id/version/title, each with its single respective target. Compile the **original** narrative script/story/assets into each target's executable entrypoint (do not silently replace author code with a generic example); attach SDK-specific lifecycle/save/visibility capabilities through explicit adapters. Use bundled platform-specific assets only, no copied Yandex `sdk.js` or remote VK bridge.
- **Candidate provenance (F5b2):** existing builders produce strict ZIPs. An export receipt outside each archive binds source digest, derived project hash, target, ZIP SHA-256 and every member hash. Recompute hashes and verify stored archives before reporting a local candidate. Separate generated output names and fail on existing outputs.
- **Real browser acceptance (F5b3):** serve both ZIPs with fake SDK/Bridge using the existing browser test machinery. Prove the same story path, photo/keepsake/message echo, Back/save/reload, wide/portrait responsive layout, SDK initialization, pause/audio behavior where supported, source hash linkage and no remote requests. Test stale plans, modified files, symlinks, target swaps, foreign SDK, candidate tampering and no overwrite. A mock SDK PASS is not a live platform approval.

## Safety and release gates

- Source game, existing games, dirty author files and frozen CEOS/Starter Kit are never changed. Only process-owned temporary derived projects are removed after a verified ownership check.
- Platform adapters stay in Connect; Core remains platform-neutral. No new paid runtime AI/server and no publishing, moderation, account login or real external Web reviewer.
- Yandex and VK ZIPs are target-exclusive and separately release-checked; the extra dual-source linkage is asserted outside the ZIP. If either platform's story entrypoint is not verified, the overall F5b status is `BLOCKED`, never `PASS`.
- Offline startup is **not required** by owner decision on 2026-11-02; ordinary game mechanics remain deterministic without a runtime server.
- F5b1 is deliberately the source pin/admission contract only. It must be described as `READY_TO_DERIVE`, not a working dual-platform package. F5b2 and F5b3 are required before closing F5.
