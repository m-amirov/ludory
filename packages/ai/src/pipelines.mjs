const descriptions = {
  'audit-repair-loop': [
    'EVIDENCE_COLLECTED', 'AUDITED', 'DEFECTS_CONFIRMED', 'REPAIRING', 'VERIFIED', 'REAUDITED',
  ],
  'production-art': [
    'INVENTORIED', 'CANON_READY', 'GENERATING', 'INTEGRATED', 'VISUAL_VERIFIED', 'REAUDITED',
  ],
};

const PIPELINES = Object.freeze(Object.fromEntries(Object.entries(descriptions).map(([id, ids]) => [id,
  Object.freeze({ id, version: 1, maxCyclesDefault: 3,
    stages: Object.freeze(ids.map(stage => Object.freeze({
      id: stage, requiresArtifacts: true, finalReview: stage === 'REAUDITED',
    }))),
  }),
])));

export function getPipeline(id) {
  const pipeline = PIPELINES[id];
  if (!Object.hasOwn(PIPELINES, id) || !pipeline) throw new Error(`Unsupported workflow pipeline: ${id}`);
  return pipeline;
}

export function nextStage(pipelineId, currentStage) {
  const pipeline = getPipeline(pipelineId);
  const index = pipeline.stages.findIndex(x => x.id === currentStage);
  if (index < 0) throw new Error(`Unknown stage: ${currentStage}`);
  return pipeline.stages[index + 1]?.id ?? null;
}

/** No Release verifier is installed yet: a boolean claim can never grant PASS. */
export function checkTransition(pipelineId, stage, outcome, { hasEvidence = false } = {}) {
  getPipeline(pipelineId);
  const after = nextStage(pipelineId, stage);
  if (!['CONTINUE', 'PASS', 'FAIL', 'BLOCKED', 'ESCALATE'].includes(outcome)) {
    return { ok: false, code: 'INVALID_OUTCOME' };
  }
  if (outcome === 'PASS') return { ok: false, code: 'EVIDENCE_VERIFIER_NOT_READY' };
  if (outcome === 'BLOCKED' || outcome === 'ESCALATE') {
    return { ok: true, nextStage: null, terminal: outcome };
  }
  if (!hasEvidence) return { ok: false, code: 'EVIDENCE_REQUIRED' };
  if (outcome === 'FAIL') {
    if (!['VERIFIED', 'VISUAL_VERIFIED', 'REAUDITED'].includes(stage)) {
      return { ok: false, code: 'INVALID_FAILURE_STAGE' };
    }
    return { ok: true, nextStage: null, terminal: 'FAIL' };
  }
  if (stage === 'REAUDITED') return { ok: false, code: 'EXPLICIT_FINAL_OUTCOME_REQUIRED' };
  return { ok: true, nextStage: after, terminal: null };
}
