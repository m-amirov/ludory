# F6a: bounded Yandex ad callback wait — design

## Intent and constraints

Address the F6 P1 finding where `showFullscreen()` or `showRewarded()`
never settles after an SDK call that omits `onClose`/`onError`, potentially
leaving the Runtime paused indefinitely. Preserve Yandex SDK's callback
attestation rule: a fulfilled SDK-returned Promise is **not** evidence that
an advertisement was displayed, and reward requires the verified callback
sequence. No live SDK, platform deployment, or game migration in this change.

## Alternatives and decision

1. **Per-attempt deadline from SDK request (chosen):** reject unresponsive
   attempts whether or not `onOpen` happened; clear the timer on all terminal
   paths and release only the ad-owned pause lease. Align the default and
   validation contract with the existing VK adapter.
2. Deadline only after `onOpen`: limits a paused ad but leaves a request
   without any callback permanently pending and blocks further attempts.
3. Depend on SDK terminal callbacks: preserves current unbounded failure.

## Observable contract

- `createYandexAds({ sdk, host, lifecycle, timeoutMs = 120_000 })` validates
  `timeoutMs` as a safe integer in `[1, 300_000]` milliseconds.
- One timer starts per accepted attempt **before** calling the SDK method.
  Timeout rejects with `YandexConnectError` / `ADS_FAILED`, never resolves
  `{ shown:true }` or awards a reward, and releases only its owned pause.
- Timeout with no `onOpen` leaves Runtime running. Timeout after `onOpen`
  resumes Runtime unless another independent reason owns the pause.
- All terminal outcomes (success, no-show, SDK failure, throw, lifecycle
  loss, timeout and destroy) cancel the timer exactly once. Stale callbacks
  and delayed thenables cannot settle or pause a newer attempt.
- After timeout, a fresh attempt may run, matching VK's bounded-request
  behavior. Concurrent attempts remain rejected; adapter destroy prevents
  reentry during synchronous Runtime resume subscribers.

## Acceptance

- Test-first regression: missing callbacks before and after `onOpen`, late
  rewarded callback, timeout recovery/reentry, independent pause reasons,
  parameter validation and timer cancellation after success/destroy.
- Existing Yandex/Runtime tests, full `npm test`, `npm run check`, and
  relevant template/build checks remain green.
- Ship as a small code+test PR from a separate Ludory worktree. Do not
  create a release tag or alter frozen games. Other F6 findings stay open.
