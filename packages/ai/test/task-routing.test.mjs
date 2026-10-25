import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planTaskRoute } from '../src/task-routing.mjs';
import { discoverTaskCapabilities } from '../src/capabilities.mjs';

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
    const result = planTaskRoute(project, { taskKind }, { discover: () => ({}) });
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
  assert.throws(() => planTaskRoute(project, { taskKind: ['mechanics'] }), /AI_ROUTING_INVALID_TASK/);
  assert.throws(() => planTaskRoute(project, { taskKind: new String('mechanics') }), /AI_ROUTING_INVALID_TASK/);
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

const verifiedDev = { available: true, transportVerified: true,
  entitlementVerified: true, modelObserved: 'gpt-6-sol', routeObserved: 'web-dev' };
const verifiedTerra = { available: true, transportVerified: true,
  entitlementVerified: true, modelObserved: 'gpt-5.6-terra', imageGenCallable: true };
const verifiedSol = { available: true, transportVerified: true,
  entitlementVerified: true, modelObserved: 'gpt-6-sol', imageGenCallable: true };

test('Codex preflight checks only availability and can make mechanics route ready', t => {
  const project = freshStudioGame(t);
  const capabilities = discoverTaskCapabilities(project, {
    checkCodex: plan => {
      assert.equal(plan.project, project);
      assert.equal(Object.hasOwn(plan, 'input'), false);
      return { ok: true, code: 'AVAILABLE' };
    },
  });
  assert.deepEqual(capabilities.codex, { available: true, reasonCode: 'AVAILABLE' });
  assert.equal(capabilities.webDev.available, false);
  assert.equal(capabilities.imageTerra.available, false);
  assert.equal(planTaskRoute(project, { taskKind: 'mechanics' }, { discover: () => capabilities }).status, 'READY');
  assert.equal(planTaskRoute(project, { taskKind: 'functional-check' },
    { discover: () => capabilities }).selectedRoute, 'codex');
  assert.equal(fs.existsSync(path.join(project, '.ludory')), false);
});

test('missing Codex and absent Web DEV host evidence produce honest manual handoff', t => {
  const project = freshStudioGame(t);
  const capabilities = discoverTaskCapabilities(project, { checkCodex: () => ({ ok: false, code: 'EXECUTOR_UNAVAILABLE' }) });
  for (const taskKind of ['mechanics', 'episode-script', 'art-concept', 'functional-check']) {
    const result = planTaskRoute(project, { taskKind }, { discover: () => capabilities });
    assert.equal(result.status, 'NEEDS_USER_ACTION');
    assert.equal(result.selectedRoute, 'manual');
    assert.equal(result.nextAction.kind, 'MANUAL_HANDOFF');
  }
});

test('DEV requires a verified transport, entitlement, and real selected route', t => {
  const project = freshStudioGame(t);
  const checked = discoverTaskCapabilities(project, { checkCodex: () => ({ ok: false }),
    hostProbe: () => ({ webDev: verifiedDev }) });
  assert.equal(planTaskRoute(project, { taskKind: 'episode-script' }, { discover: () => checked }).selectedRoute, 'web-dev');
  assert.equal(planTaskRoute(project, { taskKind: 'art-concept' }, { discover: () => checked }).status, 'READY');
  const forged = discoverTaskCapabilities(project, { checkCodex: () => ({ ok: false }),
    hostProbe: () => ({ webDev: { ...verifiedDev, routeObserved: 'general-web' } }) });
  assert.equal(planTaskRoute(project, { taskKind: 'episode-script' }, { discover: () => forged }).status, 'NEEDS_USER_ACTION');
});

