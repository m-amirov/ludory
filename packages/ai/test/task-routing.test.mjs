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
    ['art-concept', 'web-dev'], ['image', 'codex-imagegen'],
    ['functional-check', 'codex'],
  ];
  for (const [taskKind, preferredRoute] of expected) {
    const result = planTaskRoute(project, { taskKind }, { discover: () => ({}) });
    assert.equal(result.taskKind, taskKind);
    assert.equal(result.preferredRoute, preferredRoute);
    assert.equal(result.status, taskKind === 'image' ? 'NEEDS_AGENT_ACTION' : 'NEEDS_USER_ACTION');
    assert.equal(result.selectedRoute, taskKind === 'image' ? 'codex-imagegen' : 'manual');
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

test('Web DEV v2 route verifies browser preflight but never promises unsupported text-only turns', t => {
  const project = freshStudioGame(t);
  const v2 = { available: true, reasonCode: 'AVAILABLE', routeAvailable: 'web-dev',
    modelRouteAvailable: 'chatgpt-web/gpt-6-sol', browserObservationV2Available: true,
    reasoningRequired: 'high', preflight: { authenticated: true, newChat: true,
      url: 'https://chatgpt.com/', solAvailable: true } };
  for (const taskKind of ['episode-script', 'art-concept']) {
    const preview = planTaskRoute(project, { taskKind }, {
      discover: () => ({ webDev: v2 }),
    });
    assert.equal(preview.status, 'NEEDS_USER_ACTION');
    assert.equal(preview.reasonCode, 'AI_ROUTING_WEB_TEXT_V2_UNSUPPORTED');
  }
  for (const [label, preflight] of [
    ['no browser preflight', {}],
    ['unauthenticated', { ...v2.preflight, authenticated: false }],
    ['reused chat', { ...v2.preflight, newChat: false }],
    ['missing Sol entitlement', { ...v2.preflight, solAvailable: false }],
    ['missing browser URL', { ...v2.preflight, url: '' }],
    ['accessor-supplied authentication', Object.defineProperty({ ...v2.preflight },
      'authenticated', { get() { return true; }, enumerable: true })],
  ]) {
    const cap = discoverTaskCapabilities(project, { taskKind: 'episode-script',
      hostProbe: () => ({ webDev: { ...v2, preflight } }) });
    assert.equal(cap.webDev.available, false, label);
    const result = planTaskRoute(project, { taskKind: 'episode-script' }, {
      discover: () => ({ webDev: { ...v2, preflight } }),
    });
    assert.equal(result.status, 'NEEDS_USER_ACTION', label);
    assert.equal(result.selectedRoute, 'manual', label);
  }
});

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

test('narrative and image discovery never spawn an irrelevant Codex availability check', t => {
  const project = freshStudioGame(t);
  let codexChecks = 0;
  const checkCodex = () => { codexChecks++; return { ok: true, code: 'AVAILABLE' }; };
  for (const taskKind of ['episode-script', 'art-concept', 'image']) {
    const cap = discoverTaskCapabilities(project, { taskKind, checkCodex });
    assert.equal(cap.codex.available, false);
    assert.equal(cap.codex.reasonCode, 'AI_ROUTING_CODEX_NOT_REQUESTED');
  }
  assert.equal(codexChecks, 0);
  const mechanic = discoverTaskCapabilities(project, { taskKind: 'mechanics', checkCodex });
  assert.equal(mechanic.codex.available, true);
  assert.equal(codexChecks, 1);
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
  for (const modelObserved of ['gpt-5.6-sol', 'gpt-7-sol']) {
    const wrongModel = discoverTaskCapabilities(project, { hostProbe: () => ({
      webDev: { ...verifiedDev, modelObserved },
    }) });
    assert.equal(wrongModel.webDev.available, false);
    assert.equal(wrongModel.webDev.reasonCode, 'AI_ROUTING_MODEL_UNVERIFIED');
    assert.equal(planTaskRoute(project, { taskKind: 'art-concept' },
      { discover: () => wrongModel }).status, 'NEEDS_USER_ACTION');
  }
});

test('legacy image routing requires explicit producer pins, while auto uses built-in ImageGen', t => {
  const project = freshStudioGame(t);
  const capabilitiesFor = host => discoverTaskCapabilities(project, { checkCodex: () => ({ ok: false }),
    hostProbe: () => host });
  const both = planTaskRoute(project, { taskKind: 'image', model: 'terra' },
    { discover: () => capabilitiesFor({ imageTerra: verifiedTerra, imageSol: verifiedSol }) });
  assert.equal(both.status, 'READY');
  assert.equal(both.selectedRoute, 'image-terra');
  assert.equal(both.modelObserved, 'gpt-5.6-terra');
  const onlySol = planTaskRoute(project, { taskKind: 'image', model: 'sol' },
    { discover: () => capabilitiesFor({ imageSol: verifiedSol }) });
  assert.equal(onlySol.status, 'READY');
  assert.equal(onlySol.selectedRoute, 'image-sol');
  assert.equal(onlySol.modelObserved, 'gpt-6-sol');
  const absent = planTaskRoute(project, { taskKind: 'image' },
    { discover: () => capabilitiesFor({}) });
  assert.equal(absent.status, 'NEEDS_AGENT_ACTION');
  assert.equal(absent.selectedRoute, 'codex-imagegen');
  assert.equal(absent.modelObserved, null);
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
    assert.equal(planTaskRoute(project, { taskKind: 'image', model: 'terra' }, { discover: () => capabilities }).status, 'NEEDS_USER_ACTION');
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
    assert.equal(planTaskRoute(project, { taskKind, ...(taskKind === 'image' && { model: 'terra' }) }, { discover: () => unverified }).status,
      'NEEDS_USER_ACTION');
  }
});

