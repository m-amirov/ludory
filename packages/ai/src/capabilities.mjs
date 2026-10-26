import { checkCodexAvailable } from './executor.mjs';

const unavailable = reasonCode => ({ available: false, reasonCode });
const checkCodexVersion = plan => checkCodexAvailable(plan, { timeoutMs: 5_000 });
const validModelId = value => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value);
const GPT_IMAGE_IDS = new Set(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);

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

function normalizeGptImage(record) {
  if (ownData(record, 'available') !== true) return unavailable('AI_ROUTING_HOST_UNVERIFIED');
  if (ownData(record, 'provider') !== 'openai' ||
      ownData(record, 'routeObserved') !== 'gpt-image' ||
      ownData(record, 'transportConfigured') !== true ||
      ownData(record, 'paidAuthorized') !== true ||
      ownData(record, 'imageGenCallable') !== true ||
      !GPT_IMAGE_IDS.has(ownData(record, 'modelRequested')) ||
      ownData(record, 'modelObserved') !== null) {
    return unavailable('AI_ROUTING_IMAGE_GEN_UNVERIFIED');
  }
  return { available: true, reasonCode: 'AVAILABLE', provider: 'openai',
    routeObserved: 'gpt-image', transportConfigured: true, paidAuthorized: true,
    imageGenCallable: true, modelRequested: ownData(record, 'modelRequested'), modelObserved: null };
}

/** Validate even injected preflight results before granting a ready route. */
export function isVerifiedCapability(record, kind) {
  if (kind === 'codex') return ownData(record, 'available') === true &&
    ownData(record, 'reasonCode') === 'AVAILABLE';
  if (kind === 'imageGpt') return ownData(record, 'reasonCode') === 'AVAILABLE' &&
    normalizeGptImage(record).available === true;
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
    imageGpt: normalizeGptImage(ownData(candidates, 'imageGpt')),
    imageTerra: normalizeHost(ownData(candidates, 'imageTerra'), 'imageTerra'),
    imageSol: normalizeHost(ownData(candidates, 'imageSol'), 'imageSol') };
}
