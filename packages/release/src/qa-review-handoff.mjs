import path from 'node:path';
import { readRegularBytes, SHA_256, sha256 } from './archive.mjs';
import { simulateModeration } from './moderation-simulation.mjs';
import { verifyQaCaptureIntegrity } from './qa-evidence.mjs';
import { ReleaseInputError } from './errors.mjs';

const captures = Object.freeze(['desktop-1000x720', 'mobile-390x844', 'landscape-667x375']);
const rubric = Object.freeze([
  Object.freeze({ id: 'visual-ux', severity: 'P0_P1_P2', method: 'INSPECT_ORIGINAL_SCREENSHOT_PIXELS' }),
  Object.freeze({ id: 'content-review', severity: 'P0_P1_P2', method: 'COMPARE_VISIBLE_SCENE_AND_DECLARED_LISTING' }),
  Object.freeze({ id: 'promo-review', severity: 'P0_P1_P2', method: 'INSPECT_ORIGINAL_ICON_AND_COVER_PIXELS' }),
]);
const stop = (status, reasonCode, target, candidateSha256 = null) => Object.freeze({
  schemaVersion: 1, kind: 'qa-review-handoff', status, reasonCode,
  target: target ?? null, candidateSha256, packet: null,
  browserAttested: false, reviewProvenance: 'NOT_RUN',
  actualModeration: 'NOT_RUN', releaseReady: false, publicationAllowed: false,
});
const gate = (report, name) => report.checks.find(row => row.id === name);
const safePromo = value => typeof value === 'string' && value.length > 0 &&
  !value.includes('\\') && !value.includes(':') && !value.includes('\0') &&
  !path.isAbsolute(value) &&
  value.split('/').every(segment => segment && segment !== '.' && segment !== '..') &&
  /\.(?:png|jpe?g|webp)$/i.test(value);

/** Prepare evidence references and an immutable reviewer rubric. This NEVER
 * opens a browser, sends any bytes to Web DEV, or accepts a reviewer receipt.
 * The returned path references must be attached as actual files by an
 * independently authorized, image-capable reviewer workflow. */
