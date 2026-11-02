import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

export const qaHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const qaPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', 'base64');
export const qaCases = ['desktop-1000x720', 'mobile-390x844', 'landscape-667x375'];

export function makeQaReviewFixture(t, target = 'yandex-games') {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-p3c-web-review-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const entries = {
    'index.html': '<html><body>Story</body></html>',
    'ludory.project.json': JSON.stringify({ schemaVersion: 1, id: 'review-story', version: '1.0.0',
      title: { en: 'Story' }, engine: 'web', targets: [target] }),
    'src/main.js': 'console.log("story")',
    ...(target === 'yandex-games' ? { 'assets/ludory-yandex.js': '// adapter' } : {
      'assets/ludory-vk.js': '// adapter', 'assets/vk-bridge.js': '// bridge',
      'licenses/swc-helpers.txt': 'license', 'licenses/vk-bridge.txt': 'license',
    }),
  };
  const archive = Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) =>
    [name, new Uint8Array(Buffer.from(value))])), { level: 0 }));
  const archivePath = path.join(folder, 'candidate.zip');
  const receiptPath = path.join(folder, 'receipt.json');
  const metadataPath = path.join(folder, 'metadata.json');
  const sdkEvidencePath = path.join(folder, 'sdk.json');
  const rightsPath = path.join(folder, 'rights.json');
  const promoRoot = path.join(folder, 'promo');
  const evidenceDir = path.join(folder, 'evidence');
  const outputDir = path.join(folder, 'review-record');
  fs.mkdirSync(promoRoot);
  fs.mkdirSync(evidenceDir);
  const candidateSha256 = qaHash(archive);
  fs.writeFileSync(archivePath, archive);
  fs.writeFileSync(receiptPath, JSON.stringify({ archivePath, sha256: candidateSha256,
    files: Object.entries(entries).map(([name, value]) => ({ path: name, sha256: qaHash(value), size: Buffer.byteLength(value) })) }));
  const variants = [
    ['Chromium desktop', 'chromium', false], ['Firefox desktop', 'firefox', false],
    ['WebKit desktop', 'webkit', false], ['Android Chromium', 'chromium', true],
    ['iPhone WebKit', 'webkit', true],
  ];
  fs.writeFileSync(sdkEvidencePath, JSON.stringify({ schemaVersion: 1, stage: 'Connect Yandex C5',
    candidateSha256, sdk: 'fake /sdk.js served only by fixture', verdict: 'SDK_CONTRACT_PASS',
    liveYandex: 'YANDEX_LIVE_NOT_RUN', physicalDevices: 'NOT_RUN',
    results: variants.map(([browser, engine, emulated]) => ({ browser, engine, emulated,
      phase: 'complete', status: 'SDK_CONTRACT_PASS' })) }));
  fs.writeFileSync(rightsPath, JSON.stringify({ schemaVersion: 1, target, candidateSha256, assets: [] }));
  fs.writeFileSync(metadataPath, JSON.stringify({ schemaVersion: 1, target, candidateSha256, projectId: 'review-story',
    listing: { name: 'Review Story', description: 'A story', howToPlay: 'Choose',
      category: 'narrative', version: '1.0.0', platforms: ['desktop', 'mobile'], orientation: 'portrait' },
    content: { ageRating: '12+', contentWarnings: [] },
    promo: [{ kind: 'icon', path: 'icon.png', sha256: qaHash(qaPng) },
      { kind: 'cover', path: 'cover.png', sha256: qaHash(qaPng) }],
  }));
  fs.writeFileSync(path.join(promoRoot, 'icon.png'), qaPng);
  fs.writeFileSync(path.join(promoRoot, 'cover.png'), qaPng);
  const capture = { schemaVersion: 1, kind: 'qa-browser-capture', status: 'STARTUP_OBSERVED',
    target, candidateSha256, engine: 'chromium', browserVersion: 'smoke', flowSha256: null,
    observedScope: 'STARTUP_ONLY', sdk: 'LIVE_NOT_TESTED', physicalDevices: 'NOT_RUN',
    actualModeration: 'NOT_RUN', releaseReady: false, publicationAllowed: false,
    cases: qaCases.map(id => ({ id, status: 'STARTUP_OBSERVED',
      screenshot: { file: `${id}.png`, sha256: qaHash(qaPng), width: 1, height: 1 } })) };
  for (const id of qaCases) fs.writeFileSync(path.join(evidenceDir, `${id}.png`), qaPng);
  fs.writeFileSync(path.join(evidenceDir, 'capture.json'), JSON.stringify(capture));
  return { folder, target, archivePath, receiptPath, sdkEvidencePath, rightsPath,
    metadataPath, promoRoot, evidenceDir, outputDir, candidateSha256 };
}

export function qaObservedResponse(image, traceId, verdict = 'NO_ISSUES') {
  return { status: 'HOST_OBSERVED', routeObserved: 'web-dev', modelObserved: 'gpt-6-sol-instant',
    imageInputObserved: true, imageRef: image.ref, imageSha256: image.sha256,
    imageBytes: image.size, traceId,
    hostObservation: { protocolVersion: 2, source: 'browser-ui', selectedModel: 'gpt-6-sol-instant',
      reasoning: 'low', traceId, image: { ref: image.ref, sha256: image.sha256, bytes: image.size },
      upload: { creationRequestObserved: true, processingRequestObserved: true,
        processingRequestKind: 'process_upload_stream', processingEvent: 'file.processing.completed',
        processingCompleted: true, visibleAttachmentChip: true } },
    text: JSON.stringify({ schemaVersion: 1, imageSha256: image.sha256, imageVisible: true,
      verdict, summary: 'Image checked', findings: [] }) };
}
