# P3c.2 — Sequential observed Web review design

**Status:** proposed for owner approval; implementation not started.

## Intent

Extend PR #64's P3c.1 `prepareQaReviewPacket(...)` with an opt-in,
source-bound independent visual/content/promo review of **five actual images**:
three P3b screenshots (desktop, mobile portrait, mobile landscape), followed by
the original icon and cover. The reviewer is isolated ChatGPT Web DEV
`chatgpt-web/gpt-6-sol-instant`, reasoning `low`. Each image is transmitted in
its own turn because the existing trusted browser helper verifies exactly one
attachment per turn. The point is review evidence, **not** platform approval.

## Boundaries and non-goals

- Preserve the existing read-only `prepareQaReviewPacket` contract and the
  original ZIP, receipts, screenshot PNGs, metadata and promo bytes.
- No default upload, automatic retry, paid API, credential handling, Docker,
  publication, moderation submission, changes to frozen games, or upgrade of
  self-reported JSON to authentic browser proof.
- Keep `releaseReady: false`, `publicationAllowed: false`, and
  `actualModeration: 'NOT_RUN'` on every outcome; preserve the P3b technical
  result even when all five images are observed.
- No change to the vendored browser helper: it already supplies V2 provenance
  for one uploaded image. The CLI must explicitly ask the owner to run the
  authenticated helper; local or CI mock results cannot claim live inspection.

## Approaches considered

1. **Chosen — five sequential observed turns:** reuse the one-image helper;
   validate and checkpoint each upload separately. More Web turns and recovery
   cases, but no new browser transport protocol or vendor patch.
2. One multi-image turn: more holistic/context-efficient, but requires a new
   helper attachment protocol, vendor integrity update and larger trust surface.
3. Manual uploads and imported JSON: simpler operationally, but cannot verify
   actual delivered bytes, model/effort, or live provenance. Not adequate for
   a `HOST_OBSERVED` claim.

## Public behavior

- `ludory qa handoff ...` remains unchanged and read-only.
- A new `ludory qa review ... --output <new-directory> [--apply] [--json]`
  accepts the same candidate/receipt/metadata/promo/capture arguments as
  `qa handoff`. Without `--apply`, it prepares an ordered preview, evaluates
  P3c.1 gates, lists all five file names, SHA-256 values and requested Web
  settings, and performs **no I/O to Web or local writes**. The preview is not
  review evidence.
- `--apply` is an explicit instruction to transmit the five verified image
  bytes to an independently authenticated, isolated Web DEV reviewer. Require
  an unused output directory outside the candidate and its source/evidence
  directories. Check P3c.1 gates again immediately before sending. Use a
  trusted injected host interface (`probe()`, `turn(...)`) so tests can use a
  fake without contacting Web. Production uses the existing verified Web DEV
  host, with no credentials or arbitrary executable supplied as CLI flags.
- `ludory qa review-status --output <directory> [--json]` validates the
  local attempt journal and displays only **recorded claims**, such as
  `RECORDED_REVIEWED` and `RECORDED_ISSUES_FOUND`. It **never** converts a
  stored report into fresh browser attestation or release authority.
- `ludory qa review-restart ... --previous <old-output-directory> --output
  <new-directory> --confirm-reviewer-stopped --apply [--json]` is the
  explicit recovery path. It requires the **same full source-input arguments
  as `qa review`**, rechecks P3c.1 and the previous journal, and creates a
  completely new session and unique traces. Without confirmation it only
  reports `PENDING_RECOVERY`. The owner must verify that the prior helper
  has stopped and acknowledge that already observed images will be sent
  again. No previous local journal entries are trusted to skip a review.

## Review inputs, prompts, and responses

- Input order is fixed by P3c.1: `desktop-1000x720`, `mobile-390x844`,
  `landscape-667x375`, `icon`, `cover`.
- Before each turn, re-open the file as an ordinary regular file, reject
  symbolic links or changed identity, check size limits, MIME/magic and
  SHA-256 against the source packet. The host's own image validator also
  checks SHA-256. The journal stores digests and evidence paths, never copies
  of originals or secrets.
- Each prompt pins target, candidate ZIP hash, metadata SHA, capture report
  SHA, case/kind, image SHA/size and the P3c rubric. Listing/content are
  clearly `USER_DECLARED`, and project text is untrusted task data. The
  reviewer is instructed to inspect only the actual attached pixels and
  return one bounded JSON finding report (`imageSha256`, `imageVisible`,
  findings with P0/P1/P2, evidence, expected/observed and reproduction where
  possible). Policy claims require verified sources; otherwise label them
  `POLICY_SOURCE_UNVERIFIED`.