export function prepareQaReviewPacket({
  target, archivePath, receiptPath, sdkEvidencePath, rightsPath,
  metadataPath, promoRoot, evidenceDir, reportSha256,
} = {}) {
  let local;
  try {
    local = simulateModeration({ target, archivePath, receiptPath,
      sdkEvidencePath, rightsPath, metadataPath, promoRoot });
  } catch (error) {
    return stop('BLOCKED', error instanceof ReleaseInputError ? error.code : 'QA_REVIEW_INPUT_UNAVAILABLE', target);
  }
  const candidate = local.candidateSha256;
  if (!candidate || gate(local, 'archive')?.status !== 'PASS' ||
      gate(local, 'build-receipt')?.status !== 'PASS') {
    return stop('BLOCKED', 'QA_REVIEW_CANDIDATE_UNVERIFIED', target);
  }
  for (const name of ['listing-metadata', 'promo-integrity']) {
    const check = gate(local, name);
    if (check?.status !== 'PASS') {
      return stop(check?.status === 'FAIL' ? 'ISSUES_FOUND' : 'BLOCKED',
        check?.reasonCode ?? 'QA_REVIEW_METADATA_REQUIRED', target, candidate);
    }
  }
  const integrity = verifyQaCaptureIntegrity({ evidenceDir, target,
    candidateSha256: candidate, reportSha256 });
  if (integrity.status !== 'INTEGRITY_VERIFIED') {
    return stop(integrity.status === 'FAIL' ? 'ISSUES_FOUND' : 'BLOCKED',
      integrity.reasonCode ?? 'QA_REVIEW_CAPTURE_UNAVAILABLE', target, candidate);
  }
  // A packet with missing browser frames is not ready for pixel inspection.
  if (integrity.screenshots.length !== captures.length ||
      integrity.observedCaptureStatus === 'BLOCKED') {
    return stop('BLOCKED', 'QA_REVIEW_CAPTURE_INCOMPLETE', target, candidate);
  }
  let metadata;
  let metadataHash;
  let promoAssets;
  try {
    const raw = readRegularBytes(metadataPath, 1024 * 1024);
    metadataHash = sha256(raw);
    if (metadataHash !== gate(local, 'listing-metadata')?.evidenceSha256) {
      return stop('ISSUES_FOUND', 'QA_REVIEW_METADATA_CHANGED', target, candidate);
    }
    metadata = JSON.parse(raw.toString('utf8'));
    if (metadata.target !== target || metadata.candidateSha256 !== candidate ||
        !Array.isArray(metadata.promo) || metadata.promo.length !== 2) {
      return stop('ISSUES_FOUND', 'QA_REVIEW_METADATA_CHANGED', target, candidate);
    }
    const hashes = [];
    promoAssets = metadata.promo.map(item => {
      if (!['icon', 'cover'].includes(item.kind) || !safePromo(item.path) ||
          !SHA_256.test(item.sha256 ?? '')) {
        throw new ReleaseInputError('QA_REVIEW_PROMO_CHANGED', 'Invalid promo reference');
      }
      const file = path.resolve(promoRoot, ...item.path.split('/'));
      const bytes = readRegularBytes(file, 10 * 1024 * 1024);
      const digest = sha256(bytes);
      if (digest !== item.sha256) {
        throw new ReleaseInputError('QA_REVIEW_PROMO_CHANGED', 'Promo changed after QA verification');
      }
      hashes.push(digest);
      return Object.freeze({ kind: item.kind, file, sha256: digest, observation: 'PIXELS_NOT_REVIEWED' });
    });
    if (new Set(promoAssets.map(item => item.kind)).size !== 2 ||
        sha256([metadataHash, ...hashes].join(':')) !== gate(local, 'promo-integrity')?.evidenceSha256) {
      throw new ReleaseInputError('QA_REVIEW_PROMO_CHANGED', 'Promo inventory changed after QA');
    }
  } catch (error) {
    return stop(error instanceof ReleaseInputError && error.code === 'INPUT_MISSING' ? 'BLOCKED' : 'ISSUES_FOUND',
      error instanceof ReleaseInputError ? error.code : 'QA_REVIEW_SNAPSHOT_FAILED', target, candidate);
  }
  const screenshots = integrity.screenshots.map((item, index) => {
    if (item.id !== captures[index]) return null;
    return Object.freeze({ caseId: item.id, file: path.resolve(evidenceDir, item.id + '.png'),
      sha256: item.sha256, width: item.width, height: item.height,
      observation: 'PIXELS_NOT_REVIEWED' });
  });
  if (screenshots.some(item => !item)) return stop('ISSUES_FOUND', 'QA_REVIEW_SCREENSHOT_ORDER_INVALID', target, candidate);

  return Object.freeze({
    schemaVersion: 1, kind: 'qa-review-handoff', status: 'READY_FOR_HANDOFF',
    target, candidateSha256: candidate,
    packet: Object.freeze({
      rulePack: local.rulePack,
      captureReportSha256: integrity.reportSha256, captureStatus: integrity.observedCaptureStatus,
      screenshotInputs: Object.freeze(screenshots),
      promoInputs: Object.freeze(promoAssets),
      metadata: Object.freeze({ sha256: metadataHash, source: 'USER_DECLARED',
        listing: metadata.listing, content: metadata.content }),
      technicalFindings: Object.freeze(local.findings),
      rubric,
      reviewerRoute: 'INDEPENDENT_IMAGE_CAPABLE_WEB_DEV',
      reviewerModel: 'chatgpt-web/gpt-6-sol-instant',
      reviewerEffort: 'low',
      transfer: 'NOT_SENT',
      review: 'NOT_RUN',
      provenance: 'LOCAL_BYTES_ONLY',
      warning: 'Reviewer must receive and inspect original screenshot and promo image bytes; paths/hashes/text do not attest visual inspection',
    }),
    browserAttested: false, reviewProvenance: 'NOT_RUN',
    actualModeration: 'NOT_RUN', releaseReady: false, publicationAllowed: false,
  });
}
