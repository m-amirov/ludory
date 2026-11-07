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

### M4: opt-in visual scene presentation

`presentation` is a separate author-owned map of per-beat stage cues. It does **not**
change `graphData`, saved narrative state, choice availability, or existing
interactive photo/album `assets`. Use the same API in custom games and in
Studio `narrative-interactive` v1.2.3+:

```js
import { defineNarrativePresentation, createNarrativeRenderer } from '@ludory/runtime-narrative';

const presentation = defineNarrativePresentation(graph, {
  schemaVersion: 1,
  media: {
    harbor: { kind: 'background', src: 'assets/vis-harbor.webp',
      alt: { ru: 'Гавань', en: 'Harbor' } },
    alice: { kind: 'portrait', src: 'assets/vis-alice.webp',
      alt: { ru: 'Алиса', en: 'Alice' } },
    memory: { kind: 'cg', src: 'assets/vis-memory.webp',
      alt: { ru: 'Воспоминание', en: 'Memory' } },
  },
  beats: {
    arrival: [{ id: 'intro', background: 'harbor',
      portraits: [{ characterId: 'alice', mediaId: 'alice', slot: 'center' }],
      speaker: { ru: 'Алиса', en: 'Alice' } }],
    waiting: [{ id: 'neutral-stage', neutral: { reason: 'not-illustrated' } }],
    ending: [{ id: 'ending-art', cg: { mediaId: 'memory', mode: 'replace-stage' } }],
  },
});
const renderer = createNarrativeRenderer({ graph, catalog, presentation });
```

Replace example `beatId`s with real IDs from your validated graph.
`media.kind` is `background|portrait|cg`; `src` is strictly a *flat local image*
`assets/<safe-name>.(png|webp|jpg|jpeg)` (no directories, SVG, CDN, data URI,
query string or traversal). Optional `speaker` and media `alt` are RU/EN
localized text. Portrait slots are `left|center|right`. CG mode
`replace-stage` suppresses the background and portraits; `overlay` composites
the CG above them. Use `neutral:{reason:'...'}` for beats with intentionally
no illustration. It cannot coexist with image layers.
Every variant must have at least one visible layer or an explicit `neutral.reason`;
an empty object or a speaker-only variant is invalid.

Each beat may have several variants distinguished by `when` conditions from
the public Narrative predicate language (e.g. `{flag:'seat-eric'}` and
`{not:{flag:'seat-eric'}}`). If two variants match at once, resolution throws
instead of silently showing an unrelated route. Unmapped beats receive a
neutral stage; the previous art is **never** inherited. Resolver output comes
solely from the canonical narrative state, including after Back or restore.
Image decoding failure removes only the failed layer and retains the neutral
background. Image elements have safe authored `alt` and do not intercept
pointer input. The dialogue panel remains scrollable above the stage; artwork
is not part of `state.narrative`.

In a new Studio game, `src/story.js` can export `presentationData` (raw manifest)
or omit the export for the original text-only behavior. The installed
`src/main.js` validates it before constructing the renderer. Record every
image shipped under `assets/` (PNG/JPEG/WebP) in author-owned
`narrative-assets.json` with `path` and actual `sha256`, and update
`storySha256` after changing the authored JS. For Studio `narrative-interactive`
projects the proof file is mandatory: preview and platform-derived builds
reject its removal, unproved raster images, mismatched bytes and unsafe links.
The proof checks integrity, **not** copyright or suitability of a real asset.
The visually separate `narrative-economy` starter was regenerated as v1.0.1
for compatibility, with no changes to purchases or currency configuration.

`createNarrativeRenderer` exposes Runtime's `mount`, `resize`, `render`, and
`unmount`, plus optional `setLocale('ru'|'en')`. Give `now` the **same clock** as
`environment.now`, otherwise the Runtime host may drop events with incompatible
timestamps. Standard buttons support keyboard, pointer and touch. Author text
is inserted with `textContent`. Presentation images resolve against the
document's real URL (ignoring authored HTML `<base>`), require a matching
HTTP(S) origin, and fail closed when that cannot be established. Legacy
interactive asset URLs retain their existing local/data-image rules.

### Optional portrait-first presentation

The renderer's `preferredMobileOrientation` accepts `'auto'` (the default for
existing callers) or `'portrait'`. New Studio narrative templates explicitly
pass `'portrait'`; other game genres and earlier renderer integrations remain
unchanged. On narrow portrait viewports, the opted-in renderer uses scoped
safe-area padding, readable panel widths and wrapping choice/composer buttons.
The new Studio interactive shell bounds mobile portrait height to the visual
viewport, keeping long dialogue, journal and composer scrolling inside the
narrative region; the compact header remains separately scrollable when very
large text makes its controls taller than the available space. Landscape stays
playable with side safe-area gutters and a scrollable fallback; desktop wide layouts keep
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
choice labels, 200% root-font scaling, a keyboard-space proxy with bounded
composer/journal scrolling, Back, rotation, save/reload and `auto`
opt-out. These are emulations, not physical iPhone/WebKit evidence.

M4's real-browser smoke uses a separate opt-in synthetic image fixture:

```sh
cd packages/runtime-narrative/test/browser
npm run smoke:m4
# Optional screenshots: LUDORY_M4_ARTIFACT_DIR=/path/to/evidence npm run smoke:m4
```

It exercises 390×844 and 1000×720, localized `alt`, explicit neutral stages,
CG replace/overlay, Back, reload, and a corrupt resource. The synthetic 1px
images only prove DOM/media geometry and resource handling. Real character
face crop, image rights, mobile-device and VK/Yandex certification require
separate game-specific evidence. If Chromium cannot open a socket, record
`BLOCKED_BROWSER` and do not call the visual gate PASS.
