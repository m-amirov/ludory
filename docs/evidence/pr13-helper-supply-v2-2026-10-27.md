# Ludory PR #13 — Vendored Web Helper v2 Evidence

Date: 2026-10-27
Repository: m-amirov/ludory
PR: #13 (Draft)
Local merge checkpoint: 22ba9a1
Local origin/main: abb1261cc21ffd8cda7138360992af8799ce5eb0

This evidence contains no credentials, cookies, access tokens, browser
storage, or private prompt content. User-specific paths are represented with
environment variables.

## Pinned supply

The vendored artifact is:

- path: packages/ai/vendor/codex-chatgpt-web/browser-helper.cjs;
- upstream package version: 6.1.14;
- patched source commits: 83135a5, a8199d9;
- artifact label: codex-chatgpt-web-6.1.14-patched-browser-observation-v2;
- bytes: 216,615;
- SHA-256: c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7;
- negotiated feature: browser_observation_v2.

manifest.json records the exact artifact hash, source patch, Bun 1.4.0
build context, runtime package versions, protocol, model and reasoning
requirements, and the fact that the source rebuild is not byte-reproducible.
The two source commits are auditable in
source/codex-chatgpt-web-browser-observation-v2.patch. The upstream MIT
license and generated third-party notices are vendored beside the artifact.

The helper has external runtime requirements rather than a hidden dependency
on the upstream worktree:

| Package | Version |
| --- | --- |
| @mixmark-io/domino | 2.2.0 |
| playwright-core | 1.62.0 |
| tiktoken | 1.0.22 |
| turndown | 7.2.0 |
| turndown-plugin-gfm | 1.0.2 |
| zod | 4.6.6 |

The installer verifies these package manifests from the DEV runtime and
blocks if any are missing or mismatched.

## Installation and trust boundary

Command:

node packages/studio/bin/ludory.mjs helper install --apply --json

Observed DEV profile:

- %USERPROFILE%/.codex-chatgpt-web-dev;
- helper: %USERPROFILE%/.codex-chatgpt-web-dev/runtime/browser-helper.cjs;
- manifest: %USERPROFILE%/.codex-chatgpt-web-dev/runtime/browser-helper.manifest.json;
- profile override: %USERPROFILE%/.codex-chatgpt-web-dev/config.json;
- launcher: %LOCALAPPDATA%/Programs/Codex Web GPT/Codex Web GPT.exe;
- installed launcher product version: 6.1.14.

The command selected the registered installed launcher, did not replace its
executable or any Stable profile file, and had no arbitrary destination flag.
It verified the vendored artifact before writing and the installed bytes after
writing. The profile override is confined to the isolated DEV home.

The installed helper was independently rehashed:

- bytes: 216,615;
- SHA-256:
  c126dd6b268cb9a9e6923215a1082de70b6b607ad9f31ab75415278dd683b4a7;
- ready.features: progress, tool-boundary-ack, completion-fence,
  multipart-stage-ack, skill-attachments, browser_observation_v2.

Regression checks cover valid artifact, wrong SHA, missing manifest, protocol
mismatch, replacement after installation, runtime package mismatch and
compatibility-v1 visual rejection. The helper is rehashed before every spawn;
there is no compatibility-v1 fallback for Art Acceptance.

## Live v2 preflight

The official installed launcher was started with --dev-profile after the
previous descriptor PID was found stale. The preflight then observed:

| Observation | Result |
| --- | --- |
| authenticated | true |
| newChat | true |
| solAvailable | true |
| route | web-dev |
| model route | chatgpt-web/gpt-6-sol |
| required reasoning | high |
| negotiated visual protocol | browser_observation_v2 |
| preflight reason | AVAILABLE |

The first attempt before starting the launcher returned
DEV_ROUTE_UNVERIFIED; direct helper diagnostics identified the exact cause:
Launcher browser host process is not running (pid 4996). After the official
--dev-profile launcher was active, the same vendored helper reached AVAILABLE.

## Existing E2E and receipt

The previously completed Native ImageGen chain remains unchanged:

- run: 2026-10-27T10-53-31-978Z-edc9a000ef9d;
- handoff SHA-256:
  e11cef8deb579c8bd4574fbb4b4766c09bd1380903e44adecf7271c2f4f4eb36;
- original: PNG, 1672x941, 2,717,426 bytes;
- original SHA-256:
  66eae8dfbe48ebda6c6002c18c1c15ed84c1d3065f5644efdc7c3335d79eeffb;
- observed model: chatgpt-web/gpt-6-sol;
- observed reasoning: high;
- upload lifecycle: process_upload_stream,
  file.processing.completed, visible attachment chip;
- visual verdict: PASS_ART.

Receipt:

.ludory/ai/runs/2026-10-27T10-53-31-978Z-edc9a000ef9d/reviews/000001.json

Receipt SHA-256:
73061a44f062a757377f531ed09e8d3447cb430d0e57fb6de95fce0bc75239b7

An attempted second workflow art-review --apply on this same run returned
ART_ALREADY_ACCEPTED and wrote no new receipt. This preserves the
append-only acceptance boundary; no new ImageGen output was created.

## Merge and gate state

git merge-tree --write-tree HEAD origin/main produced a conflict-free tree.
The local branch contains the merge checkpoint but has not been force-pushed
or merged into main.

| Gate | Status | Evidence |
| --- | --- | --- |
| HELPER_SUPPLY_READY | PASS | Vendored artifact, manifest, source patch, licenses and installer |
| HELPER_INTEGRITY_PASS | PASS | Pre/post SHA checks, runtime checks and tamper regressions |
| MERGE_CONFLICTS_RESOLVED | PASS | Local merge 22ba9a1; conflict-free merge tree |
| CODE_REVIEW_PASS | PASS | Local diff review; npm test 308/308; npm run check; core example; git diff --check |
| PR_MERGE_READY | BLOCKED | New commit/CI publication still pending |
| RELEASE_READY | BLOCKED | Release, rights, platform and publication gates remain separate |

No upstream repository was changed or published. PR #13 remains Draft.
