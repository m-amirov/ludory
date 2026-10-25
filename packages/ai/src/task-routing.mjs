import { inspectNativeProject } from './source.mjs';
import { hasStudioCreationReceipt } from './executor.mjs';
import { discoverTaskCapabilities, isVerifiedCapability } from './capabilities.mjs';

const PREFERRED_ROUTES = Object.freeze({
  mechanics: 'codex',
  'episode-script': 'web-dev',
  'art-concept': 'web-dev',
  image: 'image-terra',
  'functional-check': 'codex',
});

/** A read-only dispatch explanation. Actual model adapters are separate slices. */
export function planTaskRoute(projectDir, options = {}, { discover = discoverTaskCapabilities } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['taskKind', 'model'].includes(key))) {
    throw new Error('AI_ROUTING_INVALID_OPTIONS');
  }
  const { taskKind, model = 'auto' } = options;
  if (typeof taskKind !== 'string' || !Object.hasOwn(PREFERRED_ROUTES, taskKind)) {
    throw new Error('AI_ROUTING_INVALID_TASK');
  }
  if (typeof model !== 'string' ||
      (taskKind === 'image' ? !['auto', 'terra', 'sol'].includes(model) : model !== 'auto')) {
    throw new Error('AI_ROUTING_INVALID_MODEL');
  }
  const source = inspectNativeProject(projectDir);
  const project = source.project;
  const preferredRoute = taskKind === 'image' && model === 'sol' ? 'image-sol' : PREFERRED_ROUTES[taskKind];
  const base = { engine: 'ludory-ai', operation: 'route', project, taskKind,
    requestedModel: model, preferredRoute, writes: [], conflicts: [] };
  if (!hasStudioCreationReceipt(project)) {
    return { ...base, status: 'BLOCKED', selectedRoute: null,
      reasonCode: 'AI_ROUTING_STUDIO_GAME_REQUIRED',
      nextAction: { kind: 'STOP_FROZEN_GAME', executable: false } };
  }
  let capabilities;
  try { capabilities = discover(project); }
  catch { capabilities = null; }
  const items = capabilities && typeof capabilities === 'object' ? capabilities : {};
  let route = null;
  if (preferredRoute === 'codex') {
    if (isVerifiedCapability(items.codex, 'codex')) route = 'codex';
  } else if (preferredRoute === 'web-dev') {
    if (isVerifiedCapability(items.webDev, 'webDev')) route = 'web-dev';
  } else if (taskKind === 'image') {
    if (model !== 'sol' && isVerifiedCapability(items.imageTerra, 'imageTerra')) route = 'image-terra';
    else if (model !== 'terra' && isVerifiedCapability(items.imageSol, 'imageSol')) route = 'image-sol';
  }
  if (route) {
    const capability = route === 'codex' ? items.codex : route === 'web-dev' ? items.webDev
      : route === 'image-terra' ? items.imageTerra : items.imageSol;
    return { ...base, status: 'READY', selectedRoute: route, reasonCode: 'AI_ROUTING_ROUTE_VERIFIED',
      ...(capability.modelObserved && { modelObserved: capability.modelObserved }),
      nextAction: { kind: 'REVIEW_ROUTE', executable: false } };
  }
  const reasonCode = taskKind === 'image'
    ? model === 'auto' ? 'AI_ROUTING_IMAGE_GEN_UNAVAILABLE' : 'AI_ROUTING_PINNED_MODEL_UNAVAILABLE'
    : preferredRoute === 'web-dev' ? 'AI_ROUTING_WEB_DEV_UNAVAILABLE' : 'AI_ROUTING_CODEX_UNAVAILABLE';
  return { ...base, status: 'NEEDS_USER_ACTION', selectedRoute: 'manual', reasonCode,
    nextAction: { kind: 'MANUAL_HANDOFF', executable: false } };
}
