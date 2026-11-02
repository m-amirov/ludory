# Ludory P3b — Playwright browser QA and evidence capture

Date: 2026-11-01. Base: main after PR #62 (P3a).
Owner decision: **no Docker and no mandatory OS/container isolation**. Run only owner-authorized Ludory-built candidates with ordinary Playwright browsers.

## Goal and boundaries

Run an explicitly authorized, already-built Yandex/VK candidate in Playwright and collect bounded UI/functional evidence tied to the exact original ZIP SHA-256. Support Windows and Linux. No publication, moderation submission, new server infrastructure, paid API, or changes to game source/ZIP.

Playwright runs game JavaScript on the host and **is not a security boundary**. Only use on builds the operator trusts. No automatic execution as part of read-only `ludory qa simulate`. Launch requires a separate explicit command. Browser profiles must be temporary and not reuse personal profiles or browser credentials. Default test network handling should avoid unnecessary external calls and explicitly report SDK mocks; no claim that network filtering is OS isolation.

## Implementation slices

1. **P3b.1 — verified candidate staging.** Preserve reusable strict stored ZIP parser and `stageQaCandidate()`, candidate SHA-256/CRC/path/size validation, a private temporary directory, file hash revalidation, and ownership-safe cleanup. No browser launches on this step.
2. **P3b.2 — Playwright launch (no Docker).** Implement opt-in, cross-platform Playwright capture for trusted candidates. Serve only the staged build on a loopback HTTP listener (existing preview server where applicable, otherwise a focused read-only server with the same path protections). Use fresh Playwright context, no inherited profile, bounded waits, `finally` cleanup, and current-candidate SHA validation. Missing Playwright/browser binaries or unavailable local listener -> `BLOCKED`, not an invented pass. Platform SDKs are locally mocked only when a known test fixture provides an explicit mock; otherwise record untested host functionality.
3. **P3b.3 — browser observations.** Record startup, page errors and console errors, HTTP failures, viewport/orientation, scroll and reachability, screenshots at desktop and mobile emulation, and only known safe game actions where available. Real-device and live SDK checks remain `NOT_RUN`. Avoid arbitrary click-through outside game origin.
4. **P3b.4 — bounded evidence.** Manifest includes candidate SHA-256, target, runner/browser versions, case ID, viewport and DPR, exact actions, errors, original PNG dimensions/hash, screenshot paths and evidence digest. Explicit output directory must be fresh and outside game/ZIP; never overwrite. A user-edited JSON receipt cannot attest browser observation on its own.
5. **P3b.5 — integration and gates.** Add a separate opt-in CLI command; leave P3a read-only and unchanged by default. Respect `releaseReady:false`, `publicationAllowed:false` and `actualModeration:'NOT_RUN'`. Subjective visual/content/promo review remains `BLOCKED` until independent P3c.

## Acceptance tests

- Unit/regression: valid Yandex/VK candidates, wrong SHA, missing/corrupt ZIP, missing browser, unexpected HTTP/network requests, cleanup after timeout, error capture, screenshot file hashes, archive source immutability.
- Browser: Chromium desktop and Android emulation; WebKit emulated iPhone where locally available. Windows and Linux should not require Docker.
- `npm test`, `npm run check`, `node examples/core-session.mjs`, Playwright smoke and GitHub CI on exact PR HEAD all pass.
- Independent review before merge. PR stays Draft until tests and code review are complete; merge only with owner's approval.

No existing games are migrated or edited and no actual platform approval can be inferred.
