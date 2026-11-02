/** Mock-SDK-only acceptance contract; this module does not launch or attest a browser. */
export const F5B3_BROWSER_CASES = Object.freeze([
  { browser: 'chromium', device: 'desktop' },
  { browser: 'chromium', device: 'pixel-7' },
  { browser: 'chromium', device: 'narrow-320' },
  { browser: 'firefox', device: 'desktop' },
  { browser: 'webkit', device: 'iphone-13' },
]);
export const F5B3_ADVERSE_CASES = Object.freeze([
  'init-refused', 'ready-refused', 'storage-refused', 'corrupt-cloud',
  'sdk-pause-resume', 'pagehide-restore',
]);
export const F5B3_STORY_PATH = Object.freeze([
  'F5B3_AUTHORED_STORY_317', 'photo:lights', 'back:photo', 'photo:lights',
  'keepsake:shell', 'message:photo', 'echo:mira', 'route:mira',
  'ending:lighthouse', 'journal:photo-shell', 'save:platform-cloud', 'reload:restored',
]);

const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const targets = ['yandex', 'vk'];
const requiredSdkCalls = {
  yandex: ['sdk:init', 'loading:ready', 'gameplay:start', 'player:getData', 'player:setData'],
  vk: ['VKWebAppInit', 'VKWebAppStorageGet', 'VKWebAppStorageSet'],
};
const httpSdkSubstitutions = Object.freeze({
  yandex: '/sdk.js',
  vk: '/assets/vk-bridge.js',
});

/** Validate a complete receipt; no missing/blocked engine can become a PASS label. */
export function validateF5b3Evidence(receipt) {
  const reasons = [];
  if (receipt?.schemaVersion !== 1 || receipt.status !== 'MOCK_SDK_BROWSER_PASS' ||
      receipt.mockSdkOnly !== true || receipt.releaseReady !== false ||
      receipt.publicationAllowed !== false) reasons.push('F5B3_BOUNDARY_INVALID');
  if (receipt?.fixtureChecks !== 'PASS') reasons.push('F5B3_FIXTURE_TESTS_UNVERIFIED');
  if (receipt?.archiveMembersUnchanged !== true ||
      Object.keys(receipt?.httpSdkSubstitutions ?? {}).length !== targets.length ||
      !targets.every(target => receipt?.httpSdkSubstitutions?.[target] === httpSdkSubstitutions[target])) {
    reasons.push('F5B3_MOCK_HTTP_BOUNDARY_UNDISCLOSED');
  }
  if (!sha256(receipt?.sourceDigest) || !targets.every(target => sha256(receipt?.archiveSha256?.[target])) ||
      receipt?.archiveSha256?.yandex === receipt?.archiveSha256?.vk) reasons.push('F5B3_SOURCE_ARCHIVES_INVALID');
  const required = new Set(targets.flatMap(target => [
    ...F5B3_BROWSER_CASES.map(({ browser, device }) => `${target}|${browser}|${device}|normal`),
    ...F5B3_ADVERSE_CASES.map(scenario => `${target}|chromium|desktop|${scenario}`),
  ]));
  const seen = new Set();
  if (!Array.isArray(receipt?.results) || receipt.results.length !== required.size) {
    reasons.push('F5B3_CASES_INCOMPLETE');
  }
  for (const row of Array.isArray(receipt?.results) ? receipt.results : []) {
    if (!row || typeof row !== 'object') { reasons.push('F5B3_CASE_INVALID'); continue; }
    const scenario = row.scenario === undefined ? 'normal' : row.scenario;
    if (typeof row.target !== 'string' || typeof row.browser !== 'string' ||
        typeof row.device !== 'string' || typeof scenario !== 'string') {
      reasons.push('F5B3_CASE_FIELD_TYPE_INVALID');
      continue;
    }
    const key = `${row.target}|${row.browser}|${row.device}|${scenario}`;
    if (!required.has(key) || seen.has(key)) reasons.push('F5B3_CASE_UNKNOWN_OR_DUPLICATE');
    seen.add(key);
    if (row.status !== 'PASS' || row.mockSdkOnly !== true || row.externalRequests !== 0 ||
        row.sourceDigest !== receipt.sourceDigest ||
        row.archiveSha256 !== receipt.archiveSha256?.[row.target]) reasons.push('F5B3_CASE_UNVERIFIED');
    if (scenario === 'normal' && (JSON.stringify(row.observedStoryPath) !== JSON.stringify(F5B3_STORY_PATH) ||
        !Array.isArray(row.sdkCalls) ||
        !requiredSdkCalls[row.target]?.every(call => row.sdkCalls.includes(call)))) {
      reasons.push('F5B3_GAMEPATH_UNVERIFIED');
    }
  }
  if ([...required].some(key => !seen.has(key))) reasons.push('F5B3_REQUIRED_CASE_MISSING');
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** Receipt producer pins the acceptance boundary regardless of browser outcome. */
export function buildF5b3Evidence({ sourceDigest = null, archiveSha256 = {}, results = [],
  fixtureChecks = 'NOT_RUN' } = {}) {
  const receipt = { schemaVersion: 1, sourceDigest, archiveSha256, results,
    status: 'MOCK_SDK_BROWSER_PASS', mockSdkOnly: true, releaseReady: false,
    publicationAllowed: false, fixtureChecks, archiveMembersUnchanged: true,
    httpSdkSubstitutions: { ...httpSdkSubstitutions } };
  const validation = validateF5b3Evidence(receipt);
  if (!validation.ok) {
    receipt.status = 'BLOCKED';
    receipt.failures = validation.reasons;
  }
  return receipt;
}
