import { inspectYandexArchive, readRegularBytes, SHA_256 } from './archive.mjs';
import { ReleaseInputError } from './errors.mjs';

const fail = (code, message) => { throw new ReleaseInputError(code, message); };
const variants = new Map([
  ['Chromium desktop', ['chromium', false]],
  ['Firefox desktop', ['firefox', false]],
  ['WebKit desktop', ['webkit', false]],
  ['Android Chromium', ['chromium', true]],
  ['iPhone WebKit', ['webkit', true]],
]);

function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, 'Expected a JSON object');
  return value;
}

function exactFields(value, allowed, code) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(code, `Unsupported evidence field: ${key}`);
}

function jsonInput(filename) {
  let data;
  try { data = JSON.parse(readRegularBytes(filename, 1024 * 1024).toString('utf8')); }
  catch (error) {
    if (error instanceof ReleaseInputError) throw error;
    fail('EVIDENCE_JSON', `Invalid JSON input: ${error.message}`);
  }
  return object(data, 'EVIDENCE_FORMAT');
}

function verifyBuildReceipt(data, archive) {
  exactFields(data, ['archivePath', 'sha256', 'files'], 'RECEIPT_FORMAT');
  if (data.sha256 !== archive.sha256) fail('RECEIPT_CANDIDATE_MISMATCH', 'Build receipt ZIP SHA-256 differs');
  if (!Array.isArray(data.files) || data.files.length !== archive.files.length) {
    fail('RECEIPT_FILES_MISMATCH', 'Build receipt must list every ZIP file exactly once');
  }
  const expected = new Map(archive.files.map(file => [file.path, file]));
  const found = new Set();
  for (const file of data.files) {
    object(file, 'RECEIPT_FORMAT');
    exactFields(file, ['path', 'sha256', 'size'], 'RECEIPT_FORMAT');
    if (!expected.has(file.path) || found.has(file.path) ||
        file.sha256 !== expected.get(file.path).sha256 || file.size !== expected.get(file.path).size) {
      fail('RECEIPT_FILES_MISMATCH', 'Build receipt file list differs from actual ZIP contents');
    }
    found.add(file.path);
  }
  return 'RECEIPT_HASHES_MATCH';
}

function verifySdkContract(data, archive) {
  exactFields(data, ['schemaVersion', 'stage', 'candidateSha256', 'sdk', 'verdict',
    'liveYandex', 'physicalDevices', 'results', 'failure'], 'SDK_FORMAT');
  if (data.schemaVersion !== 1 || data.stage !== 'Connect Yandex C5' ||
      data.sdk !== 'fake /sdk.js served only by fixture' ||
      data.liveYandex !== 'YANDEX_LIVE_NOT_RUN' || data.physicalDevices !== 'NOT_RUN' ||
      data.verdict !== 'SDK_CONTRACT_PASS' || data.failure !== undefined) {
    fail('SDK_CONTRACT_UNTRUSTED', 'Only mock-SDK C5 local PASS with live NOT_RUN is valid in R1');
  }
  if (data.candidateSha256 !== archive.sha256) {
    fail('SDK_CANDIDATE_MISMATCH', 'C5 evidence is for a different candidate ZIP');
  }
  if (!Array.isArray(data.results) || data.results.length !== variants.size) {
    fail('SDK_VARIANTS_INCOMPLETE', 'C5 evidence requires all five desktop/mobile emulation variants');
  }
  const found = new Set();
  for (const row of data.results) {
    object(row, 'SDK_FORMAT');
    exactFields(row, ['browser', 'engine', 'emulated', 'phase', 'status'], 'SDK_FORMAT');
    const variant = variants.get(row.browser);
    if (!variant || found.has(row.browser) || row.engine !== variant[0] ||
        row.emulated !== variant[1] || row.phase !== 'complete' || row.status !== 'SDK_CONTRACT_PASS') {
      fail('SDK_VARIANTS_INCOMPLETE', 'Unexpected, duplicate or failed C5 browser variant');
    }
    found.add(row.browser);
  }
  return 'SDK_MOCK_VARIANTS_PASS';
}

