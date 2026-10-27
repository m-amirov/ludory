# Ludory PR #13 — Final Integration Review Evidence

Date: 2026-10-27
Repository: `m-amirov/ludory`
PR: [#13](https://github.com/m-amirov/ludory/pull/13) (Draft)
Reviewed commit: `c2711fb588e6fbce0fb0ece2de2cef5e84cf284d`

This artifact contains no credentials, cookies, access tokens, or private
browser-profile data. Local absolute paths and user-specific profile names are
represented by environment variables or project-relative paths.

This is the historical E2E acceptance snapshot captured before the vendored
helper-supply follow-up. The current supply, installer, integrity and live
preflight evidence is in
`docs/evidence/pr13-helper-supply-v2-2026-10-27.md`.

## E2E chain

The completed chain is:

`Art Brief -> Native Codex ImageGen subagent -> original -> image-import -> GPT-6 Sol Web Art Review -> source-bound receipt`

Run ID: `2026-10-27T10-53-31-978Z-edc9a000ef9d`

Handoff SHA-256:

`e11cef8deb579c8bd4574fbb4b4766c09bd1380903e44adecf7271c2f4f4eb36`

Source-bound brief and references:

| Role | Path | SHA-256 |
| --- | --- | --- |
| brief | `art/scene-art-brief.md` | `ae06f413babf0b976f2c48a92f7f80c8875e2802b9f0eb2515d45ec3c3e50124` |
| scene | `narrative/scene.md` | `bbdb322d094218c62e1a1a1ac4d079f8215930cffd354b82bce216e7e1d00e57` |
| characters | `narrative/characters.md` | `e1d39dfcb5ec9bf7a160840ec623980ed81fd752e58dbc42db7bf61bbdf5199c` |
| location | `art/location.md` | `71d5c277a97881b0870522e4c92aa01f3ea1c6107dc3deb7c41c1c140b79f905` |
| style | `art/style.md` | `8edb07872c07b45a73ee14b6c84bbb7beabaad7ecad78a33756454266642603f` |

The ImageGen packet reported:

- `manualPacket.skill = $imagegen`
- `manualPacket.mode = built-in`
- `manualPacket.agentExecutor = codex-subagent`
- `manualPacket.agentModel = inherit-parent`

A separate Codex subagent reported an actual built-in `$imagegen` invocation and
returned the original. Ludory records this attribution as `USER_DECLARED`; the
CLI cannot cryptographically attest to a session-only tool call.

## Original and import

Original path: `art/native-imagegen-original.png`

Imported path:
`.ludory/ai/runs/2026-10-27T10-53-31-978Z-edc9a000ef9d/images/import-000001-60ccd27809ea1696df4cc39a.png`

| Property | Value |
| --- | --- |
| format | PNG (`image/png`) |
| dimensions | 1672 x 941 |
| bytes | 2,717,426 |
| SHA-256 | `66eae8dfbe48ebda6c6002c18c1c15ed84c1d3065f5644efdc7c3335d79eeffb` |
| full decode | PASS |
| imported bytes/hash equal original | PASS |

Import provenance is `USER_DECLARED` / `PENDING_REVIEW`, as required. It is
not evidence of ImageGen provider identity or art acceptance.

## Web helper investigation and successful route

The initially installed helper was:

- package/runtime version: `6.1.14`
- normalized path: `%LOCALAPPDATA%/Programs/Codex Web GPT/resources/runtime/app/browser-helper.cjs`
- SHA-256: `663ad77b346440627f520d7767a6e6561e8a66841c9273c758d58f96aec2f3cc`
- `ready.features`: `progress`, `tool-boundary-ack`, `completion-fence`, `multipart-stage-ack`, `skill-attachments`
- `browser_observation_v2`: absent

Therefore Ludory correctly failed closed at `DEV_ROUTE_UNVERIFIED` before visual
acceptance. The semantic package version alone was insufficient.

The successful isolated DEV route used:

- launcher: `codex-chatgpt-web-v2/launcher:dev`
- profile: `%CODEX_WEB_GPT_DEV_HOME%`
- helper: `%CODEX_WEB_GPT_DEV_HOME%/runtime/browser-helper.cjs`
- version: `6.1.14`
- helper SHA-256: `c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7`
- source commits: `83135a5`, `a8199d9`
- negotiated features: `progress`, `tool-boundary-ack`, `completion-fence`, `multipart-stage-ack`, `skill-attachments`, `browser_observation_v2`

The live preflight observed `authenticated=true`, `newChat=true`,
`solAvailable=true`, and the Web route `chatgpt-web/gpt-6-sol` with required
reasoning `high`. `extraHigh` and `pro` were not required and were unavailable.

The DEV profile metadata itself is stale (`releaseVersion=6.1.11` and
`subagentProtocol=compatibility-v1`) while the helper file is `6.1.14` and
negotiates v2. This did not create a visual compatibility fallback: Ludory used
the live `ready.features` and rejected the route if v2 was absent. It does,
however, show why installation metadata must be versioned and hash-bound rather
than inferred from a package version or a profile declaration.

The helper was built and exercised through its normal launcher. A fresh local
build from the same source produced a different minified SHA-256, so exact
byte-for-byte rebuild reproducibility is not currently established. No upstream
repository was changed or published.

## Independent Web Art Review

Observed model: `chatgpt-web/gpt-6-sol` (`gpt-6-sol` in the host observation)

Observed reasoning: `high`

Observed protocol: `browser_observation_v2`

The host observation recorded all required image-upload evidence:

- `process_upload_stream` request observed;
- `file.processing.completed` observed;
- visible attachment chip observed;
- uploaded image SHA-256 `66eae8dfbe48ebda6c6002c18c1c15ed84c1d3065f5644efdc7c3335d79eeffb`;
- uploaded image size `2,717,426` bytes;
- trace ID `art-2026-10-27T10-53-31-978Z-edc9a000ef9d`;
- independent visual verdict `PASS_ART` with no P0/P1/P2 findings.

The verdict is an artistic acceptance only. It does not grant rights,
provenance, publication, platform, or release approval.

## Receipt and tamper checks

Receipt:
`.ludory/ai/runs/2026-10-27T10-53-31-978Z-edc9a000ef9d/reviews/000001.json`

Receipt SHA-256:

`73061a44f062a757377f531ed09e8d3447cb430d0e57fb6de95fce0bc75239b7`

Receipt size: `3,685` bytes.

The receipt is bound to the run, run-head SHA-256, brief, all four source
references, imported image path, image SHA-256, image size, observed trace,
observed model, reasoning, upload lifecycle, and visual verdict.

Fail-closed checks:

- source mutation: blocked with `ART_SOURCE_STALE`;
- original-image mutation: blocked with `ART_SOURCE_STALE`;
- restoration: original/imported SHA-256 returned to
  `66eae8dfbe48ebda6c6002c18c1c15ed84c1d3065f5644efdc7c3335d79eeffb`.

## Gate results

| Gate | Status | Evidence |
| --- | --- | --- |
| `CODE_CHECKS_PASS` | PASS | `npm test` 285/285; `npm run check`; core session; `git diff --check` |
| `NATIVE_IMAGEGEN_INVOKED` | PASS | Separate subagent reported actual built-in `$imagegen`; attribution remains `USER_DECLARED` |
| `IMAGE_ORIGINAL_VERIFIED` | PASS | PNG, 1672 x 941, 2,717,426 bytes, full decode, exact SHA match |
| `IMAGEGEN_E2E_PASS` | PASS | Fresh run, source-bound handoff, import and metadata checks |
| `WEB_ART_ACCEPTANCE_PASS` | PASS | Live v2 host observation, real upload lifecycle, independent `PASS_ART` |
| `RECEIPT_INTEGRITY_PASS` | PASS | Receipt hash, source/image binding, tamper rejection |
| `RELEASE_READY` | BLOCKED | Rights, platform, publication and release gates are outside this receipt; helper supply is not yet reproducible |

## Review blockers and recommendation

1. **Helper supply is not reproducible in PR #13.** The installed `6.1.14`
   bundle lacks v2, while the successful route depends on an external source
   worktree and a manually installed profile helper. The minimal solution is a
   separate trusted helper-supply change: pin source commits `83135a5` and
   `a8199d9`, pin the build toolchain, ship or reproduce a verified artifact,
   verify its SHA-256 before descriptor publication, record matching
   version/protocol/features in a manifest, install only under the isolated DEV
   profile, and run the v2 ready/preflight smoke before enabling art review. Keep
   the stable profile and arbitrary external paths out of the trust boundary.

2. **Exact build reproducibility is not demonstrated.** The normal build from
   the pinned source produced a different minified artifact SHA-256 than the
   known tested `c126...` artifact. Make the helper build deterministic or
   distribute the signed/pinned prebuilt artifact with its manifest. Do not
   treat the semantic version as a supply attestation.

3. **The current code path does not pin helper content.**
   `packages/ai/src/dev-host.mjs` verifies containment or the official launcher
   layout, but `registeredHelper` does not verify an expected helper SHA-256 or
   source/build manifest. Add that only as part of the helper-supply contract,
   with regression tests; do not add a compatibility-v1 fallback for visual
   acceptance.

4. **Documentation wording is stale.**
   `packages/studio/README.md` describes the upstream helper generically as not
   supplying the protocol, while the tested commits do supply v2. Scope the
   statement to the installed/unsupported bundle and document the pinned v2
   installation procedure in the helper-supply change.

5. **PR #13 currently conflicts with `main`.** GitHub reports
   `mergeable=false` / `mergeable_state=dirty` against base SHA
   `5f2c3c970ce5c8dde1e5a5126f28ef45330632cb`. The local conflict check against
   current `origin/main` (`abb1261cc21ffd8cda7138360992af8799ce5eb0`) reports
   content conflicts in `package.json` and `packages/studio/src/cli.mjs`.
   Resolve those conflicts in a dedicated follow-up, rerun the full suite and
   CI, and keep the PR Draft until review is complete.

The PR implementation itself preserves the compatibility-v1 text route,
requires v2 for visual receipts, validates the observed model/upload/hash, and
fails closed on missing or stale evidence. No code or upstream changes were
made during this review; the new evidence file is local and uncommitted.

## CI and local verification

The reviewed commit has successful PR checks for Ubuntu and Windows on Node 22
and Node 24. The current published CI SHA is
`c2711fb588e6fbce0fb0ece2de2cef5e84cf284d`.

- [Ubuntu Node 22 / Node 24 workflow](https://github.com/m-amirov/ludory/actions/runs/40483848438)
- [Windows Node 22 / Node 24 workflow](https://github.com/m-amirov/ludory/actions/runs/40483841746)
- [PR #13](https://github.com/m-amirov/ludory/pull/13)

No new commit was created, no push was performed, PR #13 remains Draft, and no
merge or Release PASS was declared. The evidence file itself is local and
uncommitted.
