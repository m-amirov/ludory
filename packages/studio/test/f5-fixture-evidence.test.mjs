import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { runF5Fixture } from '../../../scripts/f5-fixture-evidence.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const smallPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2NtWMAAAAASUVORK5CYII=', 'base64');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f5-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, outputDir: path.join(root, 'evidence'), sentinel: path.join(root, 'owner.txt') };
}

test('F5 refuses an existing output and never touches user bytes', async t => {
  const { outputDir, sentinel } = setup(t);
  fs.writeFileSync(sentinel, 'keep-owner-bytes');
  fs.mkdirSync(outputDir);
  fs.writeFileSync(path.join(outputDir, 'receipt.json'), 'existing');
  await assert.rejects(() => runF5Fixture({ outputDir }), /exist|exclusive|overwrite/i);
  assert.equal(fs.readFileSync(path.join(outputDir, 'receipt.json'), 'utf8'), 'existing');
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep-owner-bytes');
});

test('F5 new disposable games produce verifiable SDK ZIP hashes and honest blocked gates', { timeout: 90000 }, async t => {
  const { root, outputDir, sentinel } = setup(t);
  fs.writeFileSync(sentinel, 'immutable owner data');
  const result = await runF5Fixture({ outputDir, observeNarrative: async ({ outputDir: evidenceDir }) => {
    const cases = [];
    for (const name of ['desktop-wide', 'android-portrait-emulated']) {
      const file = `${name}.png`;
      const bytes = smallPng;
      fs.writeFileSync(path.join(evidenceDir, file), bytes);
      cases.push({ name, status: 'PASS', screenshot: { file, sha256: sha(bytes) },
        pageErrors: [], externalRequests: [] });
    }
    return { status: 'OBSERVED_PASS', cases, offlineStartup: 'BLOCKED_OFFLINE_STARTUP' };
  } });
  assert.match(result.runId, /^f5-[a-f0-9-]{36}$/);
  assert.equal(result.checkedHead, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  assert.match(result.checkedHead, /^[0-9a-f]{40}$/);
  assert.equal(result.status, 'PARTIAL_BLOCKED');
  assert.equal(result.browser.status, 'OBSERVED_PASS');
  assert.equal(result.ai.hostInvocations, 0);
  assert.equal(result.ai.image.status, 'NEEDS_AGENT_ACTION');
  assert.equal(result.ai.image.modelObserved, null);
  assert.equal(result.narrativePackaging.status, 'BLOCKED');
  assert.equal(result.narrativePackaging.reasonCode, 'STORY_TARGET_PACKAGING_BLOCKED');
  assert.equal(result.actualModeration, 'NOT_RUN');
  assert.equal(result.physicalDevices, 'NOT_RUN');
  assert.equal(result.liveAi, 'NOT_RUN');
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.nonDestructive.existingProjectsOpened, false);
  assert.equal(result.nonDestructive.temporaryProjectsRemoved, true);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'immutable owner data');
  assert.ok(!fs.existsSync(result.nonDestructive.temporaryRoot));
  assert.deepEqual(result.fixtures.narrative.targets, ['yandex-games', 'vk-games']);
  assert.notEqual(result.fixtures.narrative.template, result.fixtures.yandex.template);
  assert.notEqual(result.fixtures.narrative.template, result.fixtures.vk.template);
  for (const [target, template] of [['yandex', 'yandex-runtime'], ['vk', 'vk-runtime']]) {
    const fixture = result.fixtures[target];
    assert.equal(fixture.template, template);
    assert.match(fixture.treeSha256, /^[0-9a-f]{64}$/);
    const candidate = result.candidates[target];
    const archive = fs.readFileSync(path.join(outputDir, candidate.file));
    assert.equal(sha(archive), candidate.sha256);
    const entries = unzipSync(new Uint8Array(archive));
    assert.deepEqual(Object.keys(entries).sort(), candidate.files.map(file => file.path));
    for (const file of candidate.files) {
      assert.equal(sha(entries[file.path]), file.sha256);
      assert.equal(entries[file.path].byteLength, file.size);
    }
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir, 'f5-evidence.json'), 'utf8')), result);
  for (const item of result.browser.cases) {
    assert.equal(sha(fs.readFileSync(path.join(outputDir, item.screenshot.file))), item.screenshot.sha256);
  }
});

test('F5 treats absent browsers as NOT_RUN, not PASS', { timeout: 90000 }, async t => {
  const { outputDir } = setup(t);
  const result = await runF5Fixture({ outputDir });
  assert.equal(result.browser.status, 'NOT_RUN');
  assert.equal(result.browser.reasonCode, 'F5_BROWSER_NOT_PROVIDED');
  assert.equal(result.status, 'PARTIAL_BLOCKED');
  assert.equal(result.releaseReady, false);
});

test('F5 rejects forged observer screenshots and preserves failure receipt', { timeout: 90000 }, async t => {
  const { outputDir } = setup(t);
  await assert.rejects(() => runF5Fixture({ outputDir, observeNarrative: async () => ({
    status: 'OBSERVED_PASS', cases: [{ name: 'desktop-wide', status: 'PASS',
      screenshot: { file: '../untrusted.png', sha256: 'a'.repeat(64) }, pageErrors: [], externalRequests: [] }],
  }) }), /screenshot|observation|path/i);
  const receipt = JSON.parse(fs.readFileSync(path.join(outputDir, 'f5-evidence.json'), 'utf8'));
  assert.equal(receipt.status, 'ISSUES_FOUND');
  assert.equal(receipt.browser.status, 'ISSUES_FOUND');
  assert.equal(receipt.browser.reasonCode, 'F5_BROWSER_OBSERVATION_FAILED');
  assert.equal(receipt.releaseReady, false);
  assert.match(receipt.failure.reasonCode, /^F5_/);
});
