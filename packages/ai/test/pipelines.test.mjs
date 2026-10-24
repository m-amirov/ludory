import test from 'node:test';
import assert from 'node:assert/strict';
import { getPipeline, nextStage, checkTransition } from '../src/pipelines.mjs';

test('native pipelines preserve the CEOS 0.5.40 stage order without importing its runtime', () => {
  assert.deepEqual(getPipeline('audit-repair-loop').stages.map(x => x.id), [
    'EVIDENCE_COLLECTED', 'AUDITED', 'DEFECTS_CONFIRMED', 'REPAIRING', 'VERIFIED', 'REAUDITED',
  ]);
  assert.deepEqual(getPipeline('production-art').stages.map(x => x.id), [
    'INVENTORIED', 'CANON_READY', 'GENERATING', 'INTEGRATED', 'VISUAL_VERIFIED', 'REAUDITED',
  ]);
  assert.equal(getPipeline('production-art').maxCyclesDefault, 3);
  assert.equal(getPipeline('audit-repair-loop').version, 1);
  assert.equal(nextStage('audit-repair-loop', 'AUDITED'), 'DEFECTS_CONFIRMED');
  assert.equal(nextStage('audit-repair-loop', 'REAUDITED'), null);
  assert.throws(() => getPipeline('arbitrary-process'), /Unsupported workflow pipeline/);
  assert.throws(() => nextStage('production-art', 'AUDITED'), /Unknown stage/);
});

test('checkpoint transitions require evidence and cannot synthesize terminal PASS', () => {
  assert.deepEqual(checkTransition('audit-repair-loop', 'AUDITED', 'CONTINUE', { hasEvidence: false }), {
    ok: false, code: 'EVIDENCE_REQUIRED',
  });
  assert.deepEqual(checkTransition('audit-repair-loop', 'AUDITED', 'CONTINUE', { hasEvidence: true }), {
    ok: true, nextStage: 'DEFECTS_CONFIRMED', terminal: null,
  });
  assert.deepEqual(checkTransition('audit-repair-loop', 'REAUDITED', 'PASS', { hasEvidence: true, hasPositiveReleaseEvidence: true }), {
    ok: false, code: 'EVIDENCE_VERIFIER_NOT_READY',
  });
  assert.deepEqual(checkTransition('audit-repair-loop', 'REAUDITED', 'CONTINUE', { hasEvidence: true }), {
    ok: false, code: 'EXPLICIT_FINAL_OUTCOME_REQUIRED',
  });
  assert.deepEqual(checkTransition('audit-repair-loop', 'AUDITED', 'FAIL', { hasEvidence: true }), {
    ok: false, code: 'INVALID_FAILURE_STAGE',
  });
  assert.deepEqual(checkTransition('audit-repair-loop', 'VERIFIED', 'FAIL', { hasEvidence: true }), {
    ok: true, nextStage: null, terminal: 'FAIL',
  });
  assert.deepEqual(checkTransition('production-art', 'CANON_READY', 'BLOCKED', { hasEvidence: false }), {
    ok: true, nextStage: null, terminal: 'BLOCKED',
  });
  assert.deepEqual(checkTransition('production-art', 'CANON_READY', 'BOGUS', { hasEvidence: true }), {
    ok: false, code: 'INVALID_OUTCOME',
  });
});
