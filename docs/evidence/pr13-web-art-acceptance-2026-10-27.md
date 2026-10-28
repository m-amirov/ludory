# PR #13 Web Art Acceptance v2 evidence

Date: 2026-10-27
Branch: `feat/web-art-acceptance` (`ceos/task/pr13-web-art-acceptance` worktree)
Published PR head at inspection: `e028ed194dcf146ea712d7898421c14e2aed4d93`

## Installed DEV profile

- Profile: isolated `C:\Users\user\.codex-chatgpt-web-dev`.
- Config: version 3, `browser-only`, `browserHost: launcher`, `subagentProtocol: compatibility-v1`.
- Profile release: `6.1.11`.
- Launcher descriptor: `runtime/launcher-browser.json`, `kind: codex-web-gpt-launcher`, `profile: development`.
- Registered helper: the descriptor points to the installed Codex Web GPT launcher and its sibling `resources/runtime/app/browser-helper.cjs`.
- The Ludory trust check accepts this штатный installation only; a foreign helper path remains `DEV_DESCRIPTOR_UNTRUSTED`.

## Observed helper wire format

The installed helper emitted this safe frame shape on startup:

```json
{"type":"ready","features":["progress","tool-boundary-ack","completion-fence","multipart-stage-ack","skill-attachments"]}
```

It did not emit `protocolVersion: 1`. A direct `{"type":"capabilities","id":"probe-1"}` request produced no capabilities frame within the bounded probe window. The installed helper source accepts the compatibility-v1 turn events `prepared_selected`, `send_activated`, and `submitted`, but does not emit Ludory v2 `image_attached` or `hostObservation` evidence.

Consequently, the actual registered helper is not promoted to an observed Web route by Ludory: probe result is `DEV_ROUTE_UNVERIFIED`; no visual turn, model attestation, image upload receipt, or artistic receipt was recorded.

## Capability boundary

Fresh commands returned:

- `ceos capability-challenge --help` → `CEOS_ERROR: BLOCKED_SESSION_CONTEXT_UNVERIFIED`.
- `ceos context --skill production-art --project .` → CEOS manifest missing under the Ludory worktree.
- `ceos context --skill verification --project .` → CEOS manifest missing under the Ludory worktree.

No ImageGen call was made and no test image was promoted as generated output. No Web artistic verdict or `PASS_ART` receipt exists.

## Local verification

- `npm test`: 283 passed, 0 failed.
- `npm run check`: passed.
- `node examples/core-session.mjs`: passed.
- `git diff --check`: passed; only normal Windows LF/CRLF warnings were reported.
- Focused DEV host regression: 18 passed, 0 failed.

Remote PR head `e028ed1` had successful Ubuntu and Windows CI checks for Node 22 and Node 24 at inspection time. These remote checks predate the unpushed local changes and are not evidence for this worktree's final commit.

## Gate status

`BLOCKED`: the installed `codex-chatgpt-web` helper lacks the browser-observed v2 attachment/model evidence contract, and the current trusted Codex session cannot issue a valid capability challenge. No release or merge decision is implied.
