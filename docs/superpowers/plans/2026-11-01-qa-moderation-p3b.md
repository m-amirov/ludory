# Ludory P3b — isolated browser QA and evidence capture (implementation plan)

Date: 2026-11-01. Base: main after PR #62 (P3a). Owner-approved P3 design: `docs/superpowers/specs/2026-11-01-qa-moderation-simulation-design.md`.

## Goal and non-goals

Opt-in browser observations of the *exact* already-built, independently verified Yandex/VK candidate ZIP. Collect deterministic, hash-bound functional results and original screenshots for P3c. No source or ZIP mutation, platform access, live SDK, publication, or implicit external network. Failure to provide a genuinely isolated browser environment is `BLOCKED`, never a downgraded sandbox or synthetic PASS.

## Trust model and implementation steps

1. **P3b.1 — immutable candidate staging (TDD).** Add a bounded archive-to-temporary-directory staging function. Reuse the existing Release stored-ZIP parser, its CRC/path and candidate SHA checks, and read the complete ZIP a second time immediately before staging. Refuse a changed or mismatched SHA. Unpack only validated files, without symlinks, permissions wider than owner, preexisting destinations, or arbitrary path traversal. Verify staged bytes against each receipt member. Cleanup checks the temp directory's original identity and is idempotent. Inputs and original ZIP are never changed. Include positive Yandex/VK tests and negative tests for SHA mismatch, unsafe paths and missing/corrupt ZIP.
2. **P3b.2 — isolated execution contract.** No generic `playwright.chromium.launch({args:['--no-sandbox']})` from the host as security isolation. Run the staged game in a separately provided verified OS/container sandbox that disables outbound network, does not mount user secrets or repo workspace, uses its own unprivileged identity and resource/time limits, and serves only staged public assets on loopback *inside that sandbox*. Use strict capability attestation; unavailable or unverifiable sandbox => `BLOCKED/QA_BROWSER_ISOLATION_UNAVAILABLE`. Playwright context restrictions and request routing are defense-in-depth only.
3. **P3b.3 — bounded functional observation.** Only for an authorized current candidate, exercise startup, declared routes or safe deterministic test actions, runtime exceptions, console errors, blocked external requests, screenshots, orientation, viewport, controls, reload/saves, and focus/audio if observable. No clicking an arbitrary game's outbound URLs. Explicitly label mock SDK and mobile emulation. Do not claim to have traversed branches without action coverage.
4. **P3b.4 — evidence ownership.** Artifact manifest: schema version, target, candidate SHA, rule-pack revision, runner ID/version and isolation attestations, browser engine/version, per-step viewport/DPR/timeouts, actions, observations, original PNG dimensions/hash, screenshot file paths and checksums. Output to an explicit new directory *outside* project/ZIP directories; no overwrite. Hash the complete serialized manifest; scrub credentials and disallow external URL fetches. Run-generated evidence is non-authoritative after it leaves the runner; `simulateModeration()` must not convert a user-supplied JSON `source:MACHINE_OBSERVED` to PASS.
5. **P3b.5 — integration and gates.** Add optional CLI browser mode only when isolation is attested and the current ZIP is bound to the original P3a candidate hash. Preserve P3a's read-only behavior as default and constant `releaseReady:false`, `publicationAllowed:false`, `actualModeration:'NOT_RUN'`. Browser observations may clear only their own scope; subjective visual, content and promo review remain BLOCKED until P3c. Add Windows/Linux unavailable-sandbox tests, malicious candidate inputs, stale/replaced archive tests, clean lifecycle/cleanup tests, deterministic evidence checks, and independent review.

## Verification and release gates

- `npm test`, `npm run check`, `node examples/core-session.mjs`, target browser smoke and new security-negative tests must pass.
- Run the exact PR HEAD on GitHub CI for Ubuntu and Windows Node 22/24, plus browser workflow.
- No trust expansion or runtime publication commands; do not merge before security review and user approval.
- Physical-device testing, real platform SDK and actual moderation intentionally remain NOT_RUN.

## Engineering note

P3b.1 may be reviewed and merged independently as a non-executing safe-staging slice. Do not attempt P3b.2 until the process/container security boundary is demonstrably enforceable in supported environments. In particular, `--no-sandbox` is not a valid substitute for the required external containment.
