import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { checkYandexRelease } from '../src/check.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const variants = [
  ['Chromium desktop', 'chromium', false],
  ['Firefox desktop', 'firefox', false],
  ['WebKit desktop', 'webkit', false],
  ['Android Chromium', 'chromium', true],
  ['iPhone WebKit', 'webkit', true],
];

function input(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-release-check-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const entries = {
    'index.html': '<html><head><script src="/sdk.js"></script></head></html>',
    'ludory.project.json': JSON.stringify({ schemaVersion: 1, id: 'release-game',
      version: '0.1.0', title: { en: 'Game' }, engine: 'web', targets: ['yandex-games'] }),
    'assets/ludory-yandex.js': '//managed',
    'src/main.js': 'console.log(123)',
    'assets/picture.png': 'REAL ASSET',
  };
  const archiveBytes = Buffer.from(zipSync(Object.fromEntries(
    Object.entries(entries).map(([name, content]) => [name, new Uint8Array(Buffer.from(content))])), { level: 0 }));
  const archivePath = path.join(folder, 'candidate.zip');
  fs.writeFileSync(archivePath, archiveBytes);
  const candidateSha256 = sha(archiveBytes);
  const receipt = { archivePath, sha256: candidateSha256,
    files: Object.entries(entries).map(([name, content]) => ({ path: name, sha256: sha(content), size: Buffer.byteLength(content) })) };
  const sdk = { schemaVersion: 1, stage: 'Connect Yandex C5', candidateSha256,
    sdk: 'fake /sdk.js served only by fixture', verdict: 'SDK_CONTRACT_PASS',
    liveYandex: 'YANDEX_LIVE_NOT_RUN', physicalDevices: 'NOT_RUN',
    results: variants.map(([browser, engine, emulated]) => ({ browser, engine, emulated,
      phase: 'complete', status: 'SDK_CONTRACT_PASS' })) };
  const rights = { schemaVersion: 1, target: 'yandex-games', candidateSha256,
    assets: [{ path: 'assets/picture.png', sha256: sha('REAL ASSET'), provenance: 'owned',
      evidence: 'Design archive: work-products/cover-source.psd' }] };
  const receiptPath = path.join(folder, 'receipt.json');
  const sdkEvidencePath = path.join(folder, 'sdk.json');
  const rightsPath = path.join(folder, 'rights.json');
  const save = () => {
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    fs.writeFileSync(sdkEvidencePath, JSON.stringify(sdk));
    fs.writeFileSync(rightsPath, JSON.stringify(rights));
  };
  save();
  return { archivePath, receiptPath, sdkEvidencePath, rightsPath, receipt, sdk, rights, save, folder };
}

const gate = (result, id) => result.gates.find(value => value.id === id);

test('all local checks can pass while release and publication always remain blocked', t => {
  const data = input(t);
  const before = fs.readdirSync(data.folder).sort();
  const result = checkYandexRelease(data);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.status, 'PASS_LOCAL');
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.candidateSha256, data.receipt.sha256);
  for (const id of ['archive', 'build-receipt', 'sdk-contract', 'rights-declarations']) {
    assert.equal(gate(result, id).status, 'PASS', id);
  }
  for (const id of ['platform-live', 'rights-clearance', 'owner-authorization']) {
    assert.equal(gate(result, id).status, 'NOT_RUN', id);
  }
  assert.deepEqual(fs.readdirSync(data.folder).sort(), before);
});

test('altered ZIP and mismatched build receipt fail, even if evidence declares PASS', t => {
  const data = input(t);
  data.receipt.sha256 = 'f'.repeat(64);
  data.save();
  assert.equal(gate(checkYandexRelease(data), 'build-receipt').reasonCode, 'RECEIPT_CANDIDATE_MISMATCH');
  data.receipt.sha256 = data.sdk.candidateSha256;
  data.receipt.files[0].sha256 = '0'.repeat(64);
  data.save();
  assert.equal(gate(checkYandexRelease(data), 'build-receipt').status, 'FAIL');
  data.receipt.files[0].sha256 = sha('<html><head><script src="/sdk.js"></script></head></html>');
  data.save();
  fs.appendFileSync(data.archivePath, 'tampered');
  assert.equal(checkYandexRelease(data).status, 'FAIL');
});

test('missing evidence is BLOCKED, not an implicit PASS', t => {
  const data = input(t);
  fs.unlinkSync(data.sdkEvidencePath);
  const result = checkYandexRelease(data);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(gate(result, 'sdk-contract').status, 'BLOCKED');
  assert.equal(result.releaseReady, false);
});

test('mock evidence cannot claim live PASS or omit an emulated browser variant', t => {
  const data = input(t);
  data.sdk.liveYandex = 'YANDEX_LIVE_PASS';
  data.save();
  assert.equal(gate(checkYandexRelease(data), 'sdk-contract').status, 'FAIL');
  data.sdk.liveYandex = 'YANDEX_LIVE_NOT_RUN';
  data.sdk.results.pop();
  data.save();
  assert.equal(gate(checkYandexRelease(data), 'sdk-contract').reasonCode, 'SDK_VARIANTS_INCOMPLETE');
});

test('rights path hash binding and full media coverage are enforced', t => {
  const data = input(t);
  data.rights.assets = [];
  data.save();
  assert.equal(gate(checkYandexRelease(data), 'rights-declarations').status, 'BLOCKED');
  data.rights.assets.push({ path: 'assets/picture.png', sha256: '0'.repeat(64),
    provenance: 'owned', evidence: 'photo' });
  data.save();
  assert.equal(gate(checkYandexRelease(data), 'rights-declarations').status, 'FAIL');
  data.rights.assets[0].sha256 = sha('REAL ASSET');
  data.rights.candidateSha256 = 'f'.repeat(64);
  data.save();
  assert.equal(gate(checkYandexRelease(data), 'rights-declarations').reasonCode, 'RIGHTS_CANDIDATE_MISMATCH');
});

test('input symlink or invalid JSON is a FAIL, not an unchecked platform PASS', t => {
  const data = input(t);
  fs.writeFileSync(data.sdkEvidencePath, '{broken');
  assert.equal(gate(checkYandexRelease(data), 'sdk-contract').status, 'FAIL');
  data.save();
  const link = path.join(data.folder, 'receipt-link.json');
  try { fs.symlinkSync(data.receiptPath, link); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
  assert.equal(gate(checkYandexRelease({ ...data, receiptPath: link }), 'build-receipt').status, 'FAIL');
});
