# Ludory PR #13 — Trusted Web Helper v2 Integrity Evidence

Date: 2026-10-27
Repository: m-amirov/ludory
PR: #13 (Draft)
Implementation commit: 0826e2e
Published head: `caed499d2274b8029baf60eecec544c65a25258b`

This evidence contains no credentials, cookies, access tokens, browser
storage, or private prompt content. User-specific paths are represented with
environment variables.

## Root causes fixed

The previous verifier accepted a changed v2 helper when its adjacent manifest
was changed to contain the new helper SHA. It also checked only required
`package.json` names and versions, while a clean DEV profile had no runtime
tree for the installer to supply.

The fix binds every `browser-observation-v2` launch to the canonical manifest
and helper distributed by Ludory. The verifier compares a stable SHA-256 of
the parsed manifest, the pinned helper byte count and helper SHA-256. It also
hashes every regular file in the runtime `node_modules` tree, including the
relative path, byte count and file SHA-256; missing, extra, changed, special or
symlinked entries fail closed.

The installer now supplies the pinned runtime tree into the isolated DEV
profile through a temporary directory and verifies it before publication and
after installation. An existing nonmatching or symlinked runtime tree is
rejected rather than overwritten. The Stable profile and installed launcher
are not replaced.

## Pinned distribution

- helper: `packages/ai/vendor/codex-chatgpt-web/browser-helper.cjs`;
- upstream version: `6.1.14`;
- source commits: `83135a5`, `a8199d9`;
- helper bytes: `216615`;
- helper SHA-256: `c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7`;
- protocol: `browser-observation-v2`;
- feature: `browser_observation_v2`;
- runtime files: `2217`;
- runtime bytes: `88160302`;
- runtime tree SHA-256: `ff0928d8053fb0f3e5e82459b1d9f0d3e25a0ac3caadb7e3751ce225fe562a2e`.

The runtime tree contains the six required packages pinned in
`manifest.json`: `@mixmark-io/domino@2.2.0`, `playwright-core@1.62.0`,
`tiktoken@1.0.22`, `turndown@7.2.0`, `turndown-plugin-gfm@1.0.2` and
`zod@4.6.6`. Upstream MIT terms and dependency notices remain in
`LICENSE`, `LICENSES/` and `THIRD_PARTY_NOTICES.txt`; the source patch remains
under `source/`.

## Regression evidence

Focused helper and DEV-host tests: **28/28 PASS**.

The focused set covers:

- helper and local v2 manifest changed together: blocked;
- missing manifest and wrong helper SHA: blocked;
- runtime executable file changed after installation: blocked;
- incomplete pre-existing runtime tree: blocked;
- clean DEV profile receives the complete vendored runtime tree;
- non-vendored v2 helper: blocked before the ready handshake;
- compatibility-v1 text route remains available;
- compatibility-v1 visual route remains ineligible for Art Acceptance;
- valid v2 handshake and observed upload protocol remain covered.

## Actual isolated DEV profile

`ludory helper install --json` returned `READY`, and
`ludory helper install --apply --json` returned `APPLIED` using only the
isolated DEV profile. The installed helper and runtime were independently
rehashed as:

- helper bytes: `216615`;
- helper SHA-256: `c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7`;
- runtime files: `2217`;
- runtime bytes: `88160302`;
- runtime tree SHA-256: `ff0928d8053fb0f3e5e82459b1d9f0d3e25a0ac3caadb7e3751ce225fe562a2e`.

The subsequent live preflight observed:

| Observation | Result |
| --- | --- |
| authenticated | `true` |
| newChat | `true` |
| route | `web-dev` |
| model route | `chatgpt-web/gpt-6-sol` |
| required reasoning | `high` |
| browser observation | `browser_observation_v2` |
| ready features | `progress`, `tool-boundary-ack`, `completion-fence`, `multipart-stage-ack`, `skill-attachments`, `browser_observation_v2` |
| preflight | `AVAILABLE` |

No compatibility-v1 fallback was used for visual acceptance.

## Existing Native ImageGen E2E

The previously completed Native ImageGen chain is preserved and was not
regenerated:

- run: `2026-10-27T10-53-31-978Z-edc9a000ef9d`;
- handoff SHA-256: `e11cef8deb579c8bd4574fbb4b4766c09bd1380903e44adecf7271c2f4f4eb36`;
- original: `tmp/pr13-native-imagegen-e2e-20261027/art/native-imagegen-original.png`;
- original: PNG, `1672x941`, `2717426` bytes;
- original SHA-256: `66eae8dfbe48ebda6c6002c18c1c15ed84c1d3065f5644efdc7c3335d79eeffb`;
- observed Web model: `chatgpt-web/gpt-6-sol`;
- upload observation: `process_upload_stream`, `file.processing.completed`, visible attachment chip;
- visual verdict: `PASS_ART`.

Receipt:

`tmp/pr13-native-imagegen-e2e-20261027/.ludory/ai/runs/2026-10-27T10-53-31-978Z-edc9a000ef9d/reviews/000001.json`

Receipt SHA-256:
`73061a44f062a757377f531ed09e8d3447cb430d0e57fb6de95fce0bc75239b7`.

## Verification status

- `npm test`: **310/310 PASS**;
- focused helper/dev-host regression: **28/28 PASS**;
- `npm run check`: **PASS**;
- `node examples/core-session.mjs`: **PASS**;
- `git diff --check`: **PASS**;
- live v2 preflight: **PASS**;
- CI for published head: **PASS** on Ubuntu/Windows Node 22/24;
- PR-triggered CI run: `40515388117`;
- push-triggered CI run: `40515376095`;
- merge: not performed; PR remains Draft.

Release rights, platform, publication and game-specific acceptance remain
separate from this implementation evidence.
