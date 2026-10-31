# Connect VK — F3 / V1 isolated VK Bridge SDK boundary

**Status:** design and contract implementation candidate. Owner review and separate merge approval required.

## Target

This is **VK Games / VK Mini Apps**, not VK Play. Official VK Bridge uses `send('VKWebAppInit')`, `subscribe`, `unsubscribe` and `supportsAsync`. V1 provides a browser-global-free adapter with an explicitly supplied Bridge loader; it deliberately does not bundle a VK SDK, touch accounts or implement a fake host-global fallback. No external runtime dependency is added in V1. Official references:

- https://github.com/VKCOM/vk-bridge/blob/master/packages/core/README.md
- https://github.com/VKCOM/vk-bridge/blob/master/packages/core/src/bridge.ts
- https://github.com/VKCOM/vk-mini-apps-api/blob/master/src/index.ts

## V1 contracts

- `@ludory/connect-vk` isolated package; no imports into Core or Yandex.
- `createVkConnector({ bridgeLoader, timeoutMs })` imports under Node without browser globals.
- `initialize()` is single-flight, invokes `VKWebAppInit` at most once per connector, preserves stable status/errors, rejects invalid bridge interfaces, loader/init errors and timeouts, and does not allow late READY after cancellation/destruction.
- Without an injected real Bridge: `BRIDGE_UNAVAILABLE`, never simulated platform success.
- `probeCapabilities()` uses `supportsAsync` when available. Values `DECLARED_SUPPORTED` / `DECLARED_UNSUPPORTED` / `UNKNOWN` only describe **Bridge-advertised method support**; neither SDK calls nor live ads, storage or devices have been tested.
- `livePlatformVerified` remains `false` for any fixture or real SDK injection until a separate signed/independently observed platform gate exists.
- No save persistence, ad rewards, player authorization, publication, hosted game, or VK build in V1. No Yandex evidence can be reused.

## Follow-up slices

V2: explicit VK web/mobile lifecycle, storage contract and failure tests. V3: fullscreen/rewarded ads, no reward without verified event. V4: isolated VK entrypoint, deterministic target bundle, desktop 1000×720 wide mode, responsive Android browser smoke with stub Bridge. V5: separate owner-approved platform/Release observations; not 1.0 technical framework prerequisite when account/device unavailable.

## V1 acceptance gates

Node test cases: import without browser globals, absent/invalid Bridge, single-flight, init reject, timeout, destroy during load/init, late completion, bounded capability probe. GitHub Core CI Linux/Windows Node 22/24 and Runtime Browser R6 on exact HEAD. No platform PASS / Release PASS, no live console operations.
