# F6a.3 — Web Helper source provenance and reproducibility

Date: 2026-11-03. Scope: the pinned vendored `browser-helper.cjs` under
`packages/ai/vendor/codex-chatgpt-web/` and its source patch. This is an
**audit record**, not a rebuild attestation or a legal clearance.

## Verdict

| Gate | Status | Direct evidence |
| --- | --- | --- |
| Immutable upstream baseline | **PASS** | `miuuyy/codex-chatgpt-web` tag `v6.1.14` resolves to commit `cfeaf04bc7f54cea29e1ff2adbcad63bd038b119`, tree `423bf13df37af865d571cfcb6fc91d1ad83cbe2e`. |
| Local patch syntax / replay | **PASS (partial source checkout)** | Six modified baseline files were retrieved from the immutable tag, checked against their upstream Git blob IDs, and both MBOX commits applied sequentially with `git am` without conflicts. |
| Vendored artifact integrity | **PASS (hash only)** | `216615` bytes, SHA-256 `c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7`; matches `manifest.json`. |
| Rebuilt artifact byte equality | **NOT_RUN** | Bun `1.4.0` is not present in this executor; a full upstream source + locked-dependency build was not run. |
| Authentic correspondence of binary to the patched source | **BLOCKED** | A digest of a supplied prebuilt cannot prove how it was produced. The upstream source tag and locally applicable patch alone do not establish binary/source equality. |
| `SUPPLY_CHAIN_PASS` / `RELEASE_READY` | **BLOCKED** | No reproducible build or separately documented owner risk acceptance; other F6 release gates remain independent. |

## Verified material

1. [Upstream `v6.1.14` tag](https://github.com/miuuyy/codex-chatgpt-web/tree/v6.1.14)
   and [immutable commit](https://github.com/miuuyy/codex-chatgpt-web/commit/cfeaf04bc7f54cea29e1ff2adbcad63bd038b119).
   Its `package.json` pins `bun@1.4.0`; the `build` script executes
   `bun run scripts/build-runtime-bundle.ts`, with a committed `bun.lock`.
2. The vendored two-email patch
   `packages/ai/vendor/codex-chatgpt-web/source/codex-chatgpt-web-browser-observation-v2.patch`
   is `104979` bytes, SHA-256
   `dcaf5bfebda69bc8c50b452fe3bcd745fa31c06e09be4d54940d6469b63057ae`.
   Its patch headers identify local commits
   `83135a50bcff389551a0cb001d71666a4e0504ac` and
   `a8199d9e25e6d22df5dbdac6982a0668605a1f6b`.
   GitHub's upstream commit API returned `422 No commit found` for both;
   these IDs must not be presented as publicly retrievable upstream commits.
   The complete patch text is present in the Ludory repository, but the
   current `manifest.json` names its path without independently pinning
   that patch SHA-256; the hash above is investigation evidence, not an
   automatically enforced source trust anchor.
3. The six upstream baseline Git blob IDs independently checked before
   applying the patch were:

   | Upstream path | Git blob SHA-1 |
   | --- | --- |
   | `launcher/electron/main.cjs` | `55fdceb13341bc658f3cc85eded533af68b2ac61` |
   | `src/adapters/chatgpt-web/attachment-upload.ts` | `2ceb5f97a553a7cc4462d4e043f158aae3598a6d` |
   | `src/adapters/chatgpt-web/browser-helper-main.ts` | `5e952aa15a23977e0f4e44e14a94f733ce41b196` |
   | `src/adapters/chatgpt-web/browser-worker.ts` | `c3de91a9d5b948cdcfb4fe3af589e511bb26d1c0` |
   | `src/adapters/chatgpt-web/launcher-helper-client.ts` | `1292284b1a298dc2a39758c677fb169e0e3a32b9` |
   | `tests/skill-attachments.test.ts` | `85656193911d085399317e7bfc4d8d673eec2aa8` |

4. The test was a temporary minimal Git tree containing these exact source
   blobs, not a full upstream checkout. `git am <two-email-patch>` reported:

   ```text
   Applying: feat(chatgpt-web): add browser observation v2
   Applying: test(chatgpt-web): cover observation callback barriers
   ```

   New files in the patch were created by `git am` as expected. This proves
   patch application to the touched source paths, not that a complete build
   has all necessary inputs or reproduces the vendored binary.

5. [Upstream build script](https://github.com/miuuyy/codex-chatgpt-web/blob/v6.1.14/scripts/build-runtime-bundle.ts)
   configures the helper's `Bun.build` with entry
   `src/adapters/chatgpt-web/browser-helper-main.ts`, target `node`, format
   `cjs`, minification on, `playwright-core` external and other packages
   external. The expected output is `dist/runtime/app/browser-helper.cjs`.
   A successful same-version build, including the locked dependencies and
   the original build platform, is still required for a byte comparison.

## Required next verification

Run from a new temporary upstream checkout **on a machine with Bun 1.4.0**;
do not reuse or modify the installed Stable launcher, Stable profile or game
projects. Confirm `git rev-parse HEAD` equals the immutable upstream tag
commit before replaying the patch. Preserve the complete terminal transcript,
tool versions, source tree hashes, build output SHA-256 and any error.

```sh
git clone --branch v6.1.14 --single-branch https://github.com/miuuyy/codex-chatgpt-web.git /path/to/new-temporary-upstream
cd /path/to/new-temporary-upstream
git rev-parse HEAD
git am /absolute/path/to/LUDORY/packages/ai/vendor/codex-chatgpt-web/source/codex-chatgpt-web-browser-observation-v2.patch
bun --version
bun install --frozen-lockfile
bun run build
sha256sum dist/runtime/app/browser-helper.cjs
```

On Windows PowerShell, use
`(Get-FileHash .\dist\runtime\app\browser-helper.cjs -Algorithm SHA256).Hash`
instead of `sha256sum`. An independently installed Bun executable with
the exact version is required; do not extract or repurpose the Stable
launcher's private runtime to satisfy this test.

Do not mark byte equality PASS unless the output hash matches
`c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7`.
If it differs, preserve both hashes and diagnose source/toolchain/build flags;
functional tests alone cannot substitute for provenance. A new trusted binary
would require a separate artifact-pin change, tests and fresh DEV-host
attestation, not a silent replacement.

## Decision still required

- **Preferred:** run the exact Bun 1.4.0 rebuild in an approved environment
  and compare bytes, then investigate any mismatch.
- **Alternative:** the owner may explicitly accept the residual **prebuilt
  provenance** risk for a limited internal framework milestone, with the
  exception written down. This does **not** turn byte reproducibility or
  `SUPPLY_CHAIN_PASS` into PASS and does not authorize game publication.

The F6a.1 ad-timeout and F6a.2 notice-delivery fixes do not resolve this
separate P1. Existing `v1.0.0`/Release, real-host, content-rights and
marketplace gates remain unaffected.
