import { checkCodexAvailable } from './executor.mjs';

const unavailable = reasonCode => ({ available: false, reasonCode });
const checkCodexVersion = plan => checkCodexAvailable(plan, { timeoutMs: 5_000 });
const validModelId = value => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value);

function isRecord(value) {
  if (!value || typeof value !== 'object') return false;
  try { return !Array.isArray(value); }
  catch { return false; }
}

/** Read only a direct data property; inherited values and getters are not attestation. */
export function ownData(record, key) {
  if (!isRecord(record)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}

function normalizeHost(record, kind) {
  if (kind === 'webDev' && isRecord(record) && ownData(record, 'browserObservationV2Available') === true) {
    const preflight = ownData(record, 'preflight');
    if (ownData(record, 'available') !== true || ownData(record, 'reasonCode') !== 'AVAILABLE' ||
        ownData(record, 'routeAvailable') !== 'web-dev' || ownData(record, 'modelRouteAvailable') !== 'chatgpt-web/gpt-6-sol' ||
        ownData(record, 'reasoningRequired') !== 'high' || !isRecord(preflight) ||
        ownData(preflight, 'authenticated') !== true || ownData(preflight, 'newChat') !== true ||
        ownData(preflight, 'solAvailable') !== true ||
        typeof ownData(preflight, 'url') !== 'string' || !ownData(preflight, 'url')) {
      return unavailable('AI_ROUTING_WEB_OBSERVATION_V2_UNVERIFIED');
    }
    return { available: true, reasonCode: 'AVAILABLE', routeAvailable: 'web-dev',
      modelRouteAvailable: 'chatgpt-web/gpt-6-sol', browserObservationV2Available: true,
      reasoningRequired: 'high', preflight, inspect: ownData(record, 'inspect') };
  }
  const modelObserved = ownData(record, 'modelObserved');
  const available = ownData(record, 'available');
  if (!isRecord(record) || (available !== true && available !== false)) {
    return unavailable('AI_ROUTING_HOST_UNVERIFIED');
  }
  if (ownData(record, 'transportVerified') !== true) return unavailable('AI_ROUTING_TRANSPORT_UNVERIFIED');
  if (ownData(record, 'entitlementVerified') !== true) return unavailable('AI_ROUTING_ENTITLEMENT_UNVERIFIED');
  if (!validModelId(modelObserved)) return unavailable('AI_ROUTING_MODEL_UNVERIFIED');
  if (kind === 'webDev') {
    if (ownData(record, 'routeObserved') !== 'web-dev') return unavailable('AI_ROUTING_ROUTE_UNVERIFIED');
    // The owner explicitly selected GPT-6 Sol (Web) for every Web DEV agent task.
    if (modelObserved !== 'gpt-6-sol') return unavailable('AI_ROUTING_MODEL_UNVERIFIED');
  } else {
    if (ownData(record, 'imageGenCallable') !== true) return unavailable('AI_ROUTING_IMAGE_GEN_UNVERIFIED');
    if (!(kind === 'imageTerra' ? /^gpt-\d+(?:\.\d+)?-terra$/i
      : /^gpt-\d+(?:\.\d+)?-sol$/i).test(modelObserved)) {
      return unavailable('AI_ROUTING_MODEL_UNVERIFIED');
    }
  }
  if (!available) return unavailable('AI_ROUTING_HOST_UNVERIFIED');
  return { available: true, reasonCode: 'AVAILABLE', modelObserved,
    transportVerified: true, entitlementVerified: true,
    ...(kind === 'webDev' ? { routeObserved: 'web-dev' } : { imageGenCallable: true }) };
}

/** Validate even injected preflight results before granting a ready route. */
export function isVerifiedCapability(record, kind) {
  if (kind === 'codex') return ownData(record, 'available') === true &&
    ownData(record, 'reasonCode') === 'AVAILABLE';
  return ownData(record, 'reasonCode') === 'AVAILABLE' && normalizeHost(record, kind).available === true;
}

/** Read-only capability preflight. No DEV/Image Gen adapter is installed in this slice. */
export function discoverTaskCapabilities(project, { taskKind, checkCodex = checkCodexVersion,
  hostProbe = null } = {}) {
  let codex;
  if (taskKind && !['mechanics', 'functional-check'].includes(taskKind)) {
    codex = unavailable('AI_ROUTING_CODEX_NOT_REQUESTED');
  } else {
    try {
      const check = checkCodex({ project });
      codex = ownData(check, 'ok') === true ? { available: true, reasonCode: 'AVAILABLE' }
        : unavailable(ownData(check, 'code') ?? 'AI_ROUTING_CODEX_UNVERIFIED');
    } catch { codex = unavailable('AI_ROUTING_CODEX_PROBE_FAILED'); }
  }
  let host = null;
  try { if (typeof hostProbe === 'function') host = hostProbe(project); }
  catch { host = null; }
  const candidates = isRecord(host) ? host : {};
  return { codex, webDev: normalizeHost(ownData(candidates, 'webDev'), 'webDev'),
    imageTerra: normalizeHost(ownData(candidates, 'imageTerra'), 'imageTerra'),
    imageSol: normalizeHost(ownData(candidates, 'imageSol'), 'imageSol') };
}
