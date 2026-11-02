# P3c — Independent visual/content pre-moderation review handoff

Status: first implementation slice; branch `feat/ludory-qa-review-p3c`, based on merged P3b.

## Scope

Build a reproducible, *read-only* review packet for a nominated **new, trusted Ludory Studio** game. Input: platform-specific built ZIP and receipt, P3b `capture.json` with original screenshot PNGs, metadata/listing and icon/cover assets, optional rights/SDK local attestations. Identity is the independently reread candidate ZIP SHA-256 and target, not a filename. The packet inventories real reviewed files and their SHA-256; it does **not** embed pixels in prose or call Web DEV from Node.

Independent Web DEV (GPT-6 Sol Instant(Web), `low` reasoning, when the owner authorizes an image-capable Web handoff) must inspect **actual supplied PNG/icon/cover bytes**, not hashes or captions. It may return localized P0/P1/P2 observations, evidence filenames/hashes, reproduction steps and applicable verified rules. A text-only review, forged machine assertion or missing image delivery is `BLOCKED`. The Codex agent orchestrates the handoff; there is no OpenAI API, paid service, credential access, account login, or automatic portal action.

## Contract

- `prepareQaReviewPacket(...)` is a pure read-only `@ludory/release` API.
- Reuse P3a `simulateModeration()` and P3b `verifyQaCaptureIntegrity()`. Require valid ZIP+receipt; metadata/listing and promo byte checks must `PASS`; P3b evidence must have all three PNG cases, no `BLOCKED` screenshot cases, matching candidate SHA. The P3b technical `ISSUES_FOUND` status may still be forwarded to reviewers, but must be preserved, never converted to PASS.
- Re-read and re-hash metadata and promo assets after checking original P3a gates. Reject changed bytes, unexpected filename/path or digest mismatch. No source or output file mutation, even in error paths.
- The result has `status:READY_FOR_HANDOFF|BLOCKED|ISSUES_FOUND`, evidence references, platform policy sources, textual listing/content declarations explicitly marked **USER_DECLARED**, an immutable review rubric, and fixed `browserAttested:false`, `reviewProvenance:NOT_RUN`, `actualModeration:NOT_RUN`, `releaseReady:false`, `publicationAllowed:false`.
- This packet is *ready to present*, not reviewed. There is **no automatic reviewer submission** or import of untrusted plain JSON as an attestation. No new server and no Docker.

## Rubric for future independent Web review

1. Visual UX: visible crops, contrast/legibility, safe areas, CTA reachability and responsiveness in actual screenshots.
2. Narrative/content: user-declared listing and actual visible scene state; identify policy conflicts only with verified platform source; distinguish unsupported inference from findings.
3. Promo: inspect original icon and cover against the declared listing, orientation/quality/crop, misleading claims, and actual content.
4. Functional issues: contextualize P3b console/HTTP/flow findings and reproducible action sequences; never infer an unobserved scene was tested.
5. Findings: priority P0/P1/P2, target, case/file, actual observed pixels/reproduction and bytes SHA, expected/observed, source policy if verified. Unknown rules stay POLICY_SOURCE_UNVERIFIED.

## Release gates

Full unit tests and regression tests for target mismatch, screenshot tamper, metadata/promo tamper and omission, synthetic review authority, zero writes and evidence immutability; `npm test`, `npm run check`, Core example, exact HEAD GitHub Actions, independent Codex review. PR stays Draft until review and user authorization; do not merge or publish.
