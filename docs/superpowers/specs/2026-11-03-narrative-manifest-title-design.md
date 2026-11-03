# Narrative Manifest Title — Design

## Intent

An author-created Ludory narrative must display its own title, not the template's demonstration story, while preserving the byte-attested F5b2 launcher contract. The first real consumer is `kiss-at-the-edge-of-the-world-ludory` PR #2.

## Approaches

1. **Recommended: runtime title from the signed game manifest.** Keep the Studio-generated JavaScript launcher canonical for F5b2; at shell update use the already-validated `game.title[locale]` with deterministic fallback to the first available title. Replace the initial HTML demo heading with neutral copy. Version the template and update contract tests. Works both offline and in platform builds.
2. Per-project patch of `src/main.js`: simple for one game, but F5b2 explicitly rejects modified launchers; rejected.
3. New HTML-only title override: leaves the browser's `document.title` and accessibility text stale; rejected.

## Constraints

- No external SDK/network calls to determine title; use `ludory.project.json` through `defineGame`.
- Must not weaken `F5B_AUTHOR_ENTRY_CONTRACT_UNVERIFIED` protection.
- Preserve existing `game.id:narrative-demo` save key in this change: renaming would orphan deployed saves. Replace it only with an explicit migration and backward compatibility tests (separate work).
- RU-only games switching to English UI must still show their RU game title; no invented English translation.
- No game publication, release or change to old user repositories from this PR.

## Acceptance

- Title resolver returns an existing localized title and deterministic fallback, not a demo title.
- Rendered shell uses resolver on initial and locale changes; initial HTML has no false demo title.
- F5b2 derives VK/Yandex projects from a freshly created Studio game; authored changes to `src/main.js` are still blocked.
- Template descriptor is versioned; generated evidence/tests updated.
