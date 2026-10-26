import { inspectNativeProject } from './source.mjs';
import { hasStudioCreationReceipt } from './executor.mjs';
import { discoverTaskCapabilities, isVerifiedCapability, ownData } from './capabilities.mjs';

const PREFERRED_ROUTES = Object.freeze({
  mechanics: 'codex',
  'episode-script': 'web-dev',
  'art-concept': 'web-dev',
  image: 'codex-imagegen',
  'functional-check': 'codex',
});

const FAILURE_REASONS = new Set([
  'AI_ROUTING_HOST_UNVERIFIED', 'AI_ROUTING_TRANSPORT_UNVERIFIED',
  'AI_ROUTING_ENTITLEMENT_UNVERIFIED', 'AI_ROUTING_MODEL_UNVERIFIED',
  'AI_ROUTING_ROUTE_UNVERIFIED', 'AI_ROUTING_IMAGE_GEN_UNVERIFIED',
  'AI_ROUTING_CODEX_UNVERIFIED', 'AI_ROUTING_CODEX_PROBE_FAILED',
  'EXECUTOR_UNAVAILABLE', 'EXECUTOR_TIMEOUT', 'EXECUTOR_OUTPUT_LIMIT',
  'EXECUTOR_WRAPPER_UNSUPPORTED', 'EXECUTOR_SPAWN_FAILED',
]);

function capabilityReason(record, kind) {
  if (isVerifiedCapability(record, kind)) return 'AVAILABLE';
  try {
    const descriptor = record && typeof record === 'object' &&
      Object.getOwnPropertyDescriptor(record, 'reasonCode');
    if (descriptor && Object.hasOwn(descriptor, 'value') && FAILURE_REASONS.has(descriptor.value)) {
      return descriptor.value;
    }
  } catch { /* Treat malformed discovery as unverifiable. */ }
  return kind === 'codex' ? 'AI_ROUTING_CODEX_UNVERIFIED' : 'AI_ROUTING_HOST_UNVERIFIED';
}

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
  const preferredRoute = taskKind === 'image' && ['terra', 'sol'].includes(model)
    ? `image-${model}` : PREFERRED_ROUTES[taskKind];
  const base = { engine: 'ludory-ai', operation: 'route', project, taskKind,
    requestedModel: model, preferredRoute, writes: [], conflicts: [] };
  if (!hasStudioCreationReceipt(project)) {
    return { ...base, status: 'BLOCKED', selectedRoute: null,
      reasonCode: 'AI_ROUTING_STUDIO_GAME_REQUIRED',
      nextAction: { kind: 'STOP_FROZEN_GAME', executable: false } };
  }
  // Built-in $imagegen is a tool of the active Codex agent, not an image API endpoint.
  // No model selector is exposed. A read-only route preview cannot call that tool.
  if (taskKind === 'image' && model === 'auto') {
    return { ...base, status: 'NEEDS_AGENT_ACTION', selectedRoute: 'codex-imagegen',
      reasonCode: 'IMAGEGEN_SKILL_HANDOFF', modelObserved: null,
      modelSelection: 'provider-default', qualityPreference: 'highest-available',
      nextAction: { kind: 'CALL_IMAGEGEN_SKILL', executable: false } };
  }
  let capabilities;
  try { capabilities = discover(project, { taskKind, model }); }
  catch { capabilities = null; }
  // Snapshot each candidate once, without invoking inherited or accessor properties.
  const items = { codex: ownData(capabilities, 'codex'), webDev: ownData(capabilities, 'webDev'),
    imageTerra: ownData(capabilities, 'imageTerra'), imageSol: ownData(capabilities, 'imageSol') };
  const capabilityReasons = taskKind === 'image' ? {
    terra: capabilityReason(items.imageTerra, 'imageTerra'),
    sol: capabilityReason(items.imageSol, 'imageSol'),
  } : null;
  let route = null;
  if (preferredRoute === 'codex') {
    if (isVerifiedCapability(items.codex, 'codex')) route = 'codex';
  } else if (preferredRoute === 'web-dev') {
    if (isVerifiedCapability(items.webDev, 'webDev')) route = 'web-dev';
  } else if (taskKind === 'image') {
    if (model === 'terra' && isVerifiedCapability(items.imageTerra, 'imageTerra')) route = 'image-terra';
    else if (model === 'sol' && isVerifiedCapability(items.imageSol, 'imageSol')) route = 'image-sol';
  }
  if (route) {
    const capability = route === 'codex' ? items.codex : route === 'web-dev' ? items.webDev
      : route === 'image-terra' ? items.imageTerra : items.imageSol;
    const modelObserved = ownData(capability, 'modelObserved');
    return { ...base, status: 'READY', selectedRoute: route, reasonCode: 'AI_ROUTING_ROUTE_VERIFIED',
      ...(modelObserved && { modelObserved }),
      ...(capabilityReasons && { capabilityReasons }),
      nextAction: { kind: 'REVIEW_ROUTE', executable: false } };
  }
  const reasonCode = taskKind === 'image'
    ? 'AI_ROUTING_PINNED_MODEL_UNAVAILABLE'
    : preferredRoute === 'web-dev' ? 'AI_ROUTING_WEB_DEV_UNAVAILABLE' : 'AI_ROUTING_CODEX_UNAVAILABLE';
  const capabilityReasonCode = taskKind === 'image' ? capabilityReasons[model]
    : capabilityReason(items[preferredRoute === 'codex' ? 'codex' : 'webDev'],
      preferredRoute === 'codex' ? 'codex' : 'webDev');
  return { ...base, status: 'NEEDS_USER_ACTION', selectedRoute: 'manual', reasonCode,
    ...(capabilityReasons && { capabilityReasons }),
    ...(capabilityReasonCode && { capabilityReasonCode }),
    nextAction: { kind: 'MANUAL_HANDOFF', executable: false } };
}
