# E5 — Opt-in economy interface, Studio example, and release QA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Every behavior change gets a RED → GREEN test. Tasks use checkbox steps.

**Goal:** Make E1–E4 usable by a future Ludory author through an explicit economy template, player-facing wallet, and non-misleading simulated release gates.

**Architecture:** Keep wallet authority in `@ludory/runtime-economy` and cloud SDKs in Connect. Add an optional DOM panel that invokes only existing runtime ports, a separate Studio narrative economy example with `enabled:false` until the author configures platform ports, and a standalone advisory release-readiness assessment; existing templates and games stay unchanged.

**Tech stack:** Node 22+ ESM, native DOM, built-in Node test, existing Studio catalog/esbuild and Release moderation utilities. No server, Docker, additional paid providers or new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-03-economy-monetization-design.md` §§6–12, approved Approach A and staged E5.

## Global Constraints

- No modifications to frozen game repositories; «Поцелуй на краю света» remains economy-disabled.
- No implicit wallet grants, purchase/ad attempts or storage fallback. No real SDK calls or publication in QA.
- Never format invented Yandex price: use SDK catalog values only, and expose no VK IAP.
- No claim of real platform readiness from mock/simulation outcomes.
- `@ludory/core` remains platform-neutral; new-game configuration is author-controlled.

## Review Focus

1. Repeated taps on wallet actions should not duplicate charges, rewards or SDK interactions (Task 1).
2. A failed or ambiguous save must show an honest pending state and explicit recover action (Task 1).
3. Malicious catalog titles or image URLs must not execute markup or unsafe navigation (Task 1).
4. An enabled template without a genuine cloud storage port must fail closed, never silently use localStorage (Task 2).
5. A local simulated moderation PASS must never turn production payment/policy gates into release-ready (Task 3).

### Task 1: Accessible, optional wallet and storefront view

**Files:** create `packages/runtime-economy/src/panel.mjs`, `packages/runtime-economy/test/panel.test.mjs`; export from `src/index.mjs`; update package README.

**Interface:** `createEconomyPanel({root, wallet, locale:'ru'|'en'})` → `{render(),dispose()}`. `root` supports DOM element operations, `wallet` is the E1–E4 coordinator. Buttons dispatch solely explicit user actions; `render` never invokes SDK. No document globals outside the bound root.

- [ ] Test disabled hides all economy actions and never calls a port; enabled view renders balance and daily eligibility.
- [ ] RED `node --test packages/runtime-economy/test/panel.test.mjs` reports missing API.
- [ ] Implement output as text nodes and buttons with accessible labels/live status; no `innerHTML` and no unsafe SKU image injection.
- [ ] GREEN same test command.
- [ ] Test daily/reward retry, verified ad request, store refresh/SDK prices, purchase/restore and error/retry paths, no duplicated concurrent taps and no automatic charges.
- [ ] RED targeted test for each behavior; implement minimal handlers and rerender; GREEN targeted tests.
- [ ] Commit `feat(economy-e5): add optional wallet and store panel`.

### Task 2: Explicit Studio economy-narrative starter

**Files:** new `packages/studio/catalog/templates/narrative-economy/*` with game-owned `config/economy.json`, `config/premium.json`, graph sample and managed browser entry/assets; register only as a distinct `narrative-game` template in the profile. Add `scripts/build-economy-template.mjs`, Studio tests and documentation.

**Interface:** generated game works with `enabled:false` without storage/SDK calls; enabling economy requires injected platform `{storage,ads?,purchases?}` ports and an explicit verified cloud; premium sidecar is validated against the authored graph, and the narrative renderer/update both use the same guarded wallet. Display panel only when enabled. Initial example SKU registry is empty.

- [ ] Test Studio catalog lists the new template, creation previews are read-only and receipts hash every emitted file; existing templates unchanged.
- [ ] RED Studio template test before adding catalog entry.
- [ ] Implement isolated template, build script and `npm run check:economy-template` reproducibility gate.
- [ ] GREEN targeted tests and run generated default-off story in a browser mock, checking zero economy SDK calls.
- [ ] Test enabled fixture with injected cloud storage; premium authored relation/memory effects occur only after unlocked choice and a free good-ending trace remains valid.
- [ ] RED then GREEN integration test; commit `feat(studio): add opt-in economy narrative template`.

### Task 3: Money-aware simulated QA and docs

**Files:** create `packages/release/src/economy-readiness.mjs`, `packages/release/test/economy-readiness.test.mjs`; export without changing existing moderation API; add guides and policy-watch pointers.

**Interface:** `assessEconomyReadiness({target, enabled, evidence})` returns a frozen declarative report of `PASS`/`BLOCKED` gates with `releaseReady:false`, `publicationAllowed:false` for opt-in monetary games unless separately verified actual-platform evidence is independently reviewed. Unsupported VK purchase activation is blocked. No authoritative compliance claims.

- [ ] RED tests for disabled/not-applicable, simulated Yandex missing real catalog/recovery/cloud/cross-device proof, VK IAP unsupported, arbitrary forged PASS evidence rejected, and no actual publication.
- [ ] Implement strict local evidence contract and documented release gates; GREEN tests.
- [ ] Update relevant READMEs and root verification scripts; commit `feat(release): add economy readiness simulation gates`.
- [ ] Run `npm test`, `npm run check`, `npm run check:economy-template`, `node examples/core-session.mjs`, targeted browser smoke. Independent whole-branch review, fix P0/P1, then PR and Linux checks before integration.

