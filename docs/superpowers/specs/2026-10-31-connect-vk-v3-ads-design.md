# Connect VK V3 — bounded fullscreen and rewarded ads

**Status:** owner approved VK Bridge result-confirmed reward strategy on 2026-10-31; implementation and CI acceptance pending. **Target:** VK Mini Apps, not VK Play.

## Contract

- Expose `createVkAds({ bridge, lifecycle })` from `@ludory/connect-vk`; no browser globals on import, copied SDK or new runtime dependency.
- `showFullscreen()` sends `VKWebAppShowNativeAds` with `{ ad_format: 'interstitial' }` and returns `{ shown: true }` only on the matched Bridge Promise's `{ result: true }`.
- `showRewarded()` sends the same method with `{ ad_format: 'reward' }` and returns `{ shown: true, rewarded: true }` only on its own matched successful Bridge response. A rejected, malformed or `result !== true` response never yields reward. A generic event or successful preflight cannot grant reward.
- `checkAvailability(kind)` sends `VKWebAppCheckNativeAds` and returns `{ available: boolean }` for a strict boolean response. It is an optional UI hint and **not** a prerequisite to showing an ad; availability and capability probes are not proof of a display.
- Reject a second show while another is in flight. Require an attached lifecycle; lease a scoped Runtime pause before requesting the ad. Preserve existing view-hide, visibility and manual pause owners. Release once on terminal success/failure; never resume an externally paused Runtime.
- A show with no terminal SDK response times out after `timeoutMs` (default 120000 ms; allowed range 1..300000 ms), releases its own pause and cannot later grant reward.
- A lifecycle detach invalidates the attachment token and cancels an in-flight ad; destroy cancels an in-flight ad and rejects future operations. Late, duplicated or reentrant responses cannot award a reward or resume a newer attachment.
- Errors use existing `VkConnectError` shape with `ADS_FAILED`, `ADS_NOT_SHOWN`, `CAPABILITY_UNAVAILABLE`. Do not report SDK results as signed, independently verified watch proof: VK Bridge's success response is a client-side SDK acknowledgement.

## Boundaries and gates

- Tests use an injected Bridge fake with observable `send` results and a real V2 lifecycle/Runtime-shaped host fixture. Cover success, false/malformed results, rejection, missing capability, concurrency, manual/view pause owners, detach/destroy and reentrancy.
- Run VK tests, all `npm test`, `npm run check` and applicable browser R6 checks on exact candidate HEAD. Node 22+ ESM. Do not change games, CEOS, Starter Kit, Core or Yandex Connect.
- No real VK SDK or platform/device result is claimed by a stub. No `Release PASS`, publication, moderation submission or merge into `main` without separate evidence and owner approval.

Official API provenance: https://github.com/VKCOM/vk-bridge/blob/master/packages/core/src/types/data.ts (request `ad_format: 'reward' | 'interstitial'`, `VKWebAppShowNativeAds` response `{ result: true }`, `VKWebAppCheckNativeAds` response `{ result: boolean }`); https://github.com/VKCOM/vk-bridge/blob/master/packages/core/README.md (`bridge.send` Promise).
