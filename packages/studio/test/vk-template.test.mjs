import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';

const options = { id: 'vk-smoke', title: 'VK Smoke', lang: 'en', version: '1.0.0',
  profile: 'web-game', template: 'vk-runtime', targets: ['vk-games'] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-vk-v4-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('VK template permits VK-only games and rejects Yandex/mixed targets without writes', t => {
  const root = project(t);
  const accepted = planCreate(root, options);
  assert.equal(accepted.status, 'READY', accepted.conflicts?.join('; '));
  for (const targets of [['yandex-games'], ['vk-games', 'yandex-games']]) {
    assert.equal(planCreate(root, { ...options, targets }).status, 'BLOCKED');
  }
  assert.deepEqual(fs.readdirSync(root), []);
});

test('VK template rejects a game ID too long for its real Runtime save key', t => {
  const root = project(t);
  assert.equal(planCreate(root, { ...options, id: 'a'.repeat(35) }).status, 'READY');
  const tooLong = planCreate(root, { ...options, id: 'a'.repeat(36) });
  assert.equal(tooLong.status, 'BLOCKED');
  assert.match(tooLong.conflicts.join(' '), /VK|storage|35|key/i);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('Studio creates a VK-only game with local owned SDK and Runtime bundles', t => {
  const root = project(t);
  const planned = planCreate(root, options);
  assert.equal(planned.status, 'READY', planned.conflicts?.join('; '));
  assert.equal(applyCreatePlan(planned).status, 'APPLIED');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ludory.project.json'), 'utf8'));
  assert.deepEqual(manifest.targets, ['vk-games']);
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'ludory.studio.json'), 'utf8'));
  for (const name of ['assets/ludory-vk.js', 'assets/vk-bridge.js', 'src/main.js', 'index.html',
    'licenses/vk-bridge.txt', 'licenses/swc-helpers.txt']) {
    assert.equal(hash(fs.readFileSync(path.join(root, name))), receipt.files[name], name);
  }
  assert.match(fs.readFileSync(path.join(root, 'licenses/vk-bridge.txt'), 'utf8'), /Copyright \(c\) 2017-present, V Kontakte/);
  assert.match(fs.readFileSync(path.join(root, 'licenses/swc-helpers.txt'), 'utf8'), /Apache License/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  assert.ok(entry.includes("'../assets/ludory-vk.js'"));
  assert.ok(entry.includes("'../assets/vk-bridge.js'"));
  assert.doesNotMatch(html + entry, /YaGames|\/sdk\.js|unpkg\.com|cdn\./);
  assert.ok(fs.statSync(path.join(root, 'assets/vk-bridge.js')).size > 1000);
});

test('VK template bundles are reproducible and modified bytes cannot pass verification', async () => {
  const { buildVkTemplateBundles, verifyVkTemplateBundles } =
    await import('../../../scripts/build-vk-template.mjs');
  const first = await buildVkTemplateBundles();
  const second = await buildVkTemplateBundles();
  assert.ok(first.ludory.length > 1000);
  assert.ok(first.bridge.length > 1000);
  assert.deepEqual(first, second);
  assert.equal(await verifyVkTemplateBundles(first), true);
  await assert.rejects(() => verifyVkTemplateBundles({ ...first,
    bridge: Buffer.concat([first.bridge, Buffer.from('\n// modified')]) }), /stale|mismatch/i);
  assert.doesNotMatch(first.ludory.toString('utf8'), /YaGames|sdk\.games\.s3\.yandex\.net/);
});
