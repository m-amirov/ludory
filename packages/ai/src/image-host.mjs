import { ownData } from './capabilities.mjs';

const unavailable = reasonCode => ({ available: false, reasonCode });

/** A capability is meaningful only as an observation from a trusted in-process host adapter. */
export function validateImageCapability(record, model) {
  if (ownData(record, 'available') !== true ||
      ownData(record, 'transportVerified') !== true ||
      ownData(record, 'entitlementVerified') !== true ||
      ownData(record, 'imageGenCallable') !== true ||
      ownData(record, 'routeObserved') !== 'image-gen' ||
      ownData(record, 'attestationScope') !== 'live-execution-context' ||
      !(model === 'terra' ? /^gpt-\d+(?:\.\d+)?-terra$/i : /^gpt-\d+(?:\.\d+)?-sol$/i)
        .test(ownData(record, 'modelObserved') ?? '')) {
    return unavailable('IMAGE_HOST_CAPABILITY_UNVERIFIED');
  }
  return { available: true, reasonCode: 'AVAILABLE', transportVerified: true,
    entitlementVerified: true, imageGenCallable: true, routeObserved: 'image-gen',
    attestationScope: 'live-execution-context', modelObserved: ownData(record, 'modelObserved') };
}

/** No default provider: the ChatGPT Image Gen tool does not attest Terra/SOL. */
export async function discoverImageHost(host) {
  const missing = { imageTerra: unavailable('IMAGE_HOST_UNAVAILABLE'),
    imageSol: unavailable('IMAGE_HOST_UNAVAILABLE') };
  if (!host || typeof ownData(host, 'probe') !== 'function' ||
      typeof ownData(host, 'generate') !== 'function') return missing;
  let observed;
  try { observed = await host.probe(); }
  catch { return missing; }
  return { imageTerra: validateImageCapability(ownData(observed, 'terra'), 'terra'),
    imageSol: validateImageCapability(ownData(observed, 'sol'), 'sol') };
}
