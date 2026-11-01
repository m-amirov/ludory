import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectModerationEvidence } from '../src/moderation-evidence.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', 'base64');

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-evidence-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const promoRoot = path.join(folder, 'promo');
  fs.mkdirSync(promoRoot);
  fs.writeFileSync(path.join(promoRoot, 'icon.png'), image);
  fs.writeFileSync(path.join(promoRoot, 'cover.png'), image);
  const metadataPath = path.join(folder, 'metadata.json');
  const rightsPath = path.join(folder, 'rights.json');
  const candidateSha256 = 'a'.repeat(64);
  const mediaFiles = [{ path: 'assets/story.png', sha256: digest(image), size: image.length }];
  const metadata = {
    schemaVersion: 1, target: 'vk-games', candidateSha256, projectId: 'story-game',
    listing: { name: 'Story Game', description: 'Interactive visual novel',
      howToPlay: 'Choose one of the available answers.', category: 'interactive-fiction',
      version: '1.0.0', platforms: ['desktop', 'mobile'], orientation: 'portrait' },
    content: { ageRating: '12+', contentWarnings: ['mild suspense'] },
    promo: [
      { kind: 'icon', path: 'icon.png', sha256: digest(image) },
      { kind: 'cover', path: 'cover.png', sha256: digest(image) },
    ],
  };
  const rights = {
    schemaVersion: 1, target: 'vk-games', candidateSha256,
    assets: [{ path: 'assets/story.png', sha256: digest(image), provenance: 'owned', evidence: 'Original illustration ledger' }],
  };
  const save = () => {
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    fs.writeFileSync(rightsPath, JSON.stringify(rights));
  };
  save();
  return { folder, promoRoot, metadataPath, rightsPath, candidateSha256,
    projectId: 'story-game', projectVersion: '1.0.0', target: 'vk-games', mediaFiles, metadata, rights, save };
}

test('real source-bound listing, promo bytes and shipped VK media declarations pass local integrity only', t => {
  const data = fixture(t);
  const before = fs.readdirSync(data.folder).sort();
  const result = inspectModerationEvidence(data);
  assert.deepEqual([result.listing.status, result.promo.status, result.media.status], ['PASS', 'PASS', 'PASS']);
  const metadataHash = digest(fs.readFileSync(data.metadataPath));
  assert.equal(result.listing.evidenceSha256, metadataHash);
  assert.equal(result.promo.evidenceSha256, digest(`${metadataHash}:${digest(image)}:${digest(image)}`));
  assert.equal(result.media.evidenceSha256, digest(fs.readFileSync(data.rightsPath)));
  assert.deepEqual(fs.readdirSync(data.folder).sort(), before, 'QA must not write to owner-provided directories');
  const yandex = inspectModerationEvidence({ ...data, target: 'yandex-games', metadataPath: undefined });
  assert.equal(yandex.media.status, 'NOT_APPLICABLE', 'existing Yandex Release rights gate owns Yandex media');
});

test('absent inputs and incomplete declarations block without being called violations', t => {
  const data = fixture(t);
  let result = inspectModerationEvidence({ ...data, metadataPath: undefined, rightsPath: undefined });
  assert.deepEqual([result.listing.status, result.promo.status, result.media.status], ['BLOCKED', 'BLOCKED', 'BLOCKED']);
  data.metadata.listing.howToPlay = '';
  data.metadata.content.contentWarnings = undefined;
  data.save();
  result = inspectModerationEvidence(data);
  assert.equal(result.listing.status, 'BLOCKED');
  data.metadata.listing.howToPlay = 'Choose one answer';
  data.metadata.content.contentWarnings = [];
  data.save();
  fs.unlinkSync(path.join(data.promoRoot, 'icon.png'));
  result = inspectModerationEvidence(data);
  assert.equal(result.promo.status, 'BLOCKED');
});

test('mismatched candidate identity, duplicate JSON keys and forged observation fields fail closed', t => {
  const data = fixture(t);
  data.metadata.candidateSha256 = 'f'.repeat(64);
  data.save();
  assert.equal(inspectModerationEvidence(data).listing.status, 'FAIL');
  data.metadata.candidateSha256 = data.candidateSha256;
  data.metadata.MACHINE_OBSERVED = true;
  data.save();
  assert.equal(inspectModerationEvidence(data).listing.status, 'FAIL');
  delete data.metadata.MACHINE_OBSERVED;
  data.save();
  const original = fs.readFileSync(data.metadataPath, 'utf8');
  fs.writeFileSync(data.metadataPath, original.replace('"projectId":', '"projectId":"spoof","projectId":'));
  assert.equal(inspectModerationEvidence(data).listing.status, 'FAIL');
  fs.writeFileSync(data.metadataPath, original.replace('"projectId":', '"\\u0070rojectId":"spoof","projectId":'));
  assert.equal(inspectModerationEvidence(data).listing.status, 'FAIL', 'escaped key alias must be recognized as duplicate');
  data.save();
  data.metadata.content.contentWarnings = [42];
  data.save();
  assert.equal(inspectModerationEvidence(data).listing.status, 'FAIL');
});

