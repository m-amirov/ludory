# Economy E1 Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a pure, optional `@ludory/economy` package with deterministic wallet, grants, purchase receipts, premium entitlements and a replay-validated idempotent journal.

**Architecture:** Implement one immutable configuration and one immutable economy-state transition function. No SDK, persistence, clocks, browser APIs or narrative engine changes in E1. Keep the public contract strict and versioned so E2 can gate premium choices and E3/E4 can feed verified reward/payment evidence into pure operations.

**Tech Stack:** Node.js 22+ ESM, built-in `node:test`, npm workspaces; no new production dependencies.

**Spec:** `docs/superpowers/specs/2026-11-03-economy-monetization-design.md` (approved variant A, plus 2026-11-03 approved premium narrative effects).

## Global Constraints

- `@ludory/core` stays platform-neutral; implement E1 only in `@ludory/economy` and root workspace wiring.
- No owner-operated backend, OpenAI API, Docker, SKU activation, release or publishing.
- Feature is optional; all pre-existing game/runtime behavior is unchanged. «Поцелуй на краю света» is economy-disabled.
- Client-only state is not fraud-resistant. Do not label hashing or journal verification as anti-cheat proof.
- Prices for real portal currency are never hardcoded. The demo values `20/3/5/8–15` are illustrative, not production policy.
- E1 has no async SDK adapter: E3/E4 orchestrators own ad/payment confirmation and durable save.
- Write a failing test before each behavior. Run full `npm test`, `npm run check`, `node examples/core-session.mjs` and workspace version checks before E1 review.

## Review Focus

1. Repeated source event or purchase digest: `applyEconomyOperation` returns a duplicate receipt without a second credit (Task 2/3).
2. Malformed JSON, number overflow, insufficient balance and unknown premium content: reject without mutating state (Task 1/3).
3. Tampered snapshot that changes balance or entitlements without journal history: `validateEconomyState` rejects as corrupt (Task 3).
4. Back/Replay economics: same premium content unlock is one charge regardless of repeated access (Task 3); E2 later separately checks narrative effects.
5. Oversized journal: explicit capacity error rather than silent loss of purchase evidence (Task 3).

---

## Files and responsibilities

| Path | Responsibility |
| --- | --- |
| `packages/economy/package.json` | Workspace package, exports, Node version. |
| `packages/economy/src/validate.mjs` | Exact JSON fields, ids, integers, config and state validation. |
| `packages/economy/src/state.mjs` | Initial state and journal replay/invariant verification. |
| `packages/economy/src/operations.mjs` | Pure deterministic transitions and idempotent receipts. |
| `packages/economy/src/errors.mjs` | Stable error codes and error class. |
| `packages/economy/src/index.mjs` | Public API only. |
| `packages/economy/README.md` | Versioned state, security boundary, API examples. |
| `packages/economy/test/*.test.mjs` | Behavior and validation tests. |
| `package.json`, `package-lock.json` | New workspace and full-suite/check coverage. |

Exact names below are the stable contract for E2–E4. Each function copies input and returns detached values; pure operations neither read time nor create random IDs.

## Task 1: Package/config and initial state

**Files:** create `packages/economy/{package.json,src/validate.mjs,src/state.mjs,src/errors.mjs,src/index.mjs,test/config.test.mjs}`.

**Interfaces:**

- `defineEconomy(raw): Readonly<EconomyConfigV1>`; exact fields: `schemaVersion:1`, `enabled:boolean`, `gameId:string`, `configVersion:1`, `currency:{id,displayName,icon}`, `maxBalance:safe positive integer`, `rewards:{starter,episode,daily,rewarded}` all nonnegative safe integers, `premium:Record<contentId,{cost:safe positive integer,type:'scene'|'dialogue'|'cg'|'outfit'}>`, `products:Record<sku,{currencyAmount:safe positive integer}>`; strict keys and bounded IDs.
- `createEconomyState(config): EconomyStateV1`: `{schemaVersion:1,gameId,configVersion,balance:0,entitlements:[],completedGrants:[],purchaseTokens:[],journal:[],lastDailyClaim:null,revision:0}`.
- `EconomyError` with `.code` and a finite `ECONOMY_ERROR_CODES` list, including `DISABLED`, `INVALID_OPERATION`, `INSUFFICIENT_FUNDS`, `BALANCE_OVERFLOW`, `CORRUPT_STATE`, `CAPACITY_EXCEEDED`, `STALE_DAILY_CLAIM`.