test('automatic image routing selects Terra before SOL, then SOL before manual', t => {
  const project = freshStudioGame(t);
  const capabilitiesFor = host => discoverTaskCapabilities(project, { checkCodex: () => ({ ok: false }),
    hostProbe: () => host });
  const both = planTaskRoute(project, { taskKind: 'image' },
    { discover: () => capabilitiesFor({ imageTerra: verifiedTerra, imageSol: verifiedSol }) });
  assert.equal(both.status, 'READY');
  assert.equal(both.selectedRoute, 'image-terra');
  assert.equal(both.modelObserved, 'gpt-5.6-terra');
  const onlySol = planTaskRoute(project, { taskKind: 'image' },
    { discover: () => capabilitiesFor({ imageSol: verifiedSol }) });
  assert.equal(onlySol.status, 'READY');
  assert.equal(onlySol.selectedRoute, 'image-sol');
  assert.equal(onlySol.modelObserved, 'gpt-6-sol');
  const absent = planTaskRoute(project, { taskKind: 'image' },
    { discover: () => capabilitiesFor({}) });
  assert.equal(absent.status, 'NEEDS_USER_ACTION');
  assert.equal(absent.selectedRoute, 'manual');
  assert.equal(Object.hasOwn(absent, 'modelObserved'), false);
});

test('pinned image producer never silently changes despite another model being available', t => {
  const project = freshStudioGame(t);
  const capabilities = discoverTaskCapabilities(project, { checkCodex: () => ({ ok: false }),
    hostProbe: () => ({ imageSol: verifiedSol }) });
  const pinnedTerra = planTaskRoute(project, { taskKind: 'image', model: 'terra' },
    { discover: () => capabilities });
  assert.equal(pinnedTerra.selectedRoute, 'manual');
  assert.equal(pinnedTerra.status, 'NEEDS_USER_ACTION');
  assert.equal(pinnedTerra.reasonCode, 'AI_ROUTING_PINNED_MODEL_UNAVAILABLE');
  const pinnedSol = planTaskRoute(project, { taskKind: 'image', model: 'sol' },
    { discover: () => capabilities });
  assert.equal(pinnedSol.selectedRoute, 'image-sol');
  assert.equal(pinnedSol.status, 'READY');
});

test('capability discovery fails closed on malformed evidence and throwing probes', t => {
  const project = freshStudioGame(t);
  const invalidRecords = [
    { imageTerra: { ...verifiedTerra, transportVerified: false } },
    { imageTerra: { ...verifiedTerra, imageGenCallable: 'true' } },
    { imageTerra: { ...verifiedTerra, modelObserved: 'not-terra-model' } },
    { imageTerra: { ...verifiedTerra, modelObserved: 'not-terra' } },
    { imageTerra: { ...verifiedTerra, modelObserved: 'terra' } },
    { imageTerra: { ...verifiedTerra, entitlementVerified: undefined } },
    { imageSol: { ...verifiedSol, modelObserved: 'gpt-5.6-terra' } },
    { imageSol: { ...verifiedSol, modelObserved: 'unapproved-provider-sol' } },
    { imageSol: { ...verifiedSol, modelObserved: 'sol' } },
  ];
  for (const record of invalidRecords) {
    const capabilities = discoverTaskCapabilities(project, { checkCodex: () => ({ ok: false }),
      hostProbe: () => record });
    assert.equal(planTaskRoute(project, { taskKind: 'image' }, { discover: () => capabilities }).status, 'NEEDS_USER_ACTION');
  }
  const failure = discoverTaskCapabilities(project, {
    checkCodex: () => { throw new Error('codex checker offline'); },
    hostProbe: () => { throw new Error('host offline'); },
  });
  assert.equal(failure.codex.available, false);
  assert.equal(failure.webDev.available, false);
  assert.equal(failure.imageTerra.available, false);
});

test('a direct planner discovery hook cannot elevate bare availability claims into READY', t => {
  const project = freshStudioGame(t);
  const unverified = { codex: { available: true }, webDev: { available: true },
    imageTerra: { available: true, modelObserved: 'terra' },
    imageSol: { available: true, modelObserved: 'sol' } };
  for (const taskKind of ['mechanics', 'episode-script', 'art-concept', 'image', 'functional-check']) {
    assert.equal(planTaskRoute(project, { taskKind }, { discover: () => unverified }).status,
      'NEEDS_USER_ACTION');
  }
});
