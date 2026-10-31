import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { planYandexFieldTests } from '../src/plan.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const variants = [
  ['Chromium desktop', 'chromium', false], ['Firefox desktop', 'firefox', false],
  ['WebKit desktop', 'webkit', false], ['Android Chromium', 'chromium', true],
  ['iPhone WebKit', 'webkit', true],
];
const requiredChecks = [
  'sdk-initialization', 'loading-api', 'player-authenticated', 'cloud-storage',
  'ads-interstitial', 'ads-rewarded', 'desktop-chromium', 'desktop-firefox',
  'desktop-webkit', 'mobile-android-emulated', 'mobile-ios-emulated',
  'physical-android', 'physical-ios',
];

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-r2-field-plan-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const entries = {
    'index.html': '<html><head><script src="/sdk.js"></script></head></html>',
    'ludory.project.json': JSON.stringify({ schemaVersion: 1, id: 'r2-game',
      version: '1.0.0', title: { en: 'Release R2' }, engine: 'web', targets: ['yandex-games'] }),
    'assets/ludory-yandex.js': '/* owned connector */',
    'src/main.js': 'console.log("r2")',
    'assets/cover.png': 'image original',
  };
  const zip = Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(
    ([name, body]) => [name, new Uint8Array(Buffer.from(body))])), { level: 0 }));
  const archivePath = path.join(folder, 'candidate.zip');
  const receiptPath = path.join(folder, 'receipt.json');
  const sdkEvidencePath = path.join(folder, 'sdk.json');
  const rightsPath = path.join(folder, 'rights.json');
  const fieldEvidencePath = path.join(folder, 'field.json');
  const candidateSha256 = sha(zip);
  fs.writeFileSync(archivePath, zip);
  fs.writeFileSync(receiptPath, JSON.stringify({ archivePath, sha256: candidateSha256,
    files: Object.entries(entries).map(([name, body]) => ({ path: name, sha256: sha(body), size: Buffer.byteLength(body) })) }));
  fs.writeFileSync(sdkEvidencePath, JSON.stringify({ schemaVersion: 1, stage: 'Connect Yandex C5',
    candidateSha256, sdk: 'fake /sdk.js served only by fixture', verdict: 'SDK_CONTRACT_PASS',
    liveYandex: 'YANDEX_LIVE_NOT_RUN', physicalDevices: 'NOT_RUN',
    results: variants.map(([browser, engine, emulated]) => ({ browser, engine, emulated,
      phase: 'complete', status: 'SDK_CONTRACT_PASS' })) }));
  fs.writeFileSync(rightsPath, JSON.stringify({ schemaVersion: 1, target: 'yandex-games', candidateSha256,
    assets: [{ path: 'assets/cover.png', sha256: sha('image original'),
      provenance: 'owned', evidence: 'Source owned by author' }] }));
  const field = { schemaVersion: 1, target: 'yandex-games', candidateSha256,
    source: 'USER_DECLARED', observations: [] };
  const saveField = () => fs.writeFileSync(fieldEvidencePath, JSON.stringify(field));
  return { folder, archivePath, receiptPath, sdkEvidencePath, rightsPath,
    fieldEvidencePath, candidateSha256, field, saveField };
}

const row = (result, id) => result.checks.find(check => check.id === id);

test('local R1 PASS makes a field-test-ready plan, never real host or device PASS', t => {
  const data = fixture(t);
  const before = fs.readdirSync(data.folder).sort();
  const result = planYandexFieldTests({ ...data, fieldEvidencePath: undefined });
  assert.equal(result.status, 'READY_FOR_FIELD_TEST');
  assert.equal(result.localStatus, 'PASS_LOCAL');
  assert.equal(result.candidateSha256, data.candidateSha256);
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.kind, 'yandex-field-test-plan');
  assert.deepEqual(result.checks.map(check => check.id), requiredChecks);
  assert.ok(result.checks.every(check => check.status === 'NOT_RUN'));
  assert.deepEqual(result.fieldEvidenceGate, { status: 'NOT_RUN', reasonCode: 'FIELD_EVIDENCE_NOT_PROVIDED' });
  assert.deepEqual(fs.readdirSync(data.folder).sort(), before);
});

test('self-reported all-PASS field observations are unverified blockers, never platform PASS', t => {
  const data = fixture(t);
  data.field.observations = requiredChecks.map(id => ({ id, status: 'PASS' }));
  data.saveField();
  const result = planYandexFieldTests(data);
  assert.equal(result.status, 'READY_FOR_FIELD_TEST');
  assert.equal(result.fieldEvidenceGate.status, 'BLOCKED');
  assert.ok(result.checks.every(check => check.status === 'BLOCKED' &&
    check.reasonCode === 'UNVERIFIED_SELF_REPORT'));
  assert.equal(result.releaseReady, false);
});

