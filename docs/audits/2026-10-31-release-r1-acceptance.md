# Release R1 — offline local gate acceptance (2026-10-31)

**Scope:** separate `feat/release-mvp-r1` candidate based on `main` commit `4d6851cb727fdea0ab929d6d4ba7f80b3adf96c4`. No write to a game repository, no Yandex Console upload, no publication or live SDK call.

## Verified interfaces

- `@ludory/release` performs bounded read-only inspection of C5's stored Yandex ZIP and rehashes each entry; no ZIP extraction, SDK execution or network call.
- `ludory release check --archive --receipt --sdk-evidence --rights --json`: returns versioned gates and nonzero CLI exit for `BLOCKED`/`FAIL`. Only four local gates can reach PASS. `releaseReady=false` and `publicationAllowed=false` in every outcome.
- A C5 ZIP produced by the genuine Studio-created-game builder plus all five fixture browser variants and a media rights declaration yields `PASS_LOCAL`. Mutated/missing inputs, mismatched source hashes or unauthorized flags are rejected.

## Independent review and fixes

Independent read-only review of initial `4d6851c..9748d42` found five Important issues, all reproduced by new RED tests and fixed before this report:

1. ZIP entries with symlink/device/directory external attributes were admitted. Now only regular-file types are allowed.
2. CRC32 was compared between headers but not to content. Now every stored member's content CRC is checked.
3. An entry could also be a directory ancestor of another entry. Now casefolded implicit directory/file collisions fail.
4. A source file growing after `lstat` could be fully read without a bound. Now the opened descriptor is checked and reads are bounded, with explicit post-bound growth detection.
5. A partial project manifest was accepted. Now the versioned, platform-neutral manifest fields are checked independently of Core.

The reviewer also noted nonblocking future hardening: finer-grained filesystem race protection against malicious concurrent directory replacement, stronger write-side-effect assertions in tests, and monitoring for archive metadata variants outside C5. SHA-256 does **not** authenticate the party who produced a receipt; rights declarations remain unaudited claims.

## Acceptance commands

| Gate | Result |
| --- | --- |
| `node packages/release/test/archive.test.mjs` | 10/10 PASS, including five new review regressions |
| `node packages/release/test/check.test.mjs` | 6/6 PASS |
| `node --import ./packages/studio/test/setup-trust-env.mjs packages/studio/test/release-cli.test.mjs` | 2/2 PASS with a generated C5 archive |
| `npm run check` (includes `precheck`/Release syntax checks) | exit 0 |
| `node examples/core-session.mjs` | exit 0 |
| `git diff --check` | exit 0 |
| `npm test` after review fixes, with required child-process permissions | 761 total: 748 PASS, 13 SKIP, 0 FAIL; Quality integration 18/18 PASS; exit 0 |
| GitHub Actions exact PR HEAD | `NOT_RUN` until PR is pushed |

## Release gates that remain closed

`platform-live=NOT_RUN`, `rights-clearance=NOT_RUN`, `owner-authorization=NOT_RUN`. No physical-device certification, real Yandex Player/ads evidence, independently verified rights/license metadata, source-signature trust anchor, moderation submission or actual production publication. `PASS_LOCAL` is **not** `RELEASE_READY`. Later R2 requires real draft testing, independent evidence and separate owner authorization for any external write.
