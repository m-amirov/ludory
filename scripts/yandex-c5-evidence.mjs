import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SHA_256 = /^[0-9a-f]{64}$/;
const ALLOWED_RESULT = new Set(['SDK_CONTRACT_PASS', 'SDK_CONTRACT_FAIL']);

/** Only local fixture-contract outcomes are representable in this evidence type. */
export function createYandexC5Evidence({ candidateSha256 = null, results = [], failure = null, ...unexpected } = {}) {
  if (Object.keys(unexpected).length) throw new TypeError('Unsupported C5 evidence field');
  if (!Array.isArray(results) || (!failure && results.length === 0)) {
    throw new TypeError('C5 browser results must contain at least one variant unless the run failed');
  }
  if (candidateSha256 !== null && (typeof candidateSha256 !== 'string' || !SHA_256.test(candidateSha256))) {
    throw new TypeError('C5 candidateSha256 must be a lowercase SHA-256 digest');
  }
  if (!failure && !candidateSha256) throw new TypeError('C5 successful evidence requires candidateSha256');
  const checkedResults = results.map(result => {
    const expectedPhase = result?.status === 'SDK_CONTRACT_PASS' ? 'complete' : 'failed';
    if (!result || typeof result.browser !== 'string' || !result.browser.trim() ||
        typeof result.emulated !== 'boolean' || !ALLOWED_RESULT.has(result.status) ||
        !['chromium', 'firefox', 'webkit'].includes(result.engine) || result.phase !== expectedPhase) {
      throw new TypeError('Unsupported C5 browser result status or variant');
    }
    return { browser: result.browser, engine: result.engine, emulated: result.emulated,
      phase: result.phase, status: result.status };
  });
  const failed = Boolean(failure) || checkedResults.some(result => result.status === 'SDK_CONTRACT_FAIL');
  return {
    schemaVersion: 1,
    stage: 'Connect Yandex C5',
    candidateSha256,
    sdk: 'fake /sdk.js served only by fixture',
    verdict: failed ? 'SDK_CONTRACT_FAIL' : 'SDK_CONTRACT_PASS',
    liveYandex: 'YANDEX_LIVE_NOT_RUN',
    physicalDevices: 'NOT_RUN',
    results: checkedResults,
    ...(failure ? { failure: String(failure) } : {}),
  };
}

export async function writeYandexC5Evidence(directory, input) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('C5 evidence directory is required');
  const evidence = createYandexC5Evidence(input);
  await mkdir(directory, { recursive: true });
  const destination = join(directory, 'yandex-c5-contract.json');
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return destination;
}
