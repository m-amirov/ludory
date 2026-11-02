import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { prepareQaReviewPacket } from '../src/index.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', 'base64');
const cases = ['desktop-1000x720', 'mobile-390x844', 'landscape-667x375'];
const variants = [
  ['Chromium desktop', 'chromium', false], ['Firefox desktop', 'firefox', false],
  ['WebKit desktop', 'webkit', false], ['Android Chromium', 'chromium', true],
  ['iPhone WebKit', 'webkit', true],
];

function fixture(t, target) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-p3c-handoff-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const manifest = { schemaVersion: 1, id: 'review-story', version: '1.0.0',
    title: { en: 'Story' }, engine: 'web', targets: [target] };
  const entries = {
    'index.html': '<html><body>Story</body></html>',
    'ludory.project.json': JSON.stringify(manifest),
    'src/main.js': 'console.log("story")',
    ...(target === 'yandex-games'
      ? { 'assets/ludory-yandex.js': '// adapter' }
      : { 'assets/ludory-vk.js': '// adapter', 'assets/vk-bridge.js': '// bridge',
        'licenses/swc-helpers.txt': 'license', 'licenses/vk-bridge.txt': 'license' }),
  };
  const archive = Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, content]) =>
    [name, new Uint8Array(Buffer.from(content))])), { level: 0 }));
  const archivePath = path.join(folder, 'candidate.zip');
  const receiptPath = path.join(folder, 'receipt.json');
  const metadataPath = path.join(folder, 'metadata.json');
  const sdkEvidencePath = path.join(folder, 'sdk.json');
  const rightsPath = path.join(folder, 'rights.json');
  const promoRoot = path.join(folder, 'promo');
  const evidenceDir = path.join(folder, 'evidence');
  fs.mkdirSync(promoRoot);
  fs.mkdirSync(evidenceDir);
  const candidateSha256 = hash(archive);
  fs.writeFileSync(archivePath, archive);
  fs.writeFileSync(receiptPath, JSON.stringify({ archivePath,
    sha256: candidateSha256,
    files: Object.entries(entries).map(([name, value]) => ({
      path: name, sha256: hash(value), size: Buffer.byteLength(value) })) }));
  fs.writeFileSync(sdkEvidencePath, JSON.stringify({ schemaVersion: 1, stage: 'Connect Yandex C5',
    candidateSha256, sdk: 'fake /sdk.js served only by fixture', verdict: 'SDK_CONTRACT_PASS',
    liveYandex: 'YANDEX_LIVE_NOT_RUN', physicalDevices: 'NOT_RUN',
    results: variants.map(([browser, engine, emulated]) => ({ browser, engine, emulated,
      phase: 'complete', status: 'SDK_CONTRACT_PASS' })) }));
  fs.writeFileSync(rightsPath, JSON.stringify({ schemaVersion: 1, target, candidateSha256, assets: [] }));
  const metadata = { schemaVersion: 1, target, candidateSha256, projectId: 'review-story',
    listing: { name: 'Review Story', description: 'A story', howToPlay: 'Choose',
      category: 'narrative', version: '1.0.0', platforms: ['desktop', 'mobile'], orientation: 'portrait' },
    content: { ageRating: '12+', contentWarnings: [] },
    promo: [{ kind: 'icon', path: 'icon.png', sha256: hash(png) },
      { kind: 'cover', path: 'cover.png', sha256: hash(png) }],
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  fs.writeFileSync(path.join(promoRoot, 'icon.png'), png);
  fs.writeFileSync(path.join(promoRoot, 'cover.png'), png);
  const capture = { schemaVersion: 1, kind: 'qa-browser-capture', status: 'STARTUP_OBSERVED',
    target, candidateSha256, engine: 'chromium', browserVersion: 'smoke',
    flowSha256: null, observedScope: 'STARTUP_ONLY',
    sdk: 'LIVE_NOT_TESTED', physicalDevices: 'NOT_RUN', actualModeration: 'NOT_RUN',
    releaseReady: false, publicationAllowed: false,
    cases: cases.map(id => ({ id, status: 'STARTUP_OBSERVED',
      screenshot: { file: id + '.png', sha256: hash(png), width: 1, height: 1 } })) };
  for (const id of cases) fs.writeFileSync(path.join(evidenceDir, id + '.png'), png);
  fs.writeFileSync(path.join(evidenceDir, 'capture.json'), JSON.stringify(capture));
  return { folder, target, archivePath, receiptPath, metadataPath,
    sdkEvidencePath, rightsPath, promoRoot, evidenceDir, candidateSha256, capture };
}

