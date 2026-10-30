# F1b art-review interruption safety — design

## Intent

An independent visual-review browser submission may complete after its caller times out. Prevent an implicit second billable browser turn without losing user files, valid source-bound review receipts or legacy run compatibility.

## Approaches

1. **Chosen — existing native event ledger.** Append a source/run-bound `ART_REVIEW_REQUESTED` event before `host.turn` and a terminal `ART_REVIEW_RESULT` after writing a witnessed review receipt. Pending state blocks every subsequent mutation except explicit recovery. Uses the existing append-only hash chain, transaction lock and `workflow recover --confirm-no-executor`; no second filesystem authority or status store.
2. Separate art-intent ledger: viable, but duplicates serialization/locking/integrity and creates crash windows between two independently committed ledgers.
3. Process-local timeout lock: rejected; cannot survive process death or reliably distinguish completed paid work.

## Contract

- No external Web DEV invocation without a committed native `ART_REVIEW_REQUESTED` event; bound to immutable image, brief, four context sources and run head.
- Repeated `art-review --apply` while the event is pending returns `ART_REVIEW_PENDING` with **zero** new host turns. If the host throws, times out, returns incomplete attestation or edits occur after submission, remain pending; no invented `PASS_ART`.
- `workflow recover --confirm-no-executor --apply` requires the owner to verify the old helper has stopped. Append a terminal interruption event without deleting existing receipts or user files. If a witnessed receipt was committed but its terminal event was lost, recovery closes the request as witnessed, not as interrupted.
- A late old-host response cannot write a review after recovery has closed its request; source changes during a pending turn are rejected.
- Existing historical runs and artistic receipts without the new request field remain readable; no stage advancement, real Web attestations, API transport or CEOS integration added.
- Browser live smoke, Windows and exact-head CI remain independent acceptance gates.
