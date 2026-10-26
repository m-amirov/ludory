import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planTaskRoute } from '../src/task-routing.mjs';
import { discoverTaskCapabilities } from '../src/capabilities.mjs';

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-gpt-route-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'ludory.project.json'), `${JSON.stringify({
    schemaVersion: 1, id: 'gpt-image-game', version: '0.1.0',
    title: { en: 'GPT Image' }, engine: 'web', targets: ['vk-games'],
  })}\n`);
  fs.writeFileSync(path.join(dir, 'ludory.studio.json'), JSON.stringify({
    schemaVersion: 1, profile: { id: 'narrative-game' }, template: { id: 'starter' },
    files: { 'ludory.project.json': 'a'.repeat(64) },
  }));
  return dir;
}

const gpt = model => ({ available: true, provider: 'openai', routeObserved: 'gpt-image',
  transportConfigured: true, paidAuthorized: true, imageGenCallable: true,
  modelRequested: model, modelObserved: null });

test('image routing defaults to independent GPT Image and never claims the primary model made pixels', t => {
  const dir = project(t);
  const fallback = planTaskRoute(dir, { taskKind: 'image' }, { discover: () => ({}) });
  assert.equal(fallback.preferredRoute, 'gpt-image');
  assert.equal(fallback.status, 'NEEDS_USER_ACTION');
  const discovered = discoverTaskCapabilities(dir, { taskKind: 'image',
    hostProbe: () => ({ imageGpt: gpt('gpt-image-2.5-sunburst') }) });
  const ready = planTaskRoute(dir, { taskKind: 'image' }, { discover: () => discovered });
  assert.equal(ready.selectedRoute, 'gpt-image');
  assert.equal(ready.status, 'READY');
  assert.equal(ready.modelRequested, 'gpt-image-2.5-sunburst');
  assert.equal(ready.modelObserved, null);
});

test('Flare pin cannot fall back to Sunburst, Terra or SOL', t => {
  const dir = project(t);
  const available = discoverTaskCapabilities(dir, { taskKind: 'image',
    hostProbe: () => ({ imageGpt: gpt('gpt-image-2.5-sunburst'),
      imageTerra: { available: true, reasonCode: 'AVAILABLE' } }) });
  const pin = planTaskRoute(dir, { taskKind: 'image', model: 'flare' }, { discover: () => available });
  assert.equal(pin.status, 'NEEDS_USER_ACTION');
  assert.equal(pin.selectedRoute, 'manual');
  assert.equal(pin.reasonCode, 'AI_ROUTING_PINNED_MODEL_UNAVAILABLE');
});
