# @ludory/runtime-narrative (N2)

Optional offline-first DOM renderer and input adapter for `@ludory/narrative` N1.
No platform SDK, camera permission, runtime AI, server or free-text input is required.

```js
import { createNarrativeState } from '@ludory/narrative';
import { createNarrativeRenderer, createNarrativeRuntimeUpdate } from '@ludory/runtime-narrative';
import { createRuntimeHost, createBrowserEnvironment } from '@ludory/runtime';

const environment = createBrowserEnvironment({ root: document.querySelector('#game') });
const update = createNarrativeRuntimeUpdate({ graph, catalog });
const host = createRuntimeHost({
  game, // normal Core definition, owned by the new game
  initialState: { narrative: createNarrativeState(graph) },
  update,
  renderer: createNarrativeRenderer({ graph, catalog, locale: 'ru', assets, now: environment.now,
    canBack: () => update.canGoBack() }),
  input: { subscribe: () => () => {}, enable() {}, disable() {} },
  environment,
});
await host.initialize();
host.start();
```

The input adapter accepts only the finite commands `narrative:next:<beat>`,
`narrative:choose:<beat>:<option>`, `narrative:interact:<beat>:<option>` and
`narrative:back`. The Runtime host validates normalized event shapes/timestamps,
then the N1 engine rejects stale, unavailable and forged choices. Two sends for
the same beat never award twice. Only `state.narrative` is persisted; Back uses a
bounded session-local history (default 64) which resets on reload/restore.
Connect `canBack` to `update.canGoBack()` to hide unavailable undo after reload.

`createNarrativeRenderer` exposes Runtime's `mount`, `resize`, `render`, and
`unmount`, plus optional `setLocale('ru'|'en')`. Give `now` the **same clock** as
`environment.now`, otherwise the Runtime host may drop events with incompatible
timestamps. Standard buttons support keyboard, pointer and touch. Author text
is inserted with `textContent`; asset URLs are limited to same-origin/local
paths and image data URLs, with visible fallback when unavailable.

The message composer is explicitly authored and finite: intent → tone →
available attachment → preview → send/cancel; cancellation only discards the
local draft, leaving the mandatory message beat open. Replies and their effects come from the
N1 catalog. Runtime does **not** analyze player-written text or generate AI
responses. The journal shows earned album/keepsakes/memories/messages only. For
player-facing localization, pass `labels` with author-owned RU/EN maps for
`intent`, `tone`, `recipient`, and `journal` IDs. Pass `relationFacts` as
`[{id:'friend', min:2, text:{ru:'Мы стали ближе', en:'We grew closer'}}]` to
display unlocked relationship facts without exposing numerical relationship
scores or unreached plot details. IDs are only a technical fallback for games
that have not yet provided display labels.

## Verification

```sh
npm test
npm run check
node examples/core-session.mjs
cd packages/runtime-narrative/test/browser
npm ci --ignore-scripts
npx playwright install chromium firefox webkit
npm run smoke
```

Browser smoke covers 1000×720 desktop, Android-sized portrait, Chromium,
Firefox and WebKit; it never calls external services. Physical devices,
SDK-specific platform certification and existing-game migrations are not
covered by N2. N3 adds the opt-in Studio game template.
