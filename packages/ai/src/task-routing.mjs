import { inspectNativeProject } from './source.mjs';
import { hasStudioCreationReceipt } from './executor.mjs';

const PREFERRED_ROUTES = Object.freeze({
  mechanics: 'codex',
  'episode-script': 'web-dev',
  'art-concept': 'web-dev',
  image: 'image-terra',
  'functional-check': 'codex',
});

/** A read-only dispatch explanation. Actual model adapters are separate slices. */
export function planTaskRoute(projectDir, options = {}, { discover } = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['taskKind', 'model'].includes(key))) {
    throw new Error('AI_ROUTING_INVALID_OPTIONS');
  }
  const { taskKind, model = 'auto' } = options;
  if (!Object.hasOwn(PREFERRED_ROUTES, taskKind)) throw new Error('AI_ROUTING_INVALID_TASK');
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
  return { ...base, status: 'NEEDS_USER_ACTION', selectedRoute: 'manual',
    reasonCode: 'AI_ROUTING_CAPABILITY_UNVERIFIED',
    nextAction: { kind: 'MANUAL_HANDOFF', executable: false } };
}
