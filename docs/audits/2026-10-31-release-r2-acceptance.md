# Release R2 — local acceptance (2026-10-31)

**Branch:** `feat/release-mvp-r2` from `origin/main` `8fe0b020` (merged R1 PR #52).

## Delivered

- New read-only `planYandexFieldTests` from `@ludory/release` and Studio `ludory release plan` CLI.
- A stable list of 13 real Yandex SDK, browser, emulation and physical-device field checks, initialized as `NOT_RUN` rather than inheriting mock SDK PASS.
- Candidate-SHA-bound optional user-declared field evidence. Positive reports are always `BLOCKED/UNVERIFIED_SELF_REPORT`; negative reports are `FAIL`; malformed, stale, duplicate or authority-forged files fail closed. Duplicate JSON **member names**, including escaped-equivalent keys, are explicitly rejected before a failure can be overwritten by parsing.
- `READY_FOR_FIELD_TEST` is a **planning/preflight status**, not live SDK acceptance or permission to upload. `releaseReady=false`, `publicationAllowed=false` always.

## Local verification

| Check | Observation |
| --- | --- |
| `node packages/release/test/plan.test.mjs` | 8 PASS, 0 FAIL; original RED plus reviewer regressions observed RED before fixes |
| `node packages/studio/test/release-cli.test.mjs` | 4 PASS, 0 FAIL; new cases observed RED before CLI implementation |
| `npm test` on reviewed and repaired code (Node 24, unrestricted subprocesses) | 771 total, 758 PASS, 13 SKIP, 0 FAIL; Quality integration separately 18 PASS |
| `npm run check` | Exit 0 (includes Release plan syntax) |
| `node examples/core-session.mjs` | Exit 0 |
| `git diff --check` | Exit 0 |

An initial sandbox `npm test` against an unchanged R1 baseline failed five unrelated test files where child process execution is restricted; the elevated baseline finished 748 PASS, 13 SKIP, Quality 18 PASS. This matches the previously recorded R1 environment behavior and is not a source regression.

## Independent R2 review and resolution

The independent reviewer found one important issue: JSON documents could repeat `status` or top-level `observations` and have `JSON.parse` silently discard an earlier `FAIL`. The reviewer also found a minor problem where missing archive inputs skipped field-evidence validation. Both findings were reproduced by new tests before implementing fixes. R2 now rejects duplicate JSON members, including equivalent Unicode-escaped member names, and validates independently checkable field-evidence constraints even when the archive is unavailable. Candidate binding remains `BLOCKED` until the archive can be inspected. Neither fix elevates user declarations to independent platform evidence.

## Outstanding release gates

- **NOT_RUN:** live Yandex Draft, real SDK and Player, advertising inventory, physical device/browser observations, independent source attestation.
- **NOT_RUN:** independent legal rights clearance and owner publication authorization.
- **NOT_RUN:** exact-head GitHub CI at the moment of this local report. Independent pre-PR review was completed; its findings and local resolutions are recorded above. Remote gates will be updated in PR after actual execution; do not infer them from local PASS.
- No credentials, network access, uploads, moderation or game publication were performed.