- [ ] **Step 1 — RED:** Add `test/config.test.mjs` asserting frozen/detached valid config, default-disabled state, rejection of unexpected keys, unsafe/negative values, unknown content types, duplicate IDs after normalization, and unsupported schema versions.
- [ ] **Step 2 — Verify RED:** `node --test packages/economy/test/config.test.mjs` must fail because the new public API is absent (not because test syntax is wrong).
- [ ] **Step 3 — GREEN:** Implement `defineEconomy`, `createEconomyState`, errors and exports with exact validation; no external dependencies.
- [ ] **Step 4 — Verify GREEN:** Rerun the targeted test; all cases pass with no warnings. Commit: `feat(economy): add strict config and initial wallet state`.

## Task 2: Idempotent grants, journal and deterministic receipts

**Files:** create `packages/economy/src/operations.mjs`, `packages/economy/test/grants.test.mjs`; extend `src/index.mjs`.

**Interfaces:**

- `applyEconomyOperation(config,state,operation): {state,receipt}`; `receipt:{operationId,type,applied:boolean,delta,balance}`. Input state never mutates. Each operation ID is deterministic, constructed from source-specific keys; application duplicates return `applied:false` with `delta:0` and same balance.
- Supported grants: `{type:'GRANT_STARTER'}`, `{type:'GRANT_EPISODE',episodeId}`, `{type:'GRANT_DAILY',date:'YYYY-MM-DD'}`, `{type:'GRANT_REWARDED',attemptId}`. Amount is read exclusively from config, never from an untrusted caller.
- Journal entry: `{operationId,type,delta,contentId:null|string,sku:null|string}`, with `revision` strictly incremented once per successful nonduplicate operation.

- [ ] **Step 1 — RED:** Add separate tests: starter grants once; episode ID grants once; daily claim once per UTC date and refuses older dates; same rewarded attempt never grants twice; new ID grants again; disabled config rejects operations; overflow/zero-amount handling; original state stays unchanged.
- [ ] **Step 2 — Verify RED:** `node --test packages/economy/test/grants.test.mjs` fails because grant operations are not implemented.
- [ ] **Step 3 — GREEN:** Implement deterministic idempotent grants and append-only journal; no I/O or clock. A configured zero reward is a no-credit applied receipt recorded once to avoid replay ambiguity.
- [ ] **Step 4 — Verify GREEN:** Targeted test passes; re-run Task 1 tests. Commit: `feat(economy): add deterministic and idempotent grants`.

## Task 3: Premium unlocks, purchase credits and replay validation

**Files:** extend `packages/economy/src/{operations.mjs,state.mjs,validate.mjs,index.mjs}`, create `packages/economy/test/{premium,purchases,integrity}.test.mjs`.

**Interfaces:**

- `getPremiumAccess(config,state,contentId): {unlocked:boolean,cost:number}`; read-only, no spend.
- `getEconomyView(config,state): {enabled,balance,currency,entitlements}` as detached read-only data.
- `GRANT_PURCHASE`: `{type:'GRANT_PURCHASE',sku,tokenDigest}`; token digest is lowercase 64-hex, SKU maps to immutable configured `currencyAmount`, raw purchase token never appears in state/journal.
- `UNLOCK_PREMIUM`: `{type:'UNLOCK_PREMIUM',contentId}`; debit once and add entitlement in same operation/state. Retrying unlocked content returns duplicate without debit even after Back/Replay.
- `validateEconomyState(config,raw): EconomyStateV1`; replay journal from initial state and require exact resulting balance/entitlements/completedGrants/purchaseTokens/revision/lastDailyClaim. Bounded journal (E1 cap 2,000 entries) rejects further unique operations with `CAPACITY_EXCEEDED`, never prunes processed purchase evidence. A future migration must preserve idempotency keys.