test('inherited host attestations and host candidate entries never make a route ready', t => {
  const project = freshStudioGame(t);
  const inheritedTerra = Object.create(verifiedTerra);
  const inheritedDev = Object.create({ ...verifiedDev, reasonCode: 'AVAILABLE' });
  const capabilities = discoverTaskCapabilities(project, { taskKind: 'image',
    hostProbe: () => ({ imageTerra: inheritedTerra, webDev: inheritedDev }) });
  assert.equal(capabilities.imageTerra.available, false);
  assert.equal(capabilities.webDev.available, false);
  assert.equal(planTaskRoute(project, { taskKind: 'image', model: 'terra' },
    { discover: () => capabilities }).status, 'NEEDS_USER_ACTION');
  assert.equal(planTaskRoute(project, { taskKind: 'episode-script' },
    { discover: () => ({ webDev: inheritedDev }) }).status, 'NEEDS_USER_ACTION');

  const inheritedCandidate = Object.create({ imageTerra: verifiedTerra });
  assert.equal(discoverTaskCapabilities(project, { taskKind: 'image',
    hostProbe: () => inheritedCandidate }).imageTerra.available, false);

  const inheritedCodex = Object.create({ available: true, reasonCode: 'AVAILABLE' });
  assert.equal(planTaskRoute(project, { taskKind: 'mechanics' },
    { discover: () => ({ codex: inheritedCodex }) }).status, 'NEEDS_USER_ACTION');
});

test('accessor-based attestation fields are not read or trusted', t => {
  const project = freshStudioGame(t);
  let reads = 0;
  const accessorHost = { ...verifiedTerra };
  Object.defineProperty(accessorHost, 'modelObserved', { enumerable: true, get() {
    reads++;
    return 'gpt-5.6-terra';
  } });
  const accessorCandidates = {};
  Object.defineProperty(accessorCandidates, 'imageTerra', { enumerable: true, get() {
    reads++;
    return verifiedTerra;
  } });
  assert.equal(discoverTaskCapabilities(project, { taskKind: 'image',
    hostProbe: () => ({ imageTerra: accessorHost }) }).imageTerra.available, false);
  assert.equal(discoverTaskCapabilities(project, { taskKind: 'image',
    hostProbe: () => accessorCandidates }).imageTerra.available, false);
  assert.equal(reads, 0);
});

