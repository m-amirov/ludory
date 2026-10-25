import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planTaskRoute } from '../src/task-routing.mjs';

function freshStudioGame(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-routing-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, 'ludory.project.json'), `${JSON.stringify({
    schemaVersion: 1, id: 'route-game', version: '0.1.0',
    title: { en: 'Route Game' }, engine: 'web', targets: ['vk-games'],
  })}\n`);
  fs.writeFileSync(path.join(project, 'ludory.studio.json'), `${JSON.stringify({
    schemaVersion: 1, profile: { id: 'web-game', version: '1.0.0' },
    template: { id: 'web-basic', version: '1.0.0' },
    files: { 'ludory.project.json': 'a'.repeat(64) },
  })}\n`);
  return project;
}

test('the five task kinds preserve their selected preferred executors in read-only previews', t => {
  const project = freshStudioGame(t);
  const expected = [
    ['mechanics', 'codex'], ['episode-script', 'web-dev'],
    ['art-concept', 'web-dev'], ['image', 'image-terra'],
    ['functional-check', 'codex'],
  ];
  for (const [taskKind, preferredRoute] of expected) {
    const result = planTaskRoute(project, { taskKind });
    assert.equal(result.taskKind, taskKind);
    assert.equal(result.preferredRoute, preferredRoute);
    assert.equal(result.status, 'NEEDS_USER_ACTION');
    assert.equal(result.selectedRoute, 'manual');
    assert.equal(result.engine, 'ludory-ai');
    assert.deepEqual(result.writes, []);
  }
  assert.deepEqual(fs.readdirSync(project).sort(), ['ludory.project.json', 'ludory.studio.json']);
});

test('the router rejects arbitrary task kinds, non-image model pins and unrecognized options', t => {
  const project = freshStudioGame(t);
  assert.throws(() => planTaskRoute(project, { taskKind: 'unknown' }), /AI_ROUTING_INVALID_TASK/);
  assert.throws(() => planTaskRoute(project, { taskKind: '' }), /AI_ROUTING_INVALID_TASK/);
  assert.throws(() => planTaskRoute(project, { taskKind: 'mechanics', model: 'terra' }), /AI_ROUTING_INVALID_MODEL/);
  assert.throws(() => planTaskRoute(project, { taskKind: 'image', model: 'web-dev' }), /AI_ROUTING_INVALID_MODEL/);
  assert.throws(() => planTaskRoute(project, { taskKind: 'image', unexpected: true }), /AI_ROUTING_INVALID_OPTIONS/);
  assert.throws(() => planTaskRoute(project, null), /AI_ROUTING_INVALID_OPTIONS/);
  assert.equal(planTaskRoute(project, { taskKind: 'image', model: 'sol' }).requestedModel, 'sol');
});

test('frozen projects remain blocked without invoking any external capability discovery', t => {
  const project = freshStudioGame(t);
  fs.unlinkSync(path.join(project, 'ludory.studio.json'));
  const result = planTaskRoute(project, { taskKind: 'mechanics' }, {
    discover: () => { throw new Error('DISCOVERY_MUST_NOT_RUN'); },
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reasonCode, 'AI_ROUTING_STUDIO_GAME_REQUIRED');
  assert.equal(result.selectedRoute, null);
  assert.deepEqual(result.writes, []);
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});
