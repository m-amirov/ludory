# Release R3 — strictly gated Yandex Draft browser observation

- R3 is an **opt-in, read-only browser observation tool** for an owner-supplied existing Yandex Games Draft. R3 does not upload a ZIP, log into an account, click advertisements, start gameplay, write cloud saves, submit moderation or publish.
- The default command performs only local R2 verification and outputs \`BLOCKED/AWAIT_OWNER_AUTHORIZED_BROWSER\`. Live network access is possible only with an explicit \`--execute\` flag. No draft URL or account is bundled in Ludory.
- URLs must use HTTPS on \`yandex.ru\` or \`yandex.com\` and have \`/games/app/<id>?draft=true\` without \`game_url\`, dev mode or other query parameters. No custom domains, HTTP or localhost masquerading as a platform draft.
- The browser uses an ephemeral, unauthenticated Chromium context, service workers blocked and downloads disabled. If authorization is required, the probe remains BLOCKED (no attempt to use browser profiles or collect credentials).
- The game frame must actually mount and report the READY state. Its asset root is derived from the observed frame, not from a caller-supplied assertion. All files from an R1-validated C5 ZIP are fetched independently over HTTPS without redirects or content encoding, and each is checked for matching byte size and SHA-256. Requests are streamed with strict upper bounds; unexpected game host, redirects, missing files, size or digest mismatch stop the probe. A host unsupported by this first-slice allowlist remains BLOCKED for investigation, not silently accepted.
- On successfully observed bytes and READY, result is \`CAPTURED_UNVERIFIED\`, **not** PASS, as no independently authenticated Yandex server attestation or human/device inspection exists. R2's user-reported evidence is not promoted. \`releaseReady=false\`, \`publicationAllowed=false\` always; physical Android/iOS, advertising, Player/auth and rights remain NOT_RUN.
- Unit tests cover URL spoofing, local override, malformed/duplicate file sets, tampered remote files, preflight, and failure-closed publication flags. No actual platform session is run by CI.

Run the tool from \`packages/runtime/test/browser/\` after \`npm ci --ignore-scripts\` and installing the Playwright Chromium runtime:

\`\`\`sh
node yandex-r3-observe.mjs --archive /tmp/candidate.zip --receipt /tmp/receipt.json \
 --sdk-evidence /tmp/sdk.json --rights /tmp/rights.json \
 --draft-url 'https://yandex.ru/games/app/12345?draft=true'
# After separate owner authorization for the existing draft, add --execute.
\`\`\`

The default read-only plan cannot certify hosting. Even \`--execute\` may fail when the real draft needs an authenticated account. R3 is an incremental witness, not final platform acceptance or release authority.

## SDK bootstrap completion signal (R3 review hardening)

The shipped Yandex runtime sets `#status[data-sdk-ready="true"]` only after Runtime host initialization, `LoadingAPI.ready()` success and bootstrap UI wiring. A bootstrap error clears this signal and records `bootstrap:error`. The R3 browser must require this signal in addition to `READY` and verify it again after hashing all remotely hosted assets. An observed bootstrap failure is `FAIL/R3_SDK_BOOTSTRAP_FAILED`, never `CAPTURED_UNVERIFIED`.
