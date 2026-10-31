import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createYandexC5Evidence, writeYandexC5Evidence } from '../../../scripts/yandex-c5-evidence.mjs';

const sha = 'f'.repeat(64);
const variant = { browser: 'Chromium desktop', engine: 'chromium', phase: 'complete',
  emulated: false, status: 'SDK_CONTRACT_PASS' };

test('C5 evidence permits only mock SDK contract verdicts, not live/release status', () => {
  const pass = createYandexC5Evidence({ candidateSha256: sha, results: [variant] });
  assert.equal(pass.verdict, 'SDK_CONTRACT_PASS');
  assert.equal(pass.sdk, 'fake /sdk.js served only by fixture');
  assert.equal(pass.liveYandex, 'YANDEX_LIVE_NOT_RUN');
  assert.equal(pass.physicalDevices, 'NOT_RUN');
  assert.equal(pass.results[0].engine, 'chromium');
  assert.equal(pass.results[0].phase, 'complete');
  const failure = createYandexC5Evidence({ candidateSha256: sha, results: [variant], failure: new Error('browser crashed') });
  assert.equal(failure.verdict, 'SDK_CONTRACT_FAIL');
  assert.match(failure.failure, /browser crashed/);
  assert.throws(() => createYandexC5Evidence({ candidateSha256: sha, results: [variant], verdict: 'YANDEX_LIVE_PASS' }),
    /unsupported|not allowed|unexpected/i);
  assert.throws(() => createYandexC5Evidence({ candidateSha256: sha, results: [variant], verdict: 'RELEASE_READY' }),
    /unsupported|not allowed|unexpected/i);
  assert.throws(() => createYandexC5Evidence({ candidateSha256: sha, results: [{ ...variant, status: 'YANDEX_LIVE_PASS' }] }),
    /status|unsupported|not allowed/i);
  assert.throws(() => createYandexC5Evidence({ candidateSha256: sha, results: [{ ...variant, status: 'RELEASE_READY' }] }),
    /status|unsupported|not allowed/i);
  assert.throws(() => createYandexC5Evidence({ candidateSha256: sha, results: [] }), /results|variants/i);
});

test('C5 failed run writes durable contract evidence, never live acceptance', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ludory-c5-evidence-'));
  try {
    const location = await writeYandexC5Evidence(folder, {
      candidateSha256: sha, results: [{ browser: 'iPhone WebKit', engine: 'webkit',
        emulated: true, phase: 'failed', status: 'SDK_CONTRACT_FAIL' }],
      failure: new Error('WebKit unavailable'),
    });
    const data = JSON.parse(await readFile(location, 'utf8'));
    assert.equal(data.verdict, 'SDK_CONTRACT_FAIL');
    assert.equal(data.liveYandex, 'YANDEX_LIVE_NOT_RUN');
    assert.equal(data.results[0].browser, 'iPhone WebKit');
    assert.equal(data.results[0].phase, 'failed');
    assert.equal(location, join(folder, 'yandex-c5-contract.json'));
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('runtime-browser CI checks Yandex bundle, runs generated-candidate and Phaser smokes, and uploads evidence', async () => {
  const workflow = await readFile(fileURLToPath(new URL('../../../.github/workflows/runtime-browser.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /scripts\/build-yandex-template\.mjs/);
  assert.match(workflow, /scripts\/build-yandex-candidate\.mjs/);
  assert.match(workflow, /npm run check:yandex-template/);
  assert.match(workflow, /LUDORY_C5_ARTIFACT_DIR: artifacts/);
  assert.match(workflow, /yandex-c5-contract\.json/);
  assert.match(workflow, /packages\/runtime-phaser\/test\/browser/);
  assert.match(workflow, /name: .*C5.*evidence/i);
});
