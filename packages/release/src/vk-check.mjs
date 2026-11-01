import { inspectVkArchive, readRegularBytes } from './archive.mjs';
import { ReleaseInputError } from './errors.mjs';

const fail = (code, message) => { throw new ReleaseInputError(code, message); };
const exact = (object, fields) => object && typeof object === 'object' && !Array.isArray(object) &&
  Object.keys(object).every(key => fields.includes(key)) && fields.every(key => Object.hasOwn(object, key));

function readReceipt(filename) {
  let receipt;
  try { receipt = JSON.parse(readRegularBytes(filename, 1024 * 1024).toString('utf8')); }
  catch (error) {
    if (error instanceof ReleaseInputError) throw error;
    fail('RECEIPT_JSON', `Invalid VK candidate receipt: ${error.message}`);
  }
  if (!exact(receipt, ['archivePath', 'sha256', 'files']) || typeof receipt.archivePath !== 'string') {
    fail('RECEIPT_FORMAT', 'VK candidate receipt has unsupported or missing fields');
  }
  return receipt;
}

function verifyReceipt(receipt, archive) {
  if (receipt.sha256 !== archive.sha256) {
    fail('RECEIPT_CANDIDATE_MISMATCH', 'VK receipt ZIP SHA-256 differs from archive');
  }
  if (!Array.isArray(receipt.files) || receipt.files.length !== archive.files.length) {
    fail('RECEIPT_FILES_MISMATCH', 'VK receipt must list every shipped file');
  }
  const expected = new Map(archive.files.map(file => [file.path, file]));
  const found = new Set();
  for (const file of receipt.files) {
    if (!exact(file, ['path', 'sha256', 'size']) || !expected.has(file.path) || found.has(file.path) ||
        file.sha256 !== expected.get(file.path).sha256 || file.size !== expected.get(file.path).size) {
      fail('RECEIPT_FILES_MISMATCH', 'VK receipt hashes, sizes or file list differ from ZIP');
    }
    found.add(file.path);
  }
  return 'RECEIPT_HASHES_MATCH';
}

function checkGate(id, action) {
  try { return { id, status: 'PASS', reasonCode: action() }; }
  catch (error) {
    return { id, status: error instanceof ReleaseInputError && error.code === 'INPUT_MISSING' ? 'BLOCKED' : 'FAIL',
      reasonCode: error instanceof ReleaseInputError ? error.code : 'RELEASE_INPUT_ERROR' };
  }
}

/** Untrusted local developer candidate: this cannot approve a VK upload or release. */
export function checkVkCandidate({ archivePath, receiptPath } = {}) {
  let archive;
  const archiveGate = checkGate('archive', () => {
    archive = inspectVkArchive(archivePath);
    return 'VK_ARCHIVE_STORED_ZIP_VALID';
  });
  const receiptGate = archive
    ? checkGate('build-receipt', () => verifyReceipt(readReceipt(receiptPath), archive))
    : { id: 'build-receipt', status: 'BLOCKED', reasonCode: 'ARCHIVE_DEPENDENCY_UNAVAILABLE' };
  const gates = [
    archiveGate,
    receiptGate,
    { id: 'platform-live', status: 'NOT_RUN', reasonCode: 'VK_LIVE_SDK_NOT_TESTED' },
    { id: 'physical-devices', status: 'NOT_RUN', reasonCode: 'VK_DEVICE_NOT_TESTED' },
    { id: 'rights-clearance', status: 'NOT_RUN', reasonCode: 'RIGHTS_LEGAL_REVIEW_NOT_ATTESTED' },
    { id: 'moderation', status: 'NOT_RUN', reasonCode: 'VK_MODERATION_NOT_SUBMITTED' },
    { id: 'owner-authorization', status: 'NOT_RUN', reasonCode: 'PUBLICATION_NOT_AUTHORIZED' },
  ];
  return {
    schemaVersion: 1,
    kind: 'vk-local-candidate-check',
    status: [archiveGate, receiptGate].some(gate => gate.status === 'FAIL') ? 'FAIL'
      : [archiveGate, receiptGate].some(gate => gate.status === 'BLOCKED') ? 'BLOCKED' : 'PASS_LOCAL',
    candidateSha256: archive?.sha256 ?? null,
    gates,
    releaseReady: false,
    publicationAllowed: false,
  };
}