- The host must return `HOST_OBSERVED`, `web-dev`,
  `gpt-6-sol-instant`/`low`, the exact trace/ref/bytes/SHA, and a V2
  browser observation with upload creation, processing completion and visible
  attachment chip. Any missing, mismatched or synthetic observation is
  `PENDING_RECOVERY` or `BLOCKED`, **never reviewed**.
- Never use model-written `imageVisible: true` as proof of image delivery; it
  is interpreted only after the trusted host observation validates.

## Durable attempt and recovery

1. After final local preflight, create a new output directory exclusively.
   Write a schema-versioned session manifest binding the target, candidate,
   P3c input hashes, ordered five image descriptors and random session ID.
   The local journal is an **audit record, not a cryptographic authority**;
   importing/editing JSON must never confer host provenance or release PASS.
   In particular, the journal is insufficient to authenticate earlier turns
   after a process restart, even if its unkeyed SHA chain is self-consistent.
2. Before each potentially chargeable `host.turn`, durably record
   `REQUESTED` with unique trace ID and attempt number. Only after validated
   host observation and bounded JSON may an `OBSERVED` event be committed.
   Use atomic/exclusive writes and hash-linked records to catch corruption,
   missing steps, replay and out-of-order events.
3. A helper timeout, process crash, partial upload, invalid report or missing
   receipt leaves `PENDING_RECOVERY` and disables automatic further turns.
   Already observed prior images remain individually recorded as local audit
   claims, but a partial run has no aggregate reviewed verdict. Recovery is
   a fresh five-image session requiring full input revalidation, separate
   output and explicit owner confirmation. This may repeat paid/account-quota
   turns, never silently.
4. After five observed turns, return `REVIEWED` (zero findings) or
   `ISSUES_FOUND` (one or more P0/P1/P2 findings). Preserve separate
   `captureStatus`, source provenance and finding scope. Neither outcome is
   platform moderation, owner approval or a release gate pass.
5. Recheck source hashes before every turn and before a fresh recovery
   session. If any ZIP, metadata, screenshot, promo or manifest binding
   changed, block the old session; it cannot be resumed or used as evidence.

## Code ownership

- `packages/release`: keep P3c.1 packet production pure and read-only; expose
  stable five-image descriptors and input verification as needed, without any
  dependency on the AI host.
- `packages/studio/src/qa-review.mjs`: own opt-in orchestration, the output
  journal/recovery state machine, prompt/result contracts, and injected host
  boundary. Keep this separated from the existing Studio CLI parser.
- `packages/studio/src/cli.mjs`: add preview, explicit apply, status and
  recovery commands; production host discovery reuses `@ludory/ai`.
- `packages/studio/test/qa-review*.test.mjs`: deterministic fake-host tests,
  no actual Web requests.
- Update Studio/Release docs and PR handoff to distinguish verified local
  data, browser-attested individual observations and owner/platform gates.

## Acceptance and adversarial cases

- Fresh trusted candidate on both targets: preview zero writes/zero host
  calls, apply makes exactly five ordered one-image calls, and each has
  independent matching V2 observation.
- Wrong model/effort, missing chip/processing event, wrong SHA/ref/trace,
  model reply falsely claiming visibility, malformed finding JSON and
  unfounded policy PASS all fail closed.
- Timeout after `REQUESTED`, crash/restart before `OBSERVED`, partial fifth
  image, invalid prior event, duplicate attempt, repeat invocation and
  explicit full restart are distinguishable without automatic resubmission.
- A fully rewritten and rehashed local journal cannot claim live authority,
  skip already observed images, or supply paths for a new upload. Recovery
  requires all original input flags and rechecks the original bytes.
- Tampered ZIP, metadata, capture report, screenshots, icon/cover, symlinks,
  file replacement races, output-directory conflicts and path traversal
  never write into the original candidate/game or leak off-target bytes.
- Full tests (`npm test`, `npm run check`, Core example), exact-head CI,
  independent review and explicit owner approval before any merge. Live
  account-bound Web attachment smoke remains owner-operated and separately
  reported as PASS/BLOCKED/NOT_RUN.

## Decisions for implementation

- Use five independent one-image turns; do not synthesize a false all-image
  review from only a subset.
- Keep each host request identity separate (`sessionId`, index) and never
  automatically retry after uncertain submission. A confirmed restart uses
  a new session ID and all five original images, not selective replay.
- Never rely on an editable local journal as authority to claim the reviewer
  really saw pixels; the authoritative boundary is the live observed helper.
- No code or actual Web transmission begins until the owner approves this
  design.
