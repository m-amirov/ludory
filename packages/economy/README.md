# @ludory/economy — E1 Pure Economy Core

Optional, platform-neutral ESM package (Node.js 22+). No browser, SDK, storage, server, clock or network calls. All existing games remain unaffected. **Economy is disabled unless an author explicitly enables it**; the first release of «Поцелуй на краю света» remains economy-free.

## Contract (v1)

```js
import {
  defineEconomy, createEconomyState, validateEconomyState,
  applyEconomyOperation, getPremiumAccess, getEconomyView,
} from '@ludory/economy';

const config = defineEconomy({
  schemaVersion: 1, enabled: true, gameId: 'future-novel', configVersion: 1,
  currency: { id: 'crystals', displayName: 'Кристаллы', icon: '💎' },
  maxBalance: 1000,
  rewards: { starter: 20, episode: 3, daily: 2, rewarded: 5 },
  premium: { 'special-date': { cost: 12, type: 'scene' } },
  products: { 'crystals-50': { currencyAmount: 50 } },
});

let state = createEconomyState(config);
state = applyEconomyOperation(config, state, { type: 'GRANT_STARTER' }).state;
state = applyEconomyOperation(config, state, {
  type: 'UNLOCK_PREMIUM', contentId: 'special-date',
}).state;
const available = getPremiumAccess(config, state, 'special-date');
const view = getEconomyView(config, state);

// After a trusted external persistence load, validate before use.
const restored = validateEconomyState(config, JSON.parse(JSON.stringify(state)));
```

The reward amounts and product names above are **illustrative**, not a live store or pricing policy. The package never handles platform currency (яны), real prices or cash. `defineEconomy` requires exact keys and a versioned config; source events never supply arbitrary amounts.

### Operations

| Operation | Required input | Idempotency key | Balance source |
| --- | --- | --- | --- |
| `GRANT_STARTER` | — | `starter:<gameId>` | `config.rewards.starter` |
| `GRANT_EPISODE` | `episodeId` | `episode:<episodeId>` | `config.rewards.episode` |
| `GRANT_DAILY` | `date` (`YYYY-MM-DD`, UTC) | `daily:<date>` | `config.rewards.daily` |
| `GRANT_REWARDED` | `attemptId` | `rewarded:<attemptId>` | `config.rewards.rewarded` |
| `GRANT_PURCHASE` | `sku`, `tokenDigest` (lowercase SHA-256 hex) | `purchase:<tokenDigest>` | `config.products[sku].currencyAmount` |
| `UNLOCK_PREMIUM` | `contentId` | `premium:<contentId>` | `-config.premium[contentId].cost` |

`applyEconomyOperation` returns a detached immutable `{ state, receipt }`; the receipt has `{operationId, type, applied, delta, balance}`. Repeating a recorded operation yields `applied: false, delta: 0`. Premium spending is atomic with entitlement delivery. Back/Replay must not rewind `state` (E2 will own the bridge). Purchasing an entitlement does not automatically grant relationship points; premium narrative *content* may apply authored effects under the E2 narrative policy.

The journal is append-only (maximum 2,000 entries), with exact replay validation of balances, grant IDs, purchase digests and entitlements. It blocks malformed snapshots, duplicate entries and mismatched values, and rejects a full journal with `CAPACITY_EXCEEDED`; it never discards purchase evidence. **There is no automatic migration:** changes to rewards, product amounts, premium prices or config schema for existing saves require a deliberate migration. An old journal must remain replayable at its historical terms.

## Security and platform boundary

- All E1 functions are pure and synchronous. They do **not** validate rewarded-ad completion, purchase legitimacy or account identity; E3/E4 must provide corroborated SDK evidence and persist wallet state before acknowledging grants.
- `tokenDigest` is a SHA-256 fingerprint supplied by the future trusted coordinator, not a purchase token. Never log, persist or export raw purchase tokens in E1. A digest **does not prove** a purchase occurred.
- Replay validation catches accidental corruption and simplistic snapshot modifications. **It is not cryptographic anti-cheat**: a user can still forge a self-consistent local journal. No custom backend was selected; cross-device atomicity and strong exactly-once guarantees are unavailable.
- Saving and restoring this economy envelope is a distinct integration from Core save/Back state. A failed or corrupt cloud load must fail closed, not silently reset the paid wallet.
- A real store is **not** functional here. E2: Narrative/Runtime composition; E3: ad/rewarded confirmation and persistence; E4: Yandex IAP catalog, purchase reconciliation and cloud; E5: Studio demo/profile and QA. VK payments remain unsupported in v1. No publication or live charging is authorized by E1.

Run `node --test packages/economy/test/*.test.mjs`, or use root `npm test` and `npm run check` (which include economy gates through npm lifecycle scripts).
