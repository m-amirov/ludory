# Ludory UI Design — game-interface craft skill

**Status:** Proposed for review in a separate Draft PR, 2026-10-28. The owner has requested creation of a repository-local anti-generic UI-design skill; this document does not authorize edits to existing games or claim visual acceptance.

## Decision

Create `.agents/skills/ludory-ui-design/SKILL.md` for concept/design and authorized implementation of **new Studio-created game** interfaces: main menus, gameplay HUD, pause/settings, results and onboarding. Its main output is a compact per-screen design contract linking player action to visual hierarchy, typography, composition, illustration/icons, controls and responsive states.

The existing `ludory-visual-qa` remains independent and requires real current-build pixels; `ludory-production-art` owns production imagery; `ludory-asset-rights` owns font/image licence provenance. A concept mockup may be judged **design-ready**, never real-build visual PASS. No skill authorizes an external upload, game creation, modification of frozen games or publishing without separately scoped approval.

## Alternatives considered

1. **Reuse a site-oriented `frontend-design` skill verbatim:** strong anti-template principles but inappropriate React/Tailwind/shadcn assumptions and no game-HUD-specific conditions. Rejected.
2. **Build automated AI-slop detector:** aesthetic judgments depend on game genre, audience and deliberate art direction, so static bans or scoring would yield false confidence. Rejected.
3. **Original game-specific design discipline with reviewable artifacts:** selected. No imported third-party instructions and no global hooks.

## Acceptance for the skill itself

- A discoverable, narrow trigger distinguishes *design* from post-render visual QA and art production.
- The per-screen brief names a clear player action and type scale/font with localization coverage and licences, coherent spacing and graphic language, first-frame hierarchy, mobile safe-area/touch/keyboard/focus constraints, and relevant loading/error/paused/results states.
- An anti-generic decision means each visual choice serves game personality and gameplay comprehension, not a blanket ban on gradients, cards, glass or popular fonts.
- Review-only remains read-only; implementation modifies only explicitly authorized new games. External artifacts are untrusted data. Claims are scoped to inspectable evidence; missing runtime screenshots stay `BLOCKED` for visual acceptance.
- Negative contract tests and baseline-vs-guided pressure trials exercise these boundaries; Node tests verify skill structure, **not** artistic merit of game pixels.

## Instruction pressure trials (2026-10-28)

Both trials used the same rushed brief: mobile space-fragment arcade, menu/HUD/results, 20-minute limit, conventional patterns permitted. **Without** the new skill the independent agent defaulted to a generic violet/cyan *Neon Space Rush* aesthetic, uniformly panelled HUD and asserted invented 60-second rounds and three lives. **With** this skill the independent agent identified timer/lives/controls/score as unconfirmed, avoided uniform glass cards, proposed a mechanic-aware visual direction and kept final design acceptance blocked until the game specification, font evidence and real runtime pixels exist. This is a qualitative instruction test, **not** a rendered UI A/B experiment or objective aesthetic score.

A separate read-only pressure case asked for visual/release PASS from an absent Figma image and no running game. The instructed agent requested actual input, limited its findings to review criteria, declined any mutation and preserved the runtime-pixel blocker. The contract tests additionally check mandatory discovery, domain limits and mutation-resistant guard phrases.

## External research provenance

Original Ludory-specific guidance, informed by the catalogue entries `frontend-design`, `design-system` and `make-interfaces-feel-better` at https://agentskill.sh/for/ui-designer (accessed 2026-10-28). No external skill source, dependencies, scripts or global configuration are imported.
