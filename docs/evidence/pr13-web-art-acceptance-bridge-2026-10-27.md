# PR #13 Web Art Acceptance v2 bridge evidence

Date: 2026-10-27
Repository: `m-amirov/ludory`
Branch: `ceos/task/pr13-web-art-acceptance` (PR head branch: `feat/web-art-acceptance`)
Inspected HEAD: `3769ca08cfbd8381111413af241ed296e50abf5e`

This record is diagnostic evidence only. It does not grant `HOST_OBSERVED`,
`PASS_ART`, ImageGen PASS, Release PASS, or merge readiness.

## Installed helper and upstream comparison

- Installed application runtime: `Codex Web GPT` 6.1.14.
- Isolated DEV profile: `C:\Users\user\.codex-chatgpt-web-dev`.
- DEV profile release: 6.1.11, `browser-only`, launcher host,
  `subagentProtocol: compatibility-v1`.
- Stable profile release: 6.1.14, also `browser-only`, launcher host,
  `subagentProtocol: compatibility-v1`.
- The registered helper is the official launcher executable and its exact
  sibling `resources\runtime\app\browser-helper.cjs`; no trust boundary was
  bypassed and no installed binary or profile was modified.
- The upstream `v6.1.11...v6.1.14` comparison changes browser behavior and
  configuration, but does not add a caller-visible attachment/model evidence
  event to the helper protocol. The attachment observer remains internal to
  the browser worker.

## Exact bridge gap

Upstream `BrowserTurn` exposes callbacks for `prepared_selected`,
`send_activated`, `submitted`, multipart acknowledgements, visible reasoning,
commentary, and text. `attachFiles()` internally does all of the following:

1. finds the ChatGPT upload input;
2. starts the attachment observer;
3. calls `setInputFiles()` with the prepared payload;
4. waits for the upload-processing stream and the visible attachment chip;
5. waits for an enabled Send control.

The upload observer treats `file.processing.completed` as completion and
fails on processing errors. Model selection is also checked internally from
the ChatGPT DOM and visible announcements.

The installed helper-client/main wire contract exports only compatibility-v1
events and `result.text`. It has no event or result field for:

- the independently observed selected model;
- the exact attached byte payload;
- SHA-256 or byte length calculated in the helper context;
- the file-processing completion bound to the selected source;
- a versioned `hostObservation` receipt.

Therefore the existing events cannot satisfy Ludory v2: `prepared_selected`
is prompt preparation, `send_activated` is a send boundary, `submitted` is
prompt acceptance, and `result.text` is response content. None proves that the
declared image bytes were attached or that the requested model was selected.

The required upstream interface is a versioned browser-observation event (or
equivalent result field) emitted only after internal model verification and
attachment completion. The helper must compute SHA-256 and byte length from
the actual image bytes in its own context, bind them to the observed upload,
and expose the selected model/effort from the DOM-backed selection. Ludory
should continue to reject the turn when this event is absent or inconsistent.

## Minimal real attachment smoke

A bounded smoke used the authenticated ChatGPT page in the isolated DEV
launcher browser through its loopback CDP endpoint. It did not send a prompt
and did not produce a Web art verdict.

- Upload input: the active `input[type=file][multiple]:not([accept])` with
  the ChatGPT attachment label.
- Upload endpoints observed: `POST /backend-api/files` and
  `POST /backend-api/files/process_upload_stream`.
- Processing status: HTTP 200.
- Completion event observed in the processing stream:
  `file.processing.completed`.
- Visible attachment chip: observed after upload.
- Test file: `ludory-attachment-smoke-inspect-1793079966421.png`.
- Actual payload size: 68 bytes.
- SHA-256 of the actual payload: `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`.
- The model picker control was visible and the UI showed high reasoning, but
  no independent helper event identified the selected model as
  `chatgpt-web/gpt-6-sol`.

This proves the browser UI can accept a real image in the isolated profile;
it does not prove Ludory `HOST_OBSERVED`, because the current helper does not
export the source-bound observation.

## Helper wire probe

The official helper startup frame was:

```json
{"type":"ready","features":["progress","tool-boundary-ack","completion-fence","multipart-stage-ack","skill-attachments"]}
```

No v2 observation frame was available. A bounded full-turn probe with the
isolated profile did not produce a result or observation frame, so it is not
counted as a successful Web turn and no evidence was promoted from it.

## ImageGen boundary

The current Codex session exposes an ImageGen tool interface, but the fresh
run-scoped command `ceos capability-challenge` returned:

`CEOS_ERROR: BLOCKED_SESSION_CONTEXT_UNVERIFIED`

No ImageGen call was made, no generated asset was treated as production
output, and no capability challenge or environment declaration was used to
unlock generation. This is a current trusted-context/capability blocker, not
an ImageGen PASS and not a Ludory receipt.

## Checks and gates

The final source HEAD was previously verified with:

- `npm test`: 283 passed, 0 failed;
- `npm run check`: passed;
- `node examples/core-session.mjs`: passed;
- `git diff --check`: passed, with only normal Windows line-ending warnings;
- focused DEV-host regression: 18 passed, 0 failed.

Current-HEAD CI run 40454800203 was green for Ubuntu and Windows, Node 22 and
Node 24:

<https://github.com/m-amirov/ludory/actions/runs/40454800203>

Those checks validate the local fail-closed implementation and platform
matrix. They do not replace a real helper-exported model/image observation,
independent visual verdict, or saved source-bound receipt.

## Verdict

- Browser-level upload: observed and source bytes independently hashed.
- Ludory Web Art Acceptance E2E: `BLOCKED` at helper evidence export.
- ImageGen capability smoke: `BLOCKED_SESSION_CONTEXT_UNVERIFIED`.
- Artistic verdict and receipt: not created.
- Release/merge: not approved; PR #13 remains Draft.