function verifyRights(data, archive) {
  exactFields(data, ['schemaVersion', 'target', 'candidateSha256', 'assets'], 'RIGHTS_FORMAT');
  if (data.schemaVersion !== 1 || data.target !== 'yandex-games' || !Array.isArray(data.assets)) {
    fail('RIGHTS_FORMAT', 'Rights declarations must use schemaVersion 1 and Yandex target');
  }
  if (data.candidateSha256 !== archive.sha256) {
    fail('RIGHTS_CANDIDATE_MISMATCH', 'Rights declaration is for a different candidate ZIP');
  }
  if (data.assets.length < archive.mediaFiles.length) {
    fail('RIGHTS_INCOMPLETE', 'Every shipped image, audio or font needs a separate rights declaration');
  }
  if (data.assets.length > archive.mediaFiles.length) {
    fail('RIGHTS_EXTRA', 'Rights declaration has unshipped or duplicate assets');
  }
  const expected = new Map(archive.mediaFiles.map(file => [file.path, file]));
  const found = new Set();
  for (const asset of data.assets) {
    object(asset, 'RIGHTS_FORMAT');
    exactFields(asset, ['path', 'sha256', 'provenance', 'evidence'], 'RIGHTS_FORMAT');
    if (!expected.has(asset.path) || found.has(asset.path)) {
      fail('RIGHTS_EXTRA', 'Rights declaration has unshipped or duplicate assets');
    }
    if (!SHA_256.test(asset.sha256 ?? '') || asset.sha256 !== expected.get(asset.path).sha256) {
      fail('RIGHTS_FILE_MISMATCH', `Rights content SHA-256 differs: ${asset.path}`);
    }
    if (!['owned', 'licensed', 'public-domain'].includes(asset.provenance) ||
        typeof asset.evidence !== 'string' || !asset.evidence.trim() || asset.evidence.length > 2048) {
      fail('RIGHTS_INCOMPLETE', `Rights provenance or evidence missing for ${asset.path}`);
    }
    found.add(asset.path);
  }
  return 'RIGHTS_DECLARATIONS_MATCH';
}

function checkGate(id, action) {
  try { return { id, status: 'PASS', reasonCode: action() }; }
  catch (error) {
    const missing = error instanceof ReleaseInputError && error.code === 'INPUT_MISSING';
    const incomplete = error instanceof ReleaseInputError && error.code === 'RIGHTS_INCOMPLETE';
    return { id, status: missing || incomplete ? 'BLOCKED' : 'FAIL',
      reasonCode: error instanceof ReleaseInputError ? error.code : 'RELEASE_INPUT_ERROR' };
  }
}

/** Read-only local checks: never a signature, real platform review or publication permission. */
export function checkYandexRelease({ archivePath, receiptPath, sdkEvidencePath, rightsPath } = {}) {
  let archive;
  const archiveGate = checkGate('archive', () => {
    archive = inspectYandexArchive(archivePath);
    return 'ARCHIVE_STORED_ZIP_VALID';
  });
  const dependent = (id, filename, verifier) => archive
    ? checkGate(id, () => verifier(jsonInput(filename), archive))
    : { id, status: 'BLOCKED', reasonCode: 'ARCHIVE_DEPENDENCY_UNAVAILABLE' };
  const gates = [
    archiveGate,
    dependent('build-receipt', receiptPath, verifyBuildReceipt),
    dependent('sdk-contract', sdkEvidencePath, verifySdkContract),
    dependent('rights-declarations', rightsPath, verifyRights),
    { id: 'platform-live', status: 'NOT_RUN', reasonCode: 'YANDEX_DRAFT_NOT_TESTED' },
    { id: 'rights-clearance', status: 'NOT_RUN', reasonCode: 'RIGHTS_LEGAL_REVIEW_NOT_ATTESTED' },
    { id: 'owner-authorization', status: 'NOT_RUN', reasonCode: 'PUBLICATION_NOT_AUTHORIZED' },
  ];
  const local = gates.slice(0, 4);
  return {
    schemaVersion: 1,
    kind: 'yandex-local-release-check',
    status: local.some(gate => gate.status === 'FAIL') ? 'FAIL'
      : local.some(gate => gate.status === 'BLOCKED') ? 'BLOCKED' : 'PASS_LOCAL',
    candidateSha256: archive?.sha256 ?? null,
    gates,
    releaseReady: false,
    publicationAllowed: false,
  };
}