for (const target of ['vk-games', 'yandex-games']) {
  test('P3c prepares source-bound '+target+' packet with no reviewer authority or filesystem writes', t => {
    const d = fixture(t, target);
    const before = fs.readdirSync(d.folder).sort();
    const result = prepareQaReviewPacket(d);
    assert.equal(result.status, 'READY_FOR_HANDOFF', JSON.stringify(result, null, 2));
    assert.equal(result.candidateSha256, d.candidateSha256);
    assert.equal(result.packet.screenshotInputs.length, 3);
    assert.deepEqual(result.packet.screenshotInputs.map(x => x.caseId), cases);
    assert.ok(result.packet.screenshotInputs.every(x => x.sha256 === hash(png)));
    assert.deepEqual(result.packet.promoInputs.map(x => x.kind), ['icon', 'cover']);
    assert.equal(result.packet.metadata.source, 'USER_DECLARED');
    assert.equal(result.packet.reviewerRoute, 'INDEPENDENT_IMAGE_CAPABLE_WEB_DEV');
    assert.equal(result.packet.transfer, 'NOT_SENT');
    assert.equal(result.packet.review, 'NOT_RUN');
    assert.equal(result.browserAttested, false);
    assert.equal(result.reviewProvenance, 'NOT_RUN');
    assert.equal(result.releaseReady, false);
    assert.equal(result.publicationAllowed, false);
    assert.equal(result.actualModeration, 'NOT_RUN');
    assert.deepEqual(fs.readdirSync(d.folder).sort(), before);
    assert.deepEqual(fs.readFileSync(d.archivePath), fs.readFileSync(d.archivePath));
  });
}

test('P3c refuses screenshot tampering, wrong ZIP identity and missing review image', t => {
  const d = fixture(t, 'vk-games');
  fs.writeFileSync(path.join(d.evidenceDir, cases[0]+'.png'), 'tampered');
  assert.equal(prepareQaReviewPacket(d).status, 'ISSUES_FOUND');
  fs.writeFileSync(path.join(d.evidenceDir, cases[0]+'.png'), png);
  const manifestFile = path.join(d.evidenceDir, 'capture.json');
  d.capture.candidateSha256 = 'a'.repeat(64);
  fs.writeFileSync(manifestFile, JSON.stringify(d.capture));
  assert.equal(prepareQaReviewPacket(d).status, 'ISSUES_FOUND');
  d.capture.candidateSha256 = d.candidateSha256;
  fs.writeFileSync(manifestFile, JSON.stringify(d.capture));
  fs.rmSync(path.join(d.evidenceDir, cases[1]+'.png'));
  assert.equal(prepareQaReviewPacket(d).status, 'BLOCKED');
});

test('P3c blocks incomplete image capture even when capture bytes agree', t => {
  const d = fixture(t, 'yandex-games');
  d.capture.cases[2] = { id: cases[2], status: 'BLOCKED', screenshot: null };
  d.capture.status = 'BLOCKED';
  fs.writeFileSync(path.join(d.evidenceDir, 'capture.json'), JSON.stringify(d.capture));
  const report = prepareQaReviewPacket(d);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.reasonCode, 'QA_REVIEW_CAPTURE_INCOMPLETE');
});

test('P3c rejects wrong listing, altered promo and forged review authority', t => {
  const d = fixture(t, 'vk-games');
  const metadata = JSON.parse(fs.readFileSync(d.metadataPath, 'utf8'));
  metadata.candidateSha256 = 'f'.repeat(64);
  fs.writeFileSync(d.metadataPath, JSON.stringify(metadata));
  assert.equal(prepareQaReviewPacket(d).status, 'ISSUES_FOUND');
  metadata.candidateSha256 = d.candidateSha256;
  metadata.WEB_REVIEWED = 'PASS';
  fs.writeFileSync(d.metadataPath, JSON.stringify(metadata));
  assert.equal(prepareQaReviewPacket(d).status, 'ISSUES_FOUND');
  delete metadata.WEB_REVIEWED;
  fs.writeFileSync(d.metadataPath, JSON.stringify(metadata));
  fs.writeFileSync(path.join(d.promoRoot, 'cover.png'), 'corrupt');
  assert.equal(prepareQaReviewPacket(d).status, 'ISSUES_FOUND');
});
