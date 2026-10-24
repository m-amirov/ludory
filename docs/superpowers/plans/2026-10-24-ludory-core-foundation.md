# Ludory Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first tested, platform-neutral `@ludory/core` package and repository migration roadmap.

**Architecture:** An ESM monorepo; Core exposes separate definition, state and game-session modules. Runtime, Connect and AI are future opt-in consumers, not dependencies.

**Tech Stack:** Node.js 22+ and built-in `node:test`, no external dependencies.

**Spec:** `docs/superpowers/specs/2026-10-24-ludory-foundation-design.md`

## Global Constraints

- Do not import DOM, storage, CEOS, Phaser, Yandex SDK or VK Bridge in Core.
- Reject invalid input before mutation. Use copy-in/copy-out for state.
- Do not claim CEOS/Starter Kit parity or platform release acceptance.
- Use tests-first for every Core behavior.

## Review Focus

- Cyclic/undefined/nonfinite state is rejected, instead of creating lossy snapshots — covered in Task 2.
- Returned state/definition copies cannot mutate internals — covered in Tasks 1 and 2.
- Invalid transitions or ticking outside `running` cannot execute update code — covered in Task 3.
- Wrong-game or wrong-version snapshots cannot mutate live session — covered in Task 3.
- Snapshot restore rejects malformed revision/schema before state mutation — covered in Task 3.

---

### Task 1: Versioned definition

**Files:** `packages/core/src/definition.mjs`, `packages/core/test/definition.test.mjs`, `packages/core/src/index.mjs`.

**Interfaces:** Produces `defineGame(input): Readonly<GameDefinition>` and `validateGameDefinition(input)` alias not needed.

- [ ] Add tests for valid Yandex+VK target metadata, missing/duplicate targets, invalid IDs/version/title and input mutation isolation.
- [ ] Run `node --test packages/core/test/definition.test.mjs` and observe missing export failure.
- [ ] Implement `defineGame` with no platform SDK knowledge and strict metadata checks.
- [ ] Run same test and confirm PASS.

### Task 2: Serializable state

**Files:** `packages/core/src/state.mjs`, `packages/core/test/state.test.mjs`.

**Interfaces:** Produces `createStateStore(initialState)` returning `getState()`, `setState(nextState)`, `getRevision()`, `subscribe(listener)`, `restore({revision,state})`.

- [ ] Test JSON object handling, deep copy, monotonic revision, subscribe/unsubscribe, invalid state and all-or-nothing restore.
- [ ] Run `node --test packages/core/test/state.test.mjs` and observe missing export failure.
- [ ] Implement a pure JSON validator/copy helper and store.
- [ ] Run the state tests and full suite; confirm PASS.

### Task 3: Lifecycle, tick and snapshots

**Files:** `packages/core/src/session.mjs`, `packages/core/test/session.test.mjs`.

**Interfaces:** Consumes `defineGame`, `createStateStore`. Produces `createGameSession({definition,initialState,onUpdate})` returning `getStatus()`, `initialize()`, `start()`, `pause()`, `resume()`, `stop()`, `tick(deltaMs)`, `getState()`, `setState()`, `snapshot()`, `restore(snapshot)`.

- [ ] Test legal transitions, rejected invalid transitions, ticking in all statuses, snapshot round-trip and invalid/mismatched snapshot failure.
- [ ] Run `node --test packages/core/test/session.test.mjs` and observe missing export failure.
- [ ] Implement session using previous two modules, without host clock.
- [ ] Run all tests and syntax check; confirm PASS.

### Task 4: Example and delivery

**Files:** `examples/core-session.mjs`, `README.md`, `packages/core/README.md`, `docs/ROADMAP.md`.

**Interfaces:** Public API from Tasks 1-3 is exercised end-to-end.

- [ ] Add runnable example demonstrating game definition, tick, pause, snapshot and restore.
- [ ] Run `npm test`, `npm run check`, `node examples/core-session.mjs` and inspect output.
- [ ] Review repo diff for source-license, docs, breaking-contract and migration claims; deliver in a feature PR, not an unreviewed merge.