- [ ] **Step 1 — RED:** Test insufficient crystals, unknown premium IDs, successful debit/unlock, second attempt no debit, premium content accessible after state round-trip, unknown SKU rejection, duplicate purchase digest no re-credit, changed SKU/digest mismatch rejection, purchase amount strictly from config, safe integer overflow. Make sure the intended production change is named by each test.
- [ ] **Step 2 — Verify RED:** `node --test packages/economy/test/premium.test.mjs packages/economy/test/purchases.test.mjs` fails for unimplemented unlock/purchase functions.
- [ ] **Step 3 — GREEN:** Add purchase and premium transitions with shared idempotency path; ensure no partial state on exceptions.
- [ ] **Step 4 — Verify GREEN:** Targeted tests pass, then commit: `feat(economy): add premium entitlements and purchase grants`.
- [ ] **Step 5 — RED:** Test tampered balances/entitlements/journal, deleted purchase token evidence, reordered/duplicated journal entries, invalid revision, oversized journal, invalid date progression, prototype/accessor/cyclic records; reject as `CORRUPT_STATE` or `CAPACITY_EXCEEDED` as appropriate.
- [ ] **Step 6 — Verify RED:** `node --test packages/economy/test/integrity.test.mjs` fails due missing/insufficient replay validator.
- [ ] **Step 7 — GREEN:** Implement replay-based `validateEconomyState`, strict detached JSON reads, journal cap; do not serialize token plaintext or claim client-side antifraud.
- [ ] **Step 8 — Verify GREEN:** All economy test files pass. Commit: `test(economy): enforce replay-derived wallet integrity`.

## Task 4: Workspace integration, documentation and E1 release gate

**Files:** modify root `package.json` and generated `package-lock.json`; create `packages/economy/README.md`, adjust root `README.md` only if needed for a clear package table entry.

**Interfaces:** Other packages may import only documented `@ludory/economy` exports; E1 introduces no dependence from existing packages. Root scripts explicitly include `packages/economy/test/*.test.mjs` in `npm test`, source syntax checks in `npm run check`, and workspace version inventory as required by existing repo convention.

- [ ] **Step 1 — RED:** Add a workspace integration test or extend existing workspace-version tests to prove `@ludory/economy` is included and resolves through npm package exports. Run it to see the intended missing-workspace failure.
- [ ] **Step 2 — GREEN:** Update root scripts and lockfile via normal npm tooling, add package README with public API, planned E2–E4 adapters, no-server caveats and default-off guarantee.
- [ ] **Step 3 — Verify:** Run `npm test`, `npm run check`, `npm run check:versions`, `node examples/core-session.mjs` using Node 22+. Capture exact commands, exit codes, total tests and all failures. Never suppress pre-existing failures.
- [ ] **Step 4 — Review:** Inspect `git diff --check`, `git status --short`, `git diff --stat`, public exports and test evidence. Confirm no changes to existing game repositories, Core, Narrative or platform adapters. Commit `docs(economy): expose verified E1 API`.
- [ ] **Step 5 — Deliver:** Open E1 PR against latest `main` (not against the design branch after it is merged); include technical rationale, RED/GREEN evidence, full-suite outputs and explicit pending E2–E5 work. Do not merge E1 with unverified checks or claim production monetization readiness.

## Subsequent plans (not covered by E1 delivery)

- **E2:** `@ludory/runtime-economy` + guarded Narrative composition; premium scene author effects (`relation_delta`, flags, memories, delayed echo) occur through normal story actions; buying alone has no relationship effects; free action traces reach every intended good ending; Back/Replay never recharges.
- **E3:** reward orchestrators and Yandex/VK SDK adapters, persistent grant-on-confirmation, crash/failure limitation disclosure.
- **E4:** Yandex client-mode IAP catalog, stable historical SKU mapping, cloud persistence before `consumePurchase`, startup reconciliation, cross-device caveats.
- **E5:** optional Studio template/profile, demo UI and QA/release gates. First game remains disabled.

Each subsequent phase gets its own focused implementation plan from the same approved technical specification immediately before work, because SDK and template interfaces may change independently of E1.

## Plan self-review

- E1 covers pure wallet/config/ledger/replay; no SDK/persistence feature falsely claimed.
- Five Review Focus cases map to Tasks 1–3, including malicious JSON and replay evidence.
- Public names match the specification and E2/E3/E4 handoff. Later package dependencies are deferred intentionally.
- Production code is not to be written before each targeted test fails as intended.
