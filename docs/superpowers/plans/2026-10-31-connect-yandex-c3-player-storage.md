# Connect Yandex C3: Player cloud-save adapter

## Scope and gate

Implement C3 from the approved 2026-10-29 Yandex Connect design on `feat/connect-yandex-c3` based on the current `main`. Only the new connector adapter, its public contract/tests, package metadata, and docs change. Do not modify Runtime/Core, frozen games, CEOS, Starter Kit, or live Yandex data. C4/C5 remain separate PRs.

## TDD implementation steps

1. Add `packages/connect-yandex/test/player-storage.test.mjs` asserting real adapter behavior against an isolated fake Player SDK: lazy shared provider, retry after failure, scoped/versioned keys, valid roundtrip, missing/null load, flush acknowledgements, explicit deletion of own key, failure codes/causes, 200 KiB UTF-8 preflight, serialized mutation/read, and no silent local fallback. Run targeted tests and observe failure (RED).
2. Add Runtime integration tests using the real `createRuntimeHost` and fake SDK storage: saved SHA-256 V1 envelope survives roundtrip; corrupted hash and incompatible schema fail before state mutation; cloud failures become Runtime save/restore failures. Observe RED.
3. Implement `createYandexPlayerStorage({ getPlayer, namespace })` in Connect, with a stable game-scoped `ludory:<namespace>:v1:<saveKey>` key, validated inputs, lazy Player resolution, guarded promise-based `getData/setData`, `flush:true`, size preflight, error types, no fallback, serialized operations. Keep Player SDK access outside module import. Add errors and exports; connect package may depend on Runtime for persisted-record shape validation.
4. Run targeted tests (GREEN), full `npm test`, `npm run check`, `node examples/core-session.mjs`, `git diff --check`; document SDK contract and limitations. Check Git diff for unrelated changes.
5. Push own branch and open C3 PR with exact test evidence. Independent review and exact-HEAD CI precede any requested merge; do not mark live Yandex integration PASS.

## Acceptance conditions

- Valid cloud save/restore works with real Runtime V1 SHA-256 records and `flush:true`.
- Only namespaced key changes; `clear` writes a null tombstone; no login prompt or implicit local fallback.
- Player/SDK/quota/network/rate errors propagate with stable codes; invalid payload never silently succeeds.
- Pending writes/reads do not race; no claims based on pending SDK operations.
- Existing Node/Windows CI checks remain unchanged and pass; real Console evidence stays BLOCKED until owner-authorized live test.
