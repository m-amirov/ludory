import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { buildYandexTemplateBundle, verifyYandexTemplateBundle } from '../../../scripts/build-yandex-template.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const options = { id: 'yandex-smoke', title: 'Yandex Smoke', lang: 'en', version: '1.0.0',
  profile: 'web-game', template: 'yandex-runtime', targets: ['yandex-games'] };

function tempProject(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-yandex-c5-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('Yandex template is opt-in and cannot scaffold VK or mixed targets', t => {
  const directory = tempProject(t);
  const valid = planCreate(directory, options);
  assert.equal(valid.status, 'READY', valid.conflicts.join('; '));
  assert.equal(planCreate(directory, { ...options, targets: ['vk-games'] }).status, 'BLOCKED');
  assert.equal(planCreate(directory, { ...options, targets: ['yandex-games', 'vk-games'] }).status, 'BLOCKED');
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('Yandex Studio creation rejects IDs that cannot initialize Player storage', t => {
  const directory = tempProject(t);
  const tooLong = planCreate(directory, { ...options, id: 'a'.repeat(65) });
  assert.equal(tooLong.status, 'BLOCKED');
  assert.match(tooLong.conflicts.join(' '), /yandex|id|64|namespace/i);
  assert.deepEqual(fs.readdirSync(directory), []);
  assert.equal(planCreate(directory, { ...options, id: 'a'.repeat(64) }).status, 'READY');
});

test('Studio generates an SDK-first Yandex game with exact owned hashes and no SDK copy', t => {
  const directory = tempProject(t);
  const plan = planCreate(directory, options);
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const entry = fs.readFileSync(path.join(directory, 'src/main.js'), 'utf8');
  const bundle = fs.readFileSync(path.join(directory, 'assets/ludory-yandex.js'));
  const sdkTag = /<script\s+src="\/sdk\.js"><\/script>/g;
  assert.equal([...html.matchAll(sdkTag)].length, 1);
  assert.ok(html.indexOf('src="/sdk.js"') < html.indexOf('src="src/main.js"'));
  assert.match(entry, /createYandexConnector/);
  assert.match(entry, /createYandexLifecycle/);
  assert.match(entry, /createYandexPlayerStorage/);
  assert.doesNotMatch(html + entry, /sdk\.games\.s3\.yandex\.net|vk-bridge|VKWebAppInit/);
  assert.equal(fs.existsSync(path.join(directory, 'sdk.js')), false);
  assert.ok(bundle.length > 1000);
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'ludory.studio.json'), 'utf8'));
  for (const [file, sha] of Object.entries(receipt.files)) {
    assert.equal(digest(fs.readFileSync(path.join(directory, file))), sha, file);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'ludory.project.json'))).targets, ['yandex-games']);
});

test('Yandex generated Sound button has a playable non-silent PCM demonstration', t => {
  const directory = tempProject(t);
  const plan = planCreate(directory, options);
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  const entry = fs.readFileSync(path.join(directory, 'src/main.js'), 'utf8');
  const start = entry.indexOf('const beep = ');
  const end = entry.indexOf('\n\nfunction report(', start);
  assert.ok(start >= 0 && end > start);
  const sandbox = { btoa: input => Buffer.from(input, 'binary').toString('base64') };
  vm.runInNewContext(`${entry.slice(start, end)}\nglobalThis.soundAsset = beep;`, sandbox);
  assert.match(sandbox.soundAsset, /^data:audio\/wav;base64,/);
  const bytes = Buffer.from(sandbox.soundAsset.split(',')[1], 'base64');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt16LE(34), 8);
  assert.equal(bytes.readUInt32LE(24), 8000);
  const samples = bytes.readUInt32LE(40);
  assert.equal(bytes.byteLength, 44 + samples);
  assert.ok(samples >= 1600, 'Sound demo must last at least 200 ms');
  assert.ok(new Set(bytes.subarray(44)).size >= 8, 'Sound demo must be audible, not silence');
});

test('Yandex template bundle is deterministic and a stale copy is rejected', async () => {
  const first = await buildYandexTemplateBundle();
  const again = await buildYandexTemplateBundle();
  assert.deepEqual(first, again);
  assert.doesNotMatch(first.toString('utf8'), /sdk\.games\.s3\.yandex\.net|VKWebAppInit/,
    'A Yandex loader URL may be present, but no foreign or absolute SDK must be bundled');
  assert.equal(await verifyYandexTemplateBundle(first), true);
  await assert.rejects(() => verifyYandexTemplateBundle(Buffer.from('outdated')), /stale|mismatch/i);
});
