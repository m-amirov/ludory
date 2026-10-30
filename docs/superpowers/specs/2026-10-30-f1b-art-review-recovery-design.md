# F1b art-review interruption safety — design

## Intent

An independent visual-review browser submission may complete after its caller times out. Prevent an implicit second billable browser turn without losing user files, valid source-bound review receipts or legacy run compatibility.

Web DEV is free in the owner's workflow. References to billable turns in the original design are historical risk wording: the actual invariant is **no duplicate or ambiguous reviewer execution**, independent of price.

## Approved pragmatic durability revision

The owner explicitly removed the directory-`fsync` requirement for this free Web DEV workflow. Request event bytes and commit-marker bytes are still flushed before host submission; their completed pair is validated before reuse. The operation does **not** assert power-loss durability of directory entries on Windows or Linux. Process crashes leave a pending request or recognized remnants for explicit recovery. A sudden machine power loss can lose the latest directory entries and leave the outcome uncertain; no unattended retry is allowed. Windows must pass functional and process-interruption tests, but an NTFS power-cut durability proof is no longer an F1b merge gate. Do not claim stronger persistence, paid-operation guarantees, or Release PASS.

## Approved crash-journal recovery extension

`workflow recover-storage --run <id>` inventories recognized orphan `.pending-*` files, a single final uncommitted event/marker, a final uncommitted artistic receipt/marker in `reviews/`, and a dead process lock. A preview makes no changes; `--confirm-no-executor --apply` rechecks hashes and inode identity, then hard-links and unlinks recognized remnants to `.recovered-<token>-<label>` in the **pinned source directory's parent**, using only relative `..` addressing. No replaceable quarantine destination path is traversed. Crucially, recovered evidence lies **outside** the strict `events/`, `reviews/` and `ai/` reader namespaces: neither legitimate recovery nor arbitrary recovered-looking filenames can hide committed history. The standard native writer lock serializes journal moves. An active/uncertain PID, non-tail partial record, unexpected filename or modified snapshot must block. Complete committed pairs remain immutable. This never invokes Web DEV and does not close a pending host request: run ordinary witnessed/interrupt recovery separately.

Linux process-termination fault injection, Windows process-interruption tests, concurrent writer attack resistance and real Web DEV visual evidence remain distinct evidence categories. The real-host test may remain BLOCKED rather than fabricate attestation. Neither local recovery tests nor free Web DEV imply Release PASS.

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
