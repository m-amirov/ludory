import test from 'node:test';
import assert from 'node:assert/strict';
import { game } from './helpers/image-game.mjs';
import { planImageTask, executeImageTask } from '../src/image-tasks.mjs';
import { planTaskRoute } from '../src/task-routing.mjs';
import { readNativeRun } from '../src/store.mjs';

test('unselected image model creates a source-bound Codex ImageGen skill handoff without a transport', async t => {
  const { project, run } = game(t);
  let called = false;
  const plan = await planImageTask(project, { run, brief: 'image-brief.md' }, {
    discover: async () => { called = true; throw new Error('must not probe API or paid host'); },
  });
  assert.equal(called, false);
  assert.equal(plan.status, 'NEEDS_AGENT_ACTION');
  assert.equal(plan.preferredRoute, 'codex-imagegen');
  assert.equal(plan.selectedRoute, 'codex-imagegen');
  assert.equal(plan.nextAction.kind, 'SPAWN_IMAGE_AGENT');
  assert.equal(plan.manualPacket.skill, '$imagegen');
  assert.equal(plan.manualPacket.mode, 'built-in');
  assert.equal(plan.manualPacket.modelSelection, 'provider-default');
  assert.equal(plan.manualPacket.qualityPreference, 'highest-available');
  assert.deepEqual(plan.manualPacket.executionContract, {
    schemaVersion: 1,
    authority: 'codex-native-session',
    ceosChallenge: 'NOT_REQUIRED_BY_LUDORY',
    externalMandatoryPolicy: 'STOP_ON_CONFLICT',
    toolInvocation: 'AGENT_OBSERVED_REQUIRED',
    importProvenance: 'USER_DECLARED',
  });
  assert.deepEqual(plan.manualPacket.agent, {
    role: 'image-generator', executor: 'codex-subagent', model: 'inherit-parent',
    requiredSkill: '$imagegen',
  });
  assert.match(plan.manualPacket.steps[0], /separate Codex subagent/i);
  assert.match(plan.manualPacket.steps[1], /subagent.*\$imagegen/i);
  assert.match(plan.manualPacket.prompt, /lighthouse over a winter sea/);
  assert.equal(plan.manualPacket.brief.sha256, plan.brief.sha256);
  assert.equal(readNativeRun(project, run).events.length, 0);
  const deferred = await executeImageTask(plan, { apply: true, host: { generate() {
    throw new Error('must not invoke programmatic image provider');
  } } });
  assert.equal(deferred.status, 'NEEDS_AGENT_ACTION');
  assert.equal(readNativeRun(project, run).events.length, 0);
});

test('routing advertises the built-in ImageGen handoff without claiming model selection or an automatic call', t => {
  const { project } = game(t);
  let called = false;
  const result = planTaskRoute(project, { taskKind: 'image' }, { discover: () => { called = true; throw new Error('no host'); } });
  assert.equal(called, false);
  assert.equal(result.status, 'NEEDS_AGENT_ACTION');
  assert.equal(result.selectedRoute, 'codex-imagegen');
  assert.equal(result.nextAction.kind, 'SPAWN_IMAGE_AGENT');
  assert.equal(result.nextAction.agentRole, 'image-generator');
  assert.equal(result.nextAction.model, 'inherit-parent');
  assert.equal(result.modelObserved, null);
  assert.equal(result.modelSelection, 'provider-default');
  assert.equal(result.qualityPreference, 'highest-available');
});

test('built-in ImageGen has no exposed model selector; API-only model pins are rejected', async t => {
  const { project, run } = game(t);
  await assert.rejects(planImageTask(project, { run, brief: 'image-brief.md', model: 'sunburst' }), /IMAGE_TASK_INVALID/);
  assert.throws(() => planTaskRoute(project, { taskKind: 'image', model: 'flare' }), /AI_ROUTING_INVALID_MODEL/);
});
