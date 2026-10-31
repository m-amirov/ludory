import { readRegularBytes, SHA_256 } from './archive.mjs';
import { checkYandexRelease } from './check.mjs';
import { ReleaseInputError } from './errors.mjs';

const CHECK_IDS = Object.freeze([
  'sdk-initialization', 'loading-api', 'player-authenticated', 'cloud-storage',
  'ads-interstitial', 'ads-rewarded', 'desktop-chromium', 'desktop-firefox',
  'desktop-webkit', 'mobile-android-emulated', 'mobile-ios-emulated',
  'physical-android', 'physical-ios',
]);
const IDS = new Set(CHECK_IDS);
const fail = code => { throw new ReleaseInputError(code, 'Invalid R2 field observation'); };

function assertObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
}

function assertFields(value, fields, code) {
  if (Object.keys(value).some(key => !fields.includes(key))) fail(code);
}

/** JSON.parse keeps the last duplicate key, so inspect lexical object members first. */
function assertUniqueJsonMembers(source) {
  // JSON.parse has already rejected malformed syntax; punctuation outside quoted
  // strings is sufficient to track object scopes and member-key positions.
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]:,]/gs;
  const stack = [];
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    const parent = stack.at(-1);
    if (token === '{') stack.push({ type: 'object', keys: new Set(), expectsKey: true });
    else if (token === '[') stack.push({ type: 'array' });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && parent?.type === 'object') parent.expectsKey = true;
    else if (token.startsWith('"') && parent?.type === 'object' && parent.expectsKey) {
      const key = JSON.parse(token); // normalize escaped-equivalent key spellings
      if (parent.keys.has(key)) fail('FIELD_JSON_DUPLICATE_KEY');
      parent.keys.add(key);
      parent.expectsKey = false;
    }
  }
}

function readFieldEvidence(filename, candidateSha256) {
  let data;
  try {
    const source = readRegularBytes(filename, 1024 * 1024).toString('utf8');
    data = JSON.parse(source);
    assertUniqueJsonMembers(source);
  }
  catch (error) {
    if (error instanceof ReleaseInputError) throw error;
    fail('FIELD_JSON_INVALID');
  }
  assertObject(data, 'FIELD_FORMAT');
  assertFields(data, ['schemaVersion', 'target', 'candidateSha256', 'source', 'observations'], 'FIELD_FORMAT');
  if (data.schemaVersion !== 1 || data.target !== 'yandex-games' ||
      data.source !== 'USER_DECLARED' || !Array.isArray(data.observations)) fail('FIELD_PROVENANCE_UNTRUSTED');
  if (!SHA_256.test(data.candidateSha256 ?? '') ||
      (candidateSha256 !== null && data.candidateSha256 !== candidateSha256)) {
    fail('FIELD_CANDIDATE_MISMATCH');
  }
  if (data.observations.length > CHECK_IDS.length) fail('FIELD_FORMAT');
  const rows = new Map();
  for (const observation of data.observations) {
    assertObject(observation, 'FIELD_FORMAT');
    assertFields(observation, ['id', 'status'], 'FIELD_FORMAT');
    if (!IDS.has(observation.id) || rows.has(observation.id) ||
        !['PASS', 'FAIL', 'NOT_RUN'].includes(observation.status)) fail('FIELD_FORMAT');
    rows.set(observation.id, observation.status);
  }
  return rows;
}

/** Read-only preparation for a future owner-authorized Yandex field test; never Release PASS. */
export function planYandexFieldTests(options = {}) {
  const local = checkYandexRelease(options);
  const checks = CHECK_IDS.map(id => ({ id, status: 'NOT_RUN', reasonCode: 'FIELD_TEST_NOT_RUN' }));
  let fieldEvidenceGate = { status: 'NOT_RUN', reasonCode: 'FIELD_EVIDENCE_NOT_PROVIDED' };

  if (options.fieldEvidencePath !== undefined) {
    try {
      const observations = readFieldEvidence(options.fieldEvidencePath, local.candidateSha256);
      if (local.candidateSha256 === null) {
        fieldEvidenceGate = { status: 'BLOCKED', reasonCode: 'ARCHIVE_DEPENDENCY_UNAVAILABLE' };
      } else {
        fieldEvidenceGate = { status: 'BLOCKED', reasonCode: 'SELF_REPORTED_NOT_WITNESSED' };
        for (const check of checks) {
          const declared = observations.get(check.id);
          if (declared === 'PASS') {
            check.status = 'BLOCKED';
            check.reasonCode = 'UNVERIFIED_SELF_REPORT';
          } else if (declared === 'FAIL') {
            check.status = 'FAIL';
            check.reasonCode = 'REPORTED_FIELD_FAILURE';
          }
        }
      }
    } catch (error) {
      const missing = error instanceof ReleaseInputError && error.code === 'INPUT_MISSING';
      fieldEvidenceGate = { status: missing ? 'BLOCKED' : 'FAIL',
        reasonCode: error instanceof ReleaseInputError ? error.code : 'FIELD_INPUT_ERROR' };
    }
  }

  const status = local.status === 'FAIL' || fieldEvidenceGate.status === 'FAIL' ||
      checks.some(check => check.status === 'FAIL') ? 'FAIL'
    : local.status === 'BLOCKED' || (fieldEvidenceGate.status === 'BLOCKED' &&
      fieldEvidenceGate.reasonCode !== 'SELF_REPORTED_NOT_WITNESSED') ? 'BLOCKED'
      : 'READY_FOR_FIELD_TEST';

  return { schemaVersion: 1, kind: 'yandex-field-test-plan', status,
    candidateSha256: local.candidateSha256, localStatus: local.status,
    checks, fieldEvidenceGate, releaseReady: false, publicationAllowed: false };
}