test('host rejection records distinguish transport, entitlement, model and Image Gen failure', t => {
  const project = freshStudioGame(t);
  const invalid = [
    [{ ...verifiedTerra, transportVerified: false }, 'AI_ROUTING_TRANSPORT_UNVERIFIED'],
    [{ ...verifiedTerra, entitlementVerified: false }, 'AI_ROUTING_ENTITLEMENT_UNVERIFIED'],
    [{ ...verifiedTerra, modelObserved: 'gpt-6-sol' }, 'AI_ROUTING_MODEL_UNVERIFIED'],
    [{ ...verifiedTerra, imageGenCallable: false }, 'AI_ROUTING_IMAGE_GEN_UNVERIFIED'],
  ];
  for (const [candidate, reason] of invalid) {
    const capabilities = discoverTaskCapabilities(project, { taskKind: 'image',
      hostProbe: () => ({ imageTerra: candidate }) });
    assert.equal(capabilities.imageTerra.reasonCode, reason);
    const plan = planTaskRoute(project, { taskKind: 'image', model: 'terra' },
      { discover: () => capabilities });
    assert.equal(plan.status, 'NEEDS_USER_ACTION');
    assert.equal(plan.reasonCode, 'AI_ROUTING_PINNED_MODEL_UNAVAILABLE');
    assert.equal(plan.capabilityReasonCode, reason);
    assert.equal(plan.capabilityReasons.terra, reason);
  }
});

test('negative aggregate host availability preserves its observed rejection cause', t => {
  const project = freshStudioGame(t);
  for (const [changes, reason] of [
    [{ transportVerified: false }, 'AI_ROUTING_TRANSPORT_UNVERIFIED'],
    [{ entitlementVerified: false }, 'AI_ROUTING_ENTITLEMENT_UNVERIFIED'],
    [{ modelObserved: 'gpt-6-sol' }, 'AI_ROUTING_MODEL_UNVERIFIED'],
    [{ imageGenCallable: false }, 'AI_ROUTING_IMAGE_GEN_UNVERIFIED'],
  ]) {
    const capabilities = discoverTaskCapabilities(project, { taskKind: 'image',
      hostProbe: () => ({ imageTerra: { ...verifiedTerra, ...changes, available: false } }) });
    const plan = planTaskRoute(project, { taskKind: 'image', model: 'terra' },
      { discover: () => capabilities });
    assert.equal(plan.status, 'NEEDS_USER_ACTION');
    assert.equal(plan.capabilityReasonCode, reason);
  }
  const contradictory = discoverTaskCapabilities(project, { taskKind: 'image',
    hostProbe: () => ({ imageTerra: { ...verifiedTerra, available: false } }) });
  assert.equal(contradictory.imageTerra.reasonCode, 'AI_ROUTING_HOST_UNVERIFIED');
});

test('explicit SOL legacy selection retains Terra failure evidence', t => {
  const project = freshStudioGame(t);
  const capabilities = discoverTaskCapabilities(project, { taskKind: 'image',
    hostProbe: () => ({ imageTerra: { ...verifiedTerra, entitlementVerified: false },
      imageSol: verifiedSol }) });
  const plan = planTaskRoute(project, { taskKind: 'image', model: 'sol' }, { discover: () => capabilities });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.selectedRoute, 'image-sol');
  assert.equal(plan.capabilityReasons.terra, 'AI_ROUTING_ENTITLEMENT_UNVERIFIED');
  assert.equal(plan.capabilityReasons.sol, 'AVAILABLE');
  assert.equal(Object.hasOwn(plan, 'capabilityReasonCode'), false);
});

