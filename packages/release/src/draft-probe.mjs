import { planYandexFieldTests } from './plan.mjs';
import { inspectYandexArchive } from './archive.mjs';

const PLATFORM_HOSTS = new Set(['yandex.ru', 'yandex.com']);
const GAME_HOST_SUFFIXES = ['yandex.ru', 'yandex.com', 'yandex.net', 'yandexcdn.net', 'yandexcloud.net'];
const MAX_CANDIDATE_FILES = 512;
const MAX_CANDIDATE_BYTES = 100 * 1024 * 1024;

const failed = code => { const error = new Error(code); error.code = code; throw error; };
const validHost = host => GAME_HOST_SUFFIXES.some(domain => host === domain || host.endsWith('.' + domain));

export function validateDraftUrl(text) {
  let url;
  try { url = new URL(text); } catch { failed('DRAFT_URL_INVALID'); }
  if (url.protocol !== 'https:' || !PLATFORM_HOSTS.has(url.hostname) ||
      url.username || url.password || url.port || url.hash ||
      !/^\/games\/app\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname) ||
      url.searchParams.get('draft') !== 'true' ||
      [...url.searchParams.keys()].some(key => !['draft', 'debug-mode'].includes(key)) ||
      [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1) ||
      (url.searchParams.has('debug-mode') && url.searchParams.get('debug-mode') !== '16')) {
    failed('DRAFT_URL_NOT_STRICT');
  }
  return url;
}

export function validateGameBase(text) {
  if (typeof text !== 'string' || /%2e|%2f|%5c|\/\.\.?\//i.test(text)) failed('GAME_BASE_UNTRUSTED');
  let url;
  try { url = new URL(text); } catch { failed('GAME_BASE_INVALID'); }
  if (url.protocol !== 'https:' || !validHost(url.hostname) || url.port ||
      url.username || url.password || url.hash || url.search ||
      !url.pathname.endsWith('/') || url.pathname.includes('//') ||
      url.pathname.split('/').some(part => part === '.' || part === '..') ||
      /%2f|%5c|%2e/i.test(url.pathname)) {
    failed('GAME_BASE_UNTRUSTED');
  }
  return url;
}

export function prepareDraftProbe(options) {
  const draft = validateDraftUrl(options?.draftUrl);
  const local = planYandexFieldTests(options);
  const report = {
    schemaVersion: 1, kind: 'yandex-r3-draft-probe',
    candidateSha256: local.candidateSha256,
    draftHost: draft.hostname,
    status: local.status === 'FAIL' ? 'FAIL' : 'BLOCKED',
    reasonCode: local.status === 'READY_FOR_FIELD_TEST' ? 'AWAIT_OWNER_AUTHORIZED_BROWSER' : 'R2_PREFLIGHT_NOT_READY',
    filesVerified: 0, browserChecks: [], releaseReady: false, publicationAllowed: false,
  };
  if (local.status !== 'READY_FOR_FIELD_TEST') return { report, files: [], draft };
  const archive = inspectYandexArchive(options.archivePath);
  if (archive.sha256 !== local.candidateSha256 || !archive.files.length ||
      archive.files.length > MAX_CANDIDATE_FILES ||
      archive.files.reduce((sum, file) => sum + file.size, 0) > MAX_CANDIDATE_BYTES) {
    report.status = 'BLOCKED';
    report.reasonCode = 'R3_CANDIDATE_LIMIT';
    return { report, files: [], draft };
  }
  return { report, files: archive.files, draft };
}

/** No caller-supplied PASS can authorize release. File transport is called only after strict preflight. */
export async function verifyServedCandidate(files, base, readFile) {
  const root = validateGameBase(base);
  if (!Array.isArray(files) || !files.length || files.length > MAX_CANDIDATE_FILES) failed('R3_FILE_SET_INVALID');
  const seen = new Set();
  const targets = [];
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || seen.has(file.path) ||
        !/^[a-z0-9][a-z0-9./_-]*$/i.test(file.path) ||
        file.path.split('/').some(part => !part || part === '.' || part === '..') ||
        !/^[0-9a-f]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) {
      failed('R3_FILE_SET_INVALID');
    }
    seen.add(file.path);
    const target = new URL(file.path, root);
    if (target.origin !== root.origin || !target.href.startsWith(root.href)) failed('R3_ASSET_ESCAPE');
    targets.push({ target, file });
  }
  for (const { target, file } of targets) {
    const observed = await readFile(target, file.size);
    if (observed?.sha256 !== file.sha256 || observed?.size !== file.size) failed('R3_SERVED_BYTES_MISMATCH');
  }
  return files.length;
}

/** Browser observation does not establish authenticated platform attestation or publication readiness. */
export function finalizeDraftObservation(prepared, observed) {
  const { report, files } = prepared;
  if (report.reasonCode !== 'AWAIT_OWNER_AUTHORIZED_BROWSER' || !files.length) return report;
  if (!observed || observed.frameLinked !== true || observed.ready !== true ||
      observed.filesVerified !== files.length || observed.browser !== 'chromium') {
    return { ...report, status: 'BLOCKED', reasonCode: 'R3_BROWSER_OBSERVATION_INCOMPLETE' };
  }
  return { ...report, status: 'CAPTURED_UNVERIFIED', reasonCode: 'BROWSER_OBSERVED_NO_PLATFORM_ATTESTATION',
    filesVerified: observed.filesVerified,
    browserChecks: [
      { id: 'desktop-chromium', status: 'OBSERVED', reasonCode: 'HEADLESS_BROWSER_READY' },
      { id: 'sdk-initialization', status: 'OBSERVED', reasonCode: 'RUNTIME_READY_WITH_MATCHED_BYTES' },
      { id: 'loading-api', status: 'OBSERVED', reasonCode: 'RUNTIME_READY_WITH_MATCHED_BYTES' },
    ], releaseReady: false, publicationAllowed: false };
}
