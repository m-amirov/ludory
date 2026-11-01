import { inspectYandexArchive, inspectVkArchive, readRegularBytes, sha256 } from './archive.mjs';
import { checkYandexRelease } from './check.mjs';
import { checkVkCandidate } from './vk-check.mjs';
import { inspectModerationEvidence } from './moderation-evidence.mjs';
import { getModerationRulePack } from './moderation-rules.mjs';
import { ReleaseInputError } from './errors.mjs';

const pending = Object.freeze({
  'browser-observation': 'BROWSER_NOT_RUN',
  'visual-ux': 'VISUAL_REVIEW_NOT_RUN',
  'content-review': 'CONTENT_REVIEW_NOT_RUN',
  'promo-review': 'PROMO_REVIEW_NOT_RUN',
});

const blocked = reasonCode => ({ status: 'BLOCKED', reasonCode });
const passed = reasonCode => ({ status: 'PASS', reasonCode });
const failed = reasonCode => ({ status: 'FAIL', reasonCode });
const localGate = (report, id) => report.gates.find(gate => gate.id === id) ?? blocked('LOCAL_GATE_UNAVAILABLE');
function withSnapshotDigest(gate, filename) {
  if (gate.status !== 'PASS') return gate;
  try {
    return { ...gate, evidenceSha256: sha256(readRegularBytes(filename, 1024 * 1024)) };
  } catch (error) {
    return failed(error instanceof ReleaseInputError ? error.code : 'QA_EVIDENCE_SNAPSHOT_FAILED');
  }
}

/** Evaluate only verifiable local evidence. Browser and independent review are future P3 slices. */
export function simulateModeration({ target, archivePath, receiptPath, sdkEvidencePath,
  rightsPath, metadataPath, promoRoot } = {}) {
  const rulePack = getModerationRulePack(target);
  const local = target === 'yandex-games'
    ? checkYandexRelease({ archivePath, receiptPath, sdkEvidencePath, rightsPath })
    : checkVkCandidate({ archivePath, receiptPath });

  let archive;
  let archiveVerification = localGate(local, 'archive');
  try {
    archive = target === 'yandex-games' ? inspectYandexArchive(archivePath) : inspectVkArchive(archivePath);
    if (local.candidateSha256 !== archive.sha256) {
      archive = undefined;
      archiveVerification = failed('QA_ARCHIVE_CHANGED_BETWEEN_CHECKS');
    }
  } catch (error) {
    archive = undefined;
    // An absent candidate is missing evidence, not a demonstrated moderation defect.
    // Preserve the first reader's BLOCKED result; a ZIP lost after an initial PASS is a race/failure.
    if (!(archiveVerification.status === 'BLOCKED' && archiveVerification.reasonCode === 'INPUT_MISSING' &&
        error instanceof ReleaseInputError && error.code === 'INPUT_MISSING')) {
      archiveVerification = failed(error instanceof ReleaseInputError ? error.code : 'QA_ARCHIVE_REINSPECTION_FAILED');
    }
  }

  const stable = archive && archiveVerification.status === 'PASS';
  const candidateSha256 = stable ? archive.sha256 : null;
  const data = stable
    ? inspectModerationEvidence({ target, candidateSha256, projectId: archive.projectId,
      projectVersion: archive.projectVersion,
      metadataPath, promoRoot, rightsPath, mediaFiles: archive.mediaFiles })
    : null;
  const localReceipt = stable ? withSnapshotDigest(localGate(local, 'build-receipt'), receiptPath)
    : blocked('ARCHIVE_DEPENDENCY_UNAVAILABLE');
  const rows = new Map([
    ['archive', archiveVerification],
    ['build-receipt', localReceipt],
    [target === 'yandex-games' ? 'sdk-contract' : 'bridge-contract', target === 'yandex-games'
      ? (stable ? withSnapshotDigest(localGate(local, 'sdk-contract'), sdkEvidencePath)
        : blocked('ARCHIVE_DEPENDENCY_UNAVAILABLE'))
      : (stable ? { ...passed('LOCAL_VK_BRIDGE_PRESENT_IN_ARCHIVE'), evidenceSha256: candidateSha256 }
        : blocked('ARCHIVE_DEPENDENCY_UNAVAILABLE'))],
    ['media-declarations', !stable ? blocked('ARCHIVE_DEPENDENCY_UNAVAILABLE')
      : target === 'yandex-games' ? withSnapshotDigest(localGate(local, 'rights-declarations'), rightsPath)
        : data.media],
    ['listing-metadata', data?.listing ?? blocked('ARCHIVE_DEPENDENCY_UNAVAILABLE')],
    ['promo-integrity', data?.promo ?? blocked('ARCHIVE_DEPENDENCY_UNAVAILABLE')],
    ...Object.entries(pending).map(([id, reason]) => [id, blocked(reason)]),
    ['platform-policy', blocked(target === 'vk-games' ? 'POLICY_SOURCE_UNVERIFIED' : 'LIVE_PLATFORM_NOT_RUN')],
  ]);
  const checks = rulePack.rules.map(rule => {
    const result = rows.get(rule.id) ?? blocked('QA_RULE_UNIMPLEMENTED');
    return { id: rule.id, status: result.status, reasonCode: result.reasonCode,
      severity: rule.severity,
      ...(result.evidenceSha256 ? { evidenceSha256: result.evidenceSha256 } : {}),
      ...(rule.id === 'archive' && candidateSha256 ? { evidenceSha256: candidateSha256 } : {}) };
  });
  const findings = checks.filter(check => check.status === 'FAIL').map(({ id, severity, reasonCode }) =>
    ({ id, severity, reasonCode }));
  const unverifiedScopes = checks.filter(check => check.status === 'BLOCKED' || check.status === 'NOT_RUN')
    .map(check => check.id);
  return {
    schemaVersion: 1, kind: 'moderation-simulation', target, candidateSha256,
    rulePack: { revision: rulePack.revision, sources: rulePack.sources },
    status: findings.some(item => item.severity === 'P0' || item.severity === 'P1')
      ? 'ISSUES_FOUND' : unverifiedScopes.length ? 'BLOCKED' : 'PRECHECK_CLEAR',
    checks, findings, unverifiedScopes,
    reviewProvenance: 'NOT_RUN', actualModeration: 'NOT_RUN',
    releaseReady: false, publicationAllowed: false,
  };
}