test('negative real-world field report produces FAIL even though R1 local checks pass', t => {
  const data = fixture(t);
  data.field.observations = [{ id: 'ads-rewarded', status: 'FAIL' },
    { id: 'sdk-initialization', status: 'PASS' }];
  data.saveField();
  const result = planYandexFieldTests(data);
  assert.equal(result.localStatus, 'PASS_LOCAL');
  assert.equal(result.status, 'FAIL');
  assert.equal(row(result, 'ads-rewarded').reasonCode, 'REPORTED_FIELD_FAILURE');
  assert.equal(row(result, 'sdk-initialization').status, 'BLOCKED');
  assert.equal(row(result, 'physical-ios').status, 'NOT_RUN');
});

test('field evidence is restricted to candidate-bound user declarations, not forged authority', t => {
  const data = fixture(t);
  for (const change of [
    field => { field.candidateSha256 = 'f'.repeat(64); },
    field => { field.source = 'HOST_OBSERVED'; },
    field => { field.releaseReady = true; },
    field => { field.observations = [{ id: 'foreign-check', status: 'PASS' }]; },
    field => { field.observations = [{ id: 'sdk-initialization', status: 'PASS' },
      { id: 'sdk-initialization', status: 'FAIL' }]; },
    field => { field.observations = [{ id: 'sdk-initialization', status: 'VERIFIED' }]; },
  ]) {
    const copy = structuredClone(data.field);
    change(copy);
    fs.writeFileSync(data.fieldEvidencePath, JSON.stringify(copy));
    const result = planYandexFieldTests(data);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.fieldEvidenceGate.status, 'FAIL');
    assert.ok(result.checks.every(check => check.status === 'NOT_RUN'));
  }
});

test('duplicate JSON members cannot overwrite failures or change observation identity', t => {
  const data = fixture(t);
  const base = JSON.stringify(data.field);
  const embedded = (key, first, second) => base.replace('"observations":[]',
    `"observations":[{"id":"ads-rewarded","${key}":"${first}","${key}":"${second}"}]`);
  for (const input of [
    embedded('status', 'FAIL', 'PASS'),
    base.replace('"observations":[]', '"observations":[{"id":"ads-rewarded","\\u0073tatus":"FAIL","status":"PASS"}]'),
    base.replace('"observations":[]', '"observations":[{"id":"ads-rewarded","id":"sdk-initialization","status":"FAIL"}]'),
    base.replace('"observations":[]', '"observations":[{"id":"ads-rewarded","status":"FAIL"}],"observations":[]'),
  ]) {
    fs.writeFileSync(data.fieldEvidencePath, input);
    const result = planYandexFieldTests(data);
    assert.equal(result.status, 'FAIL');
    assert.deepEqual(result.fieldEvidenceGate, { status: 'FAIL', reasonCode: 'FIELD_JSON_DUPLICATE_KEY' });
    assert.ok(result.checks.every(check => check.status === 'NOT_RUN'));
  }
});

test('invalid field input remains FAIL even if the candidate archive is unavailable', t => {
  const data = fixture(t);
  fs.unlinkSync(data.archivePath);
  fs.writeFileSync(data.fieldEvidencePath, '{bad json');
  const malformed = planYandexFieldTests(data);
  assert.equal(malformed.localStatus, 'BLOCKED');
  assert.deepEqual(malformed.fieldEvidenceGate, { status: 'FAIL', reasonCode: 'FIELD_JSON_INVALID' });
  assert.equal(malformed.status, 'FAIL');

  fs.writeFileSync(data.fieldEvidencePath, JSON.stringify({ ...data.field, source: 'HOST_OBSERVED' }));
  assert.equal(planYandexFieldTests(data).status, 'FAIL');

  data.saveField();
  const validButUnbound = planYandexFieldTests(data);
  assert.equal(validButUnbound.status, 'BLOCKED');
  assert.deepEqual(validButUnbound.fieldEvidenceGate,
    { status: 'BLOCKED', reasonCode: 'ARCHIVE_DEPENDENCY_UNAVAILABLE' });
});

test('missing explicitly supplied field evidence is BLOCKED and symlink evidence is FAIL', t => {
  const data = fixture(t);
  assert.equal(planYandexFieldTests({ ...data, fieldEvidencePath: undefined }).fieldEvidenceGate.status, 'NOT_RUN');
  const missing = planYandexFieldTests({ ...data, fieldEvidencePath: path.join(data.folder, 'missing.json') });
  assert.equal(missing.status, 'BLOCKED');
  assert.equal(missing.fieldEvidenceGate.status, 'BLOCKED');
  data.saveField();
  const link = path.join(data.folder, 'field-link.json');
  try { fs.symlinkSync(data.fieldEvidencePath, link); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
  assert.equal(planYandexFieldTests({ ...data, fieldEvidencePath: link }).status, 'FAIL');
});

test('R1 BLOCKED and FAIL propagate and cannot become READY_FOR_FIELD_TEST', t => {
  const data = fixture(t);
  fs.unlinkSync(data.sdkEvidencePath);
  assert.equal(planYandexFieldTests(data).status, 'BLOCKED');
  fs.appendFileSync(data.archivePath, 'tampered');
  assert.equal(planYandexFieldTests(data).status, 'FAIL');
});
