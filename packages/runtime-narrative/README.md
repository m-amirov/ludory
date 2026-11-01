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

### Optional portrait-first presentation

The renderer's `preferredMobileOrientation` accepts `'auto'` (the default for
existing callers) or `'portrait'`. New Studio narrative templates explicitly
pass `'portrait'`; other game genres and earlier renderer integrations remain
unchanged. On narrow portrait viewports, the opted-in renderer uses scoped
safe-area padding, readable panel widths and wrapping choice/composer buttons.
Landscape stays playable with a scrollable fallback; desktop wide layouts keep
their prior sizing. The rendered section exposes **both**
`data-mobile-preference="portrait|auto"` (stable author setting) and
`data-orientation="portrait|landscape"` (measured from the current viewport);
resizing or rotating never changes the author preference or game progress.

This is responsive presentation, not `screen.orientation.lock()`: it does not
prevent rotation, disable accessible zoom, or configure Yandex/VK developer
console orientation. Test actual handsets and host portals separately before
claiming physical-device or platform acceptance.

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
The N3 smoke (`node packages/runtime-narrative/test/browser/studio-n3-smoke.mjs`
from the repository root) additionally checks the generated story at 320 px,
emulated iPhone/Android, 667×375 landscape, tablet and desktop sizes, long
choice labels, 200% root-font scaling, keyboard-space proxy, Back, rotation, save/reload and `auto`
opt-out. These are emulations, not physical iPhone/WebKit evidence.
