import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { simulateModeration } from '../src/index.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const variants = [
  ['Chromium desktop', 'chromium', false], ['Firefox desktop', 'firefox', false],
  ['WebKit desktop', 'webkit', false], ['Android Chromium', 'chromium', true],
  ['iPhone WebKit', 'webkit', true],
];

function candidate(t, target) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-simulation-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const manifest = { schemaVersion: 1, id: 'sample-story', version: '1.0.0',
    title: { en: 'Story' }, engine: 'web', targets: [target] };
  const entries = {
    'index.html': '<html><body>Story</body></html>',
    'ludory.project.json': JSON.stringify(manifest),
    'src/main.js': 'console.log("story")',
    'assets/story.png': 'image-owned',
    ...(target === 'yandex-games'
      ? { 'assets/ludory-yandex.js': '// local yandex bridge' }
      : { 'assets/ludory-vk.js': '// local vk runtime', 'assets/vk-bridge.js': '// local bridge',
        'licenses/swc-helpers.txt': 'license', 'licenses/vk-bridge.txt': 'license' }),
  };
  const bytes = Buffer.from(zipSync(Object.fromEntries(Object.entries(entries)
    .map(([name, content]) => [name, new Uint8Array(Buffer.from(content))])), { level: 0 }));
  const archivePath = path.join(folder, 'candidate.zip');
  const receiptPath = path.join(folder, 'receipt.json');
  const sdkEvidencePath = path.join(folder, 'sdk.json');
  const rightsPath = path.join(folder, 'rights.json');
  fs.writeFileSync(archivePath, bytes);
  const candidateSha256 = sha(bytes);
  const receipt = { archivePath, sha256: candidateSha256, files: Object.entries(entries)
    .map(([name, content]) => ({ path: name, sha256: sha(content), size: Buffer.byteLength(content) })) };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  fs.writeFileSync(sdkEvidencePath, JSON.stringify({ schemaVersion: 1, stage: 'Connect Yandex C5',
    candidateSha256, sdk: 'fake /sdk.js served only by fixture', verdict: 'SDK_CONTRACT_PASS',
    liveYandex: 'YANDEX_LIVE_NOT_RUN', physicalDevices: 'NOT_RUN',
    results: variants.map(([browser, engine, emulated]) => ({ browser, engine, emulated,
      phase: 'complete', status: 'SDK_CONTRACT_PASS' })) }));
  fs.writeFileSync(rightsPath, JSON.stringify({ schemaVersion: 1, target, candidateSha256,
    assets: [{ path: 'assets/story.png', sha256: sha('image-owned'), provenance: 'owned',
      evidence: 'Original illustration source' }] }));
  return { folder, target, archivePath, receiptPath, sdkEvidencePath, rightsPath,
    candidateSha256, receipt };
}

const check = (report, id) => report.checks.find(row => row.id === id);

test('Yandex local C5 PASS yields a blocked simulation, never official moderation acceptance', t => {
  const data = candidate(t, 'yandex-games');
  const before = fs.readdirSync(data.folder).sort();
  const result = simulateModeration(data);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, 'moderation-simulation');
  assert.equal(result.target, 'yandex-games');
  assert.equal(result.candidateSha256, data.candidateSha256);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.rulePack.revision, '2026-11-01-p3a');
  assert.equal(check(result, 'archive').status, 'PASS');
  assert.equal(check(result, 'build-receipt').status, 'PASS');
  assert.equal(check(result, 'build-receipt').evidenceSha256, sha(fs.readFileSync(data.receiptPath)));
  assert.equal(check(result, 'sdk-contract').status, 'PASS');
  assert.equal(check(result, 'sdk-contract').evidenceSha256, sha(fs.readFileSync(data.sdkEvidencePath)));
  assert.equal(check(result, 'media-declarations').status, 'PASS');
  assert.equal(check(result, 'media-declarations').evidenceSha256, sha(fs.readFileSync(data.rightsPath)));
  assert.equal(check(result, 'browser-observation').reasonCode, 'BROWSER_NOT_RUN');
  assert.equal(check(result, 'visual-ux').status, 'BLOCKED');
  assert.equal(check(result, 'content-review').status, 'BLOCKED');
  assert.ok(result.unverifiedScopes.includes('promo-review'));
  assert.equal(result.reviewProvenance, 'NOT_RUN');
  assert.equal(result.actualModeration, 'NOT_RUN');
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  assert.deepEqual(fs.readdirSync(data.folder).sort(), before);
});

test('VK local archive and Bridge stay distinct from unverified VK policy and real SDK', t => {
  const data = candidate(t, 'vk-games');
  const result = simulateModeration({ ...data, rightsPath: undefined });
  assert.equal(result.candidateSha256, data.candidateSha256);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(check(result, 'bridge-contract').status, 'PASS');
  assert.equal(check(result, 'media-declarations').status, 'BLOCKED');
  assert.equal(check(result, 'platform-policy').reasonCode, 'POLICY_SOURCE_UNVERIFIED');
  assert.ok(!result.checks.some(row => row.id === 'sdk-contract'));
  assert.ok(result.rulePack.sources.some(source => source.verified === false));
});

