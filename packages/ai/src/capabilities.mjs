import { checkCodexAvailable } from './executor.mjs';

const unavailable = reasonCode => ({ available: false, reasonCode });
const checkCodexVersion = plan => checkCodexAvailable(plan, { timeoutMs: 5_000 });
const validModelId = value => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value);

function normalizeHost(record, kind) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      record.available !== true || record.transportVerified !== true ||
      record.entitlementVerified !== true || !validModelId(record.modelObserved)) {
    return unavailable('AI_ROUTING_HOST_UNVERIFIED');
  }
  if (kind === 'webDev') {
    if (record.routeObserved !== 'web-dev') return unavailable('AI_ROUTING_HOST_UNVERIFIED');
  } else if (record.imageGenCallable !== true ||
      !(kind === 'imageTerra' ? /^gpt-\d+(?:\.\d+)?-terra$/i
        : /^gpt-\d+(?:\.\d+)?-sol$/i).test(record.modelObserved)) {
    return unavailable('AI_ROUTING_IMAGE_GEN_UNVERIFIED');
  }
  return { available: true, reasonCode: 'AVAILABLE', modelObserved: record.modelObserved,
    transportVerified: true, entitlementVerified: true,
    ...(kind === 'webDev' ? { routeObserved: 'web-dev' } : { imageGenCallable: true }) };
}

/** Validate even injected preflight results before granting a ready route. */
export function isVerifiedCapability(record, kind) {
  if (kind === 'codex') return record?.available === true && record?.reasonCode === 'AVAILABLE';
  return record?.reasonCode === 'AVAILABLE' && normalizeHost(record, kind).available === true;
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
      codex = check?.ok === true ? { available: true, reasonCode: 'AVAILABLE' }
        : unavailable(check?.code ?? 'AI_ROUTING_CODEX_UNVERIFIED');
    } catch { codex = unavailable('AI_ROUTING_CODEX_PROBE_FAILED'); }
  }
  let host = null;
  try { if (typeof hostProbe === 'function') host = hostProbe(project); }
  catch { host = null; }
  const candidates = host && typeof host === 'object' && !Array.isArray(host) ? host : {};
  return { codex, webDev: normalizeHost(candidates.webDev, 'webDev'),
    imageTerra: normalizeHost(candidates.imageTerra, 'imageTerra'),
    imageSol: normalizeHost(candidates.imageSol, 'imageSol') };
}
