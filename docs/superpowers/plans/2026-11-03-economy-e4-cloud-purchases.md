# E4 — Economy cloud storage and Yandex consumable purchases

Date: 2026-11-03
Status: IMPLEMENTATION (owner-approved Approach A; no custom server)
Design: `../specs/2026-11-03-economy-monetization-design.md` §8–9

## Constraints

- Default-off, no game repository changes, no real SDK/payment requests in tests.
- Existing Core Runtime save envelope remains unchanged.
- Cloud-only Yandex monetary storage with separate game-scoped key, validated economy state, `setData(..., true)`, bounded UTF-8 payload and readback; no local fallback.
- VK cloud may persist one bounded wallet record, but does not expose IAP.
- Purchases: SDK catalog and portal currency only; active SKU allowlist distinct from immutable historical fulfillment map.
- One instance queue plus same-origin Web Locks for Yandex purchases; no cross-device transactional or antifraud guarantee.
- Raw purchase tokens never enter journal or logs. Credit+token digest stored before `consumePurchase`.

## TDD implementation steps

1. **RED** Yandex economy storage tests: separate key, cloud flush/readback, no local fallback, corrupt/missing/capacity/quota failures, authorization and no mutation. **GREEN** `packages/connect-yandex/src/economy-storage.mjs` and public export/dependency.
2. **RED** VK economy storage tests: bounded one-key payload, readback, corrupt JSON, fail closed, no IAP. **GREEN** `packages/connect-vk/src/economy-storage.mjs` and public export/dependency.
3. **RED** Yandex payment adapter tests: lazy acquisition, authorization, catalog+native price/currency, result shape, consume and SDK failures. **GREEN** `packages/connect-yandex/src/purchases.mjs` and export.
4. **RED** coordinator tests: purchase, startup/foreground restore, duplicate token, crash windows, pending save/consume, mismatch, unknown SKU, concurrency, disabled economy/no-cloud, lock-unavailable, catalog filters. **GREEN** extend `packages/runtime-economy/src/coordinator.mjs` with generic port and digest.
5. Docs: platform limitations, wiring example, no publication or real payments. Add syntax checks to `check:economy` and `npm run check`.
6. Evidence: targeted tests, full `npm test`, `npm run check`, `node examples/core-session.mjs`, browser mocks as available. Independent review, corrective fixes, PR to remote `main` and merge only after required Linux checks.

## Review gates

- Same token never credits twice, including lost save acknowledgment and consume failure.
- Unknown/mismatched SKU and no durable cloud save never consume.
- Portal price metadata comes only from SDK; historical inactive SKUs fulfill but are not sold.
- Web Locks unavailable means IAP unavailable, never silent fallback.
- Separate wallet key unaffected by narrative saves, all money-related errors fail closed.
- No paid feature enabled in «Поцелуй на краю света».