test('Codex and Web DEV previews retain bounded failure evidence', t => {
  const project = freshStudioGame(t);
  const timeout = discoverTaskCapabilities(project, { taskKind: 'mechanics',
    checkCodex: () => ({ ok: false, code: 'EXECUTOR_TIMEOUT' }) });
  const mechanics = planTaskRoute(project, { taskKind: 'mechanics' }, { discover: () => timeout });
  assert.equal(mechanics.reasonCode, 'AI_ROUTING_CODEX_UNAVAILABLE');
  assert.equal(mechanics.capabilityReasonCode, 'EXECUTOR_TIMEOUT');
  const invalidDev = discoverTaskCapabilities(project, { taskKind: 'episode-script',
    hostProbe: () => ({ webDev: { ...verifiedDev, entitlementVerified: false } }) });
  const script = planTaskRoute(project, { taskKind: 'episode-script' }, { discover: () => invalidDev });
  assert.equal(script.reasonCode, 'AI_ROUTING_WEB_DEV_UNAVAILABLE');
  assert.equal(script.capabilityReasonCode, 'AI_ROUTING_ENTITLEMENT_UNVERIFIED');
  const spoofed = planTaskRoute(project, { taskKind: 'mechanics' },
    { discover: () => ({ codex: { available: false, reasonCode: 'UNTRUSTED\nMESSAGE' } }) });
  assert.equal(spoofed.capabilityReasonCode, 'AI_ROUTING_CODEX_UNVERIFIED');
});

test('planner refuses inherited top-level capability candidates from direct discovery', t => {
  const project = freshStudioGame(t);
  const cases = [
    [{ taskKind: 'mechanics' }, { codex: { available: true, reasonCode: 'AVAILABLE' } }],
    [{ taskKind: 'episode-script' }, { webDev: { ...verifiedDev, reasonCode: 'AVAILABLE' } }],
    [{ taskKind: 'image', model: 'terra' }, { imageTerra: { ...verifiedTerra, reasonCode: 'AVAILABLE' } }],
  ];
  for (const [task, inherited] of cases) {
    const plan = planTaskRoute(project, task, { discover: () => Object.create(inherited) });
    assert.equal(plan.status, 'NEEDS_USER_ACTION');
    assert.equal(plan.selectedRoute, 'manual');
    assert.equal(Object.hasOwn(plan, 'modelObserved'), false);
  }
});

test('planner never invokes a mutable getter for candidate capabilities or observed models', t => {
  const project = freshStudioGame(t);
  let getterReads = 0;
  const candidates = {};
  Object.defineProperty(candidates, 'imageTerra', { enumerable: true, get() {
    getterReads++;
    return getterReads < 3 ? { ...verifiedTerra, reasonCode: 'AVAILABLE' }
      : { available: false, modelObserved: 'forged-model' };
  } });
  const plan = planTaskRoute(project, { taskKind: 'image', model: 'terra' }, { discover: () => candidates });
  assert.equal(plan.status, 'NEEDS_USER_ACTION');
  assert.equal(Object.hasOwn(plan, 'modelObserved'), false);
  assert.equal(getterReads, 0);
});

test('revoked host proxies fail closed without escaping capability or planner preflight', t => {
  const project = freshStudioGame(t);
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  const fromHost = discoverTaskCapabilities(project, { taskKind: 'image', hostProbe: () => proxy });
  assert.equal(fromHost.imageTerra.available, false);
  const fromCandidate = discoverTaskCapabilities(project, { taskKind: 'image',
    hostProbe: () => ({ imageTerra: proxy }) });
  assert.equal(fromCandidate.imageTerra.available, false);
  const fromPlanner = planTaskRoute(project, { taskKind: 'image', model: 'terra' }, { discover: () => proxy });
  assert.equal(fromPlanner.status, 'NEEDS_USER_ACTION');
  assert.equal(fromPlanner.selectedRoute, 'manual');
});
