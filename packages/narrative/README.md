# `@ludory/narrative` — N1

Pure, deterministic, offline-first visual novel scene engine for new Ludory projects. No browser, platform SDK, server, camera access, neural inference or runtime dependencies. Requires Node 22+ or a modern ESM browser build.

## Ownership

- The game authors the complete scene graph, dialogue, art asset IDs, finite interactive options and localized RU/EN responses.
- The engine validates and runs scene/beat transitions, branches, allowed predicates, route locks, photo/keepsake/message effects, delayed echo beats, endings and journal visibility.
- Store the resulting JSON subtree at `state.narrative` through generic `@ludory/core` or `@ludory/runtime` save/restore. The engine itself never persists or sends anything.
- `@ludory/runtime-narrative` (N2) and opt-in Studio template (N3) are separate work. N1 is **not yet a playable UI** or a platform release.

## Public contract

```js
import {
  defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState,
  resolveNarrativeView, advanceNarrative, validateNarrativeState,
} from '@ludory/narrative';

const l = (ru, en) => ({ ru, en });
const catalog = defineNarrativeCatalog({ schemaVersion: 1, interactions: [{
  id: 'message', type: 'message', label: l('Сообщение', 'Message'), variants: [{
    id: 'hello', recipient: 'friend', intent: 'greet', tone: 'warm',
    preview: l('Привет! Скучаю.', 'Hi! I miss you.'),
    reply: l('Я тоже!', 'I missed you too!'),
    effects: [{ op: 'memory_add', id: 'greeting' }],
  }],
}] });
const graph = defineNarrativeGraph({ schemaVersion: 1, id: 'hello', startSceneId: 'start', scenes: [
  { id: 'start', beats: [
    { id: 'intro', type: 'dialogue', text: l('Ночь.', 'Night.') },
    { id: 'write', type: 'message', interactionId: 'message' },
  ], nextSceneId: 'ending' },
  { id: 'ending', beats: [{ id: 'last', type: 'ending', endingId: 'hello', text: l('До завтра.', 'Until tomorrow.') }] },
] });

let state = createNarrativeState(graph);
console.log(resolveNarrativeView(graph, catalog, state, 'ru').text); // Ночь.
state = advanceNarrative(graph, catalog, state, { type: 'next', beatId: 'intro' }).state;
state = advanceNarrative(graph, catalog, state, { type: 'interact', beatId: 'write', optionId: 'hello' }).state;
console.log(validateNarrativeState(graph, catalog, state).memories); // ['greeting']
```

### Graph

- `defineNarrativeGraph` requires `schemaVersion:1`, `id`, `startSceneId` and `scenes[]`.
- Every scene has unique `id`, nonempty `beats[]`; last beat is a `choice` or `ending`, or scene declares `nextSceneId`.
- Beat types: `dialogue` (`text`), `photo`/`keepsake`/`message` (`interactionId`), `echo` (`sourceEventId`, `text`, optional `when`), `choice` (`choices[]` with `targetSceneId` and optional `effects`/`when`/`routeId`), `ending` (`endingId`, `text`).
- Static validation checks ID uniqueness, referenced scenes, source events, presence/reachability of endings ignoring predicates, and an exit path to some ending from every scene ignoring predicates. It **does not** prove conditional reachability for all runtime states, stylistic quality or all route outcomes. Cover meaningful combinations with scenario tests.
- Echo source must precede the echo when both are in one scene, or have a scene path to it. `validateNarrativeEchoCoverage(graph)` is a strict opt-in authoring check ensuring every interaction beat has a delayed callback; Studio's future N3 release gate must invoke it. Lightweight prototypes can use `defineNarrativeGraph` without this content requirement.
- Conditions are JSON-only: `all`, `any`, `not`, `flag`, `memory`, `album`, `routeIntent`, `routeLock`, `relation: {id,gte?,lte?}`. Arbitrary JS is rejected.

### Interactions

- `photo` options can display an authored `assetId` and add to the album; they do not access a hardware camera.
- `keepsake` options add a selected persistent item.
- `message` variants specify finite `recipient`/`intent`/`tone`, optional earned `attachmentId`, optional `when` predicate, `preview`/`reply` in RU/EN and explicit effects. Free-text and online classification are intentionally absent.
- Effects: `relation_delta` (bounded to -100..100), `flag_set`, `memory_add`, `album_add`, `keepsake_add`, `route_intent`, `route_lock`. Earned collections are unique. A completed interaction beat cannot re-award effects after save/restore.
- `echo` appears only after the source interaction and its `when` predicate; unearned echoes are automatically skipped and completed echoes are recorded.
- For an exclusive route branch, annotate `choices[].routeId` so an existing `routeLock` filters incompatible choices. Choices with no `routeId` can remain route-neutral.

### State and limits

`createNarrativeState(graph)` produces a JSON-compatible state subtree with a bounded canonical `actionLog`. Each `advanceNarrative(graph,catalog,state,action)` returns a new state and a receipt; inputs are never mutated. `validateNarrativeState` replays that log from the start and checks the entire saved state: inventing an earned item, changing a route lock or jumping to an ending without a matching action history fails. This is consistency verification, not cryptographic anti-cheat protection against a player deliberately rewriting both data and action log. `resolveNarrativeView` exposes only currently available options. Pass `beatId` with UI actions to prevent stale input dispatch; repeating a completed `interact` with the same `beatId` returns `duplicate:true`. Visiting an already completed one-shot beat through a narrative loop skips it while retaining the single reward.

N1 has no durable Back/history manager; a host that needs Back must restore a full previously saved Core state snapshot, including the narrative subtree. Never silently erase invalid saves. Storage migrations and browser UI belong to N2/N3.