test('promo traversal, symlinked files and modified bytes cannot receive local PASS', t => {
  const data = fixture(t);
  data.metadata.promo[0].path = '../metadata.json';
  data.save();
  assert.equal(inspectModerationEvidence(data).promo.status, 'FAIL');
  data.metadata.promo[0].path = 'icon.png';
  data.save();
  fs.writeFileSync(path.join(data.promoRoot, 'icon.png'), Buffer.concat([image, Buffer.from('edited')]));
  assert.equal(inspectModerationEvidence(data).promo.status, 'FAIL');
  fs.unlinkSync(path.join(data.promoRoot, 'icon.png'));
  try { fs.symlinkSync(path.join(data.promoRoot, 'cover.png'), path.join(data.promoRoot, 'icon.png')); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
  assert.equal(inspectModerationEvidence(data).promo.status, 'FAIL');
});

test('linked promotion root is not followed even when the referenced image itself is regular', t => {
  const data = fixture(t);
  const linkedRoot = path.join(data.folder, 'promo-link');
  try { fs.symlinkSync(data.promoRoot, linkedRoot, 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
  assert.equal(inspectModerationEvidence({ ...data, promoRoot: linkedRoot }).promo.status, 'FAIL');
});

test('VK media declarations require exact shipped hashes and cannot use symlinked evidence', t => {
  const data = fixture(t);
  data.rights.assets = [];
  data.save();
  assert.equal(inspectModerationEvidence(data).media.status, 'BLOCKED');
  data.rights.assets.push({ path: 'assets/story.png', sha256: '0'.repeat(64),
    provenance: 'owned', evidence: 'Original illustration ledger' });
  data.save();
  assert.equal(inspectModerationEvidence(data).media.status, 'FAIL');
  data.rights.assets[0].sha256 = data.mediaFiles[0].sha256;
  data.rights.assets[0].provenance = 'unverified';
  data.save();
  assert.equal(inspectModerationEvidence(data).media.status, 'FAIL', 'invalid provenance is not merely missing evidence');
  data.rights.assets[0].provenance = 'owned';
  data.rights.target = 'yandex-games';
  data.save();
  assert.equal(inspectModerationEvidence(data).media.status, 'FAIL');
  data.rights.target = 'vk-games';
  data.save();
  const link = path.join(data.folder, 'rights-link.json');
  try { fs.symlinkSync(data.rightsPath, link); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
  assert.equal(inspectModerationEvidence({ ...data, rightsPath: link }).media.status, 'FAIL');
});

test('an incomplete listing does not mask a separately verifiable tampered promo image', t => {
  const data = fixture(t);
  data.metadata.listing.description = '';
  data.save();
  fs.writeFileSync(path.join(data.promoRoot, 'icon.png'), Buffer.concat([image, Buffer.from('tampered')]));
  const result = inspectModerationEvidence(data);
  assert.equal(result.listing.status, 'BLOCKED');
  assert.equal(result.promo.status, 'FAIL');
});

test('a truncated or non-decodable image with a matching declared SHA is not accepted as valid promo', t => {
  const data = fixture(t);
  const truncated = image.subarray(0, 29);
  fs.writeFileSync(path.join(data.promoRoot, 'cover.png'), truncated);
  data.metadata.promo[1].sha256 = digest(truncated);
  data.save();
  const result = inspectModerationEvidence(data);
  assert.equal(result.listing.status, 'PASS');
  assert.equal(result.promo.status, 'FAIL');
  assert.equal(result.promo.reasonCode, 'QA_PROMO_FILE_MISMATCH');
});

test('malformed provided promo/VK declarations take precedence over absent second items', t => {
  const data = fixture(t);
  data.metadata.promo = [{ kind: 'icon', path: '../unsafe.png', sha256: 'bad' }];
  data.rights.assets = [{ path: 'assets/story.png', sha256: '0'.repeat(64),
    provenance: 'owned', evidence: 'Illustration' }];
  data.mediaFiles.push({ path: 'assets/other.png', sha256: digest('second'), size: 6 });
  data.save();
  const result = inspectModerationEvidence(data);
  assert.equal(result.promo.status, 'FAIL');
  assert.equal(result.media.status, 'FAIL');
  data.metadata.promo = [{ kind: 'icon', path: 'icon.png', sha256: digest(image) }];
  data.rights.assets[0].sha256 = data.mediaFiles[0].sha256;
  data.save();
  const incomplete = inspectModerationEvidence(data);
  assert.equal(incomplete.promo.status, 'BLOCKED');
  assert.equal(incomplete.media.status, 'BLOCKED');
});

test('listing version must agree with the independently inspected ZIP manifest', t => {
  const data = fixture(t);
  data.metadata.listing.version = '9.9.9';
  data.save();
  const result = inspectModerationEvidence(data);
  assert.equal(result.listing.status, 'FAIL');
  assert.equal(result.listing.reasonCode, 'QA_LISTING_VERSION_MISMATCH');
  assert.equal(result.promo.status, 'PASS');
});
