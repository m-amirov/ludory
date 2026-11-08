# Narrative player-facing headings — design (2026-11-08)

## Intent and boundaries

The M4 real-browser pilot for *Поцелуй на краю света* shows internal scene keys
such as `s02-road` and `s03-coffee` as large headings. They arise from the shared
Ludory Runtime renderer, not from corrupted Studio or narrative data. Ordinary
dialogue and choice views carry no authored `view.label`; the renderer currently
falls back to `view.sceneId` for `<h2>` and exposes `${view.sceneId}: ${view.beatId}`
as the panel's accessible label.

**Approved approach A:** do not expose internal identifiers as player-facing
headings. Preserve authored interaction labels and the localized ending heading.
Avoid inventing prose scene titles or modifying authored graph identifiers.

**Considered alternative B:** author localized titles for every scene. This gives
editorial control but expands the graph schema, migration and translation surface;
it is deliberately out of scope for this corrective change.

## Player and accessibility contract

1. Render a visible `<h2>` only for a meaningful authored `view.label`, or for
   the existing localized ending title. Do not create an empty heading for
   ordinary dialogue, choices or echoes without a label.
2. Keep the narrative panel focusable (`tabindex=-1`), with `aria-live="polite"`.
   On a beat transition without a heading, focus falls back to the panel;
   otherwise existing heading focus and button focus restoration remain intact.
3. The panel's accessible name is the existing localized story label, not raw
   `sceneId`/`beatId`. Provide read-only `data-scene-id` and `data-beat-id` on
   the panel for deterministic QA/debugging without exposing them as prose.
4. Never change internal `sceneId`, `beatId`, inputs, save schema, state
   migration, Back, journal, or route logic. Leave economy and premium choices
   unchanged and disabled in the first game.

## Distribution and dependencies

- Change only the shared `packages/runtime-narrative/src/renderer.mjs` behavior,
  its tests, and the generated Studio narrative bundle. Increment the real
  `narrative-interactive` template version from `1.2.4` to **`1.2.5`** because
  its managed `assets/ludory-narrative.js` bytes change.
- Test a legitimate Studio `1.2.4` → `1.2.5` component update: only managed
  bundle/manifest may change, and an ownership backup must be kept; authored
  story, visual map and asset proof bytes must remain identical.
- Open a separate Ludory PR based on `main`; do not rewrite merged PR #92.
  After integration, bring game PR #3 forward using the native Studio update
  command **only on a host with valid owner trust**. If a new host requires
  trust authorization, stop at the read-only trust preview and request a fresh
  owner grant. Never edit Studio-managed game bootstrap files by hand.
- Update game Chromium QA to track `data-scene-id`/`data-beat-id` instead of
  relying on the old accessible label; verify the missing visible IDs in
  390×844 and 1000×720 screenshots. Keep game PR #3 stacked on Draft PR #2,
  without merging or publishing.

## Acceptance and non-goals

- Renderer tests cover unlabeled dialogue/choice/echo, labeled interactive
  beats, locale-specific ending, panel accessible name and transition focus.
- Deterministic generated bundle check, template version/upgrade tests and
  focused Runtime/Studio tests pass; record every actual test command and
  result. The game's actual-browser S01→S03 gate passes on the updated bundle.
- Media admission, rights, music, full S01–S66 routes, platform SDK validation,
  moderation and production release are unrelated open gates and **not** claimed
  by this change. No Docker, offline mode or real-platform publication.
