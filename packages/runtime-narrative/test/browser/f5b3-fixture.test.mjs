import '../../../studio/test/setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectYandexArchive, inspectVkArchive } from '@ludory/release';
import { verifyNarrativePlatformCandidates, buildNarrativePlatformCandidates } from '../../../studio/src/narrative-platform-export.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

test('F5b3 serves the real paired ZIP members without changing the authored source', async t => {
  const { createF5b3Fixture } = await import('./f5b3-fixture.mjs');
  const fixture = await createF5b3Fixture();
  t.after(() => fixture.cleanup());
  assert.equal(fixture.verification.status, 'LOCAL_ARCHIVES_VERIFIED');
  assert.equal(fixture.sourceDigest, fixture.sourcePlan.sourceDigest);
  const receipt = JSON.parse(fs.readFileSync(fixture.outputs.exportReceipt));
  assert.equal(receipt.sourceDigest, fixture.sourceDigest);
  assert.equal(receipt.sourceFiles.length, fixture.sourcePlan.files.length);
  assert.deepEqual(fixture.afterAuthorHashes, fixture.beforeAuthorHashes);
  for (const [key, target, inspect] of [
    ['yandex', 'yandex-games', inspectYandexArchive],
    ['vk', 'vk-games', inspectVkArchive],
  ]) {
    const candidate = fixture.candidates[key];
    const inspected = inspect(fixture.outputs[`${key}Zip`]);
    assert.equal(candidate.archiveSha256, inspected.sha256);
    assert.equal(sha(candidate.entries['src/main.js']), inspected.files.find(file => file.path === 'src/main.js').sha256);
    assert.match(Buffer.from(candidate.entries['src/main.js']).toString(), /F5B3_AUTHORED_STORY_317/);
    assert.deepEqual(JSON.parse(Buffer.from(candidate.entries['ludory.project.json']).toString()).targets, [target]);
    assert.equal(Object.hasOwn(candidate.entries, 'sdk.js'), false);
    const server = await fixture.serve(key);
    t.after(() => server.close());
    const entry = await fetch(new URL('src/main.js', server.url));
    assert.equal(entry.status, 200);
    assert.equal(sha(Buffer.from(await entry.arrayBuffer())), sha(candidate.entries['src/main.js']));
    assert.deepEqual(server.requests, ['src/main.js']);
  }
});

test('F5b3 refuses source drift and a modified or swapped archive before browser acceptance', async t => {
  const { createF5b3Fixture } = await import('./f5b3-fixture.mjs');
  const fixture = await createF5b3Fixture();
  t.after(() => fixture.cleanup());
  const original = fs.readFileSync(fixture.outputs.yandexZip);
  fs.appendFileSync(fixture.outputs.yandexZip, 'tamper');
  assert.equal((await verifyNarrativePlatformCandidates(fixture.outputs, fixture.sourcePlan)).status, 'BLOCKED');
  fs.writeFileSync(fixture.outputs.yandexZip, original);
  const swapped = { ...fixture.outputs, yandexZip: fixture.outputs.vkZip, vkZip: fixture.outputs.yandexZip };
  assert.equal((await verifyNarrativePlatformCandidates(swapped, fixture.sourcePlan)).status, 'BLOCKED');
  const repeated = await buildNarrativePlatformCandidates(fixture.sourcePlan, fixture.outputs);
  assert.equal(repeated.status, 'BLOCKED', 'existing destinations must not be overwritten');
  assert.deepEqual(fs.readFileSync(fixture.outputs.yandexZip), original);
});

test('F5b3 refuses an altered served member even after original ZIP verification', async t => {
  const { createF5b3Fixture } = await import('./f5b3-fixture.mjs');
  const fixture = await createF5b3Fixture();
  t.after(() => fixture.cleanup());
  const server = await fixture.serve('vk');
  t.after(() => server.close());
  const entry = fixture.candidates.vk.entries['src/main.js'];
  entry[0] ^= 1;
  const response = await fetch(new URL('src/main.js', server.url));
  assert.notEqual(response.status, 200, 'a mutated in-memory archive member cannot be served as verified');
});

test('F5b3 will not start an HTTP fixture after the authored story changes', async t => {
  const { createF5b3Fixture } = await import('./f5b3-fixture.mjs');
  const fixture = await createF5b3Fixture();
  t.after(() => fixture.cleanup());
  fs.appendFileSync(path.join(fixture.author, 'src/story.js'), '\n// author edit after pin\n');
  await assert.rejects(() => fixture.serve('yandex'), /F5B3_SOURCE_OR_ARCHIVE_CHANGED/);
});

test('F5b3 refuses to serve either platform after any linked receipt is tampered', async t => {
  const { createF5b3Fixture } = await import('./f5b3-fixture.mjs');
  const fixture = await createF5b3Fixture();
  t.after(() => fixture.cleanup());
  for (const receipt of ['yandexBuildReceipt', 'vkBuildReceipt', 'exportReceipt']) {
    const filename = fixture.outputs[receipt];
    const original = fs.readFileSync(filename);
    fs.appendFileSync(filename, 'invalid-receipt');
    try {
      await assert.rejects(() => fixture.serve('vk'), /F5B3_SOURCE_OR_ARCHIVE_CHANGED/);
      await assert.rejects(() => fixture.serve('yandex'), /F5B3_SOURCE_OR_ARCHIVE_CHANGED/);
    } finally { fs.writeFileSync(filename, original); }
  }
  const server = await fixture.serve('yandex');
  assert.equal((await fetch(new URL('src/main.js', server.url))).status, 200);
});