test('VK listing and promo evidence bind to actual ZIP version and preserve source digests', t => {
  const data = candidate(t, 'vk-games');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', 'base64');
  const metadataPath = path.join(data.folder, 'metadata.json');
  const promoRoot = path.join(data.folder, 'promo');
  fs.mkdirSync(promoRoot);
  fs.writeFileSync(path.join(promoRoot, 'icon.png'), image);
  fs.writeFileSync(path.join(promoRoot, 'cover.png'), image);
  const metadata = {
    schemaVersion: 1, target: 'vk-games', candidateSha256: data.candidateSha256, projectId: 'sample-story',
    listing: { name: 'Story', description: 'A story', howToPlay: 'Choose an answer',
      category: 'novel', version: '1.0.0', platforms: ['desktop', 'mobile'], orientation: 'portrait' },
    content: { ageRating: '12+', contentWarnings: [] },
    promo: [
      { kind: 'icon', path: 'icon.png', sha256: sha(image) },
      { kind: 'cover', path: 'cover.png', sha256: sha(image) },
    ],
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  let report = simulateModeration({ ...data, metadataPath, promoRoot });
  assert.equal(check(report, 'listing-metadata').status, 'PASS');
  assert.equal(check(report, 'promo-integrity').status, 'PASS');
  assert.equal(check(report, 'listing-metadata').evidenceSha256, sha(fs.readFileSync(metadataPath)));
  assert.equal(check(report, 'promo-integrity').evidenceSha256,
    sha(`${sha(fs.readFileSync(metadataPath))}:${sha(image)}:${sha(image)}`));
  assert.equal(check(report, 'media-declarations').evidenceSha256, sha(fs.readFileSync(data.rightsPath)));
  assert.equal(report.status, 'BLOCKED');
  metadata.listing.version = '9.0.0';
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  report = simulateModeration({ ...data, metadataPath, promoRoot });
  assert.equal(check(report, 'listing-metadata').reasonCode, 'QA_LISTING_VERSION_MISMATCH');
  assert.equal(report.status, 'ISSUES_FOUND');
});

test('tampered ZIP or receipt yields actionable P1 issue while other reviews stay blocked', t => {
  const data = candidate(t, 'yandex-games');
  data.receipt.sha256 = '0'.repeat(64);
  fs.writeFileSync(data.receiptPath, JSON.stringify(data.receipt));
  let result = simulateModeration(data);
  assert.equal(result.status, 'ISSUES_FOUND');
  assert.equal(check(result, 'build-receipt').status, 'FAIL');
  assert.ok(result.findings.some(item => item.id === 'build-receipt' && item.severity === 'P1'));
  assert.equal(check(result, 'content-review').status, 'BLOCKED');
  fs.appendFileSync(data.archivePath, 'corruption');
  result = simulateModeration(data);
  assert.equal(result.status, 'ISSUES_FOUND');
  assert.equal(check(result, 'archive').status, 'FAIL');
  assert.equal(check(result, 'build-receipt').status, 'BLOCKED');
  assert.equal(result.candidateSha256, null);
});

test('forged Web/Machine observation metadata cannot turn reviews into PASS', t => {
  const data = candidate(t, 'vk-games');
  const metadataPath = path.join(data.folder, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify({ schemaVersion: 1, target: 'vk-games',
    candidateSha256: data.candidateSha256, projectId: 'sample-story',
    MACHINE_OBSERVED: true, WEB_REVIEWED: 'PASS', listing: {} }));
  const result = simulateModeration({ ...data, metadataPath });
  assert.equal(result.status, 'ISSUES_FOUND');
  assert.equal(check(result, 'listing-metadata').status, 'FAIL');
  assert.equal(check(result, 'browser-observation').status, 'BLOCKED');
  assert.equal(check(result, 'visual-ux').status, 'BLOCKED');
  assert.equal(result.releaseReady, false);
});

test('check order and report status remain stable for exactly the same candidate bytes', t => {
  const data = candidate(t, 'vk-games');
  const one = simulateModeration(data);
  const two = simulateModeration(data);
  assert.deepEqual(one, two);
  assert.deepEqual(one.checks.map(item => item.id), [
    'archive', 'build-receipt', 'bridge-contract', 'media-declarations', 'listing-metadata',
    'promo-integrity', 'browser-observation', 'visual-ux', 'content-review', 'promo-review', 'platform-policy',
  ]);
});

test('a candidate rewritten between local inspection boundaries must never mix ZIP identities', t => {
  const data = candidate(t, 'vk-games');
  const original = fs.openSync;
  let zipOpens = 0;
  try {
    fs.openSync = function(filename, ...args) {
      if (filename === data.archivePath && ++zipOpens === 2) fs.appendFileSync(data.archivePath, 'changed while checked');
      return original.call(this, filename, ...args);
    };
    const result = simulateModeration(data);
    assert.equal(result.status, 'ISSUES_FOUND');
    assert.equal(check(result, 'archive').status, 'FAIL');
    assert.equal(result.releaseReady, false);
  } finally { fs.openSync = original; }
});
