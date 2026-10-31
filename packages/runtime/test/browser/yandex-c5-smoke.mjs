import '../../../studio/test/setup-trust-env.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { unzipSync } from 'fflate';
import { chromium, firefox, webkit, devices } from 'playwright';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';
import { buildYandexCandidate } from '../../../../scripts/build-yandex-candidate.mjs';
import { createYandexC5Evidence, writeYandexC5Evidence } from '../../../../scripts/yandex-c5-evidence.mjs';

// Only this local test server responds to /sdk.js. These bytes never enter the game ZIP.
const fakeSdk = String.raw`
(() => {
  const calls = [];
  const handlers = new Map();
  const ads = [];
  const audio = [];
  const state = {
    calls, handlers, ads, audio, audioSources: [], playerDenied: false, lastFlush: null,
    emit(name) { for (const fn of handlers.get(name) ?? []) fn(); },
    get cloud() { return JSON.parse(localStorage.getItem('__c5_cloud') || '{}'); },
    set cloud(value) { localStorage.setItem('__c5_cloud', JSON.stringify(value)); },
  };
  globalThis.__sdkTest = state;
  globalThis.Audio = class {
    constructor(source) { this.src = source; state.audioSources.push(source); this.currentTime = 0; this.paused = true; this.volume = 1; this.muted = false; }
    addEventListener() {}
    removeEventListener() {}
    play() { this.paused = false; audio.push('play'); return Promise.resolve(); }
    pause() { this.paused = true; audio.push('pause'); }
  };
  const sdk = {
    features: {
      LoadingAPI: { ready() {
        if (document.querySelector('#game')?.dataset.mounted !== 'true') throw new Error('ready before mount');
        calls.push('loading:ready');
      } },
      GameplayAPI: {
        start() { calls.push('gameplay:start'); },
        stop() { calls.push('gameplay:stop'); },
      },
    },
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
    off(name, fn) { handlers.get(name)?.delete(fn); },
    getPlayer() {
      calls.push('player:request');
      if (state.playerDenied) return Promise.reject(new Error('guest player rejected'));
      return Promise.resolve({
        getData(keys) {
          calls.push('player:getData');
          const values = state.cloud;
          return Promise.resolve(Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]])));
        },
        setData(values, flush) {
          calls.push('player:setData');
          state.lastFlush = flush;
          state.cloud = { ...state.cloud, ...values };
          return Promise.resolve();
        },
      });
    },
    adv: {
      showFullscreenAdv({ callbacks }) { ads.push({ kind: 'fullscreen', callbacks }); },
      showRewardedVideo({ callbacks }) { ads.push({ kind: 'rewarded', callbacks }); },
    },
  };
  globalThis.YaGames = { init() { calls.push('sdk:init'); return Promise.resolve(sdk); } };
})();`;

const fixtures = [
  { name: 'Chromium desktop', browserType: chromium, config: { viewport: { width: 1000, height: 720 } }, emulated: false },
  { name: 'Firefox desktop', browserType: firefox, config: { viewport: { width: 1000, height: 720 } }, emulated: false },
  { name: 'WebKit desktop', browserType: webkit, config: { viewport: { width: 1000, height: 720 } }, emulated: false },
  { name: 'Android Chromium', browserType: chromium, config: devices['Pixel 7'], emulated: true },
  { name: 'iPhone WebKit', browserType: webkit, config: devices['iPhone 13'], emulated: true },
];

const contentType = filename => filename.endsWith('.html') ? 'text/html; charset=utf-8'
  : filename.endsWith('.json') ? 'application/json'
    : filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';

async function serve(entries) {
  const requests = [];
  const server = createServer((request, response) => {
    const raw = new URL(request.url, 'http://localhost').pathname;
    const filename = raw === '/' ? 'index.html' : raw.slice(1);
    requests.push(filename);
    if (filename === 'sdk.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(fakeSdk);
      return;
    }
    if (!Object.hasOwn(entries, filename)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': contentType(filename), 'Cache-Control': 'no-store' });
    response.end(Buffer.from(entries[filename]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

async function waitOperation(page, action, result = 'ok') {
  await page.waitForFunction(({ action, result }) => document.querySelector('#status')?.dataset.lastOperation === `${action}:${result}`,
    { action, result }, { timeout: 8_000 });
}

async function waitStatus(page, expected) {
  await page.waitForFunction(status => document.querySelector('#status')?.dataset.host === status,
    expected, { timeout: 8_000 });
}

async function runVariant(fixture, url) {
  const browser = await fixture.browserType.launch({ headless: true,
    ...(fixture.browserType === chromium ? { args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
  const context = await browser.newContext(fixture.config);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(url, { waitUntil: 'load' });
    await waitStatus(page, 'READY');
    await page.locator('#status[data-sdk-ready="true"]:not([data-error-code])').waitFor();
    const initial = await page.evaluate(() => ({ calls: [...window.__sdkTest.calls], mounted: document.querySelector('#game').dataset.mounted }));
    assert.deepEqual(initial.calls, ['sdk:init', 'loading:ready']);
    assert.equal(initial.mounted, 'true');
    assert.equal(await page.evaluate(() => window.__sdkTest.ads.length), 0, 'ads never start automatically');

    await page.locator('#start').click();
    await waitStatus(page, 'RUNNING');
    const area = page.locator('#game');
    if (fixture.emulated) await area.tap();
    else await area.click();
    await page.waitForFunction(() => Number(document.querySelector('#score').textContent) === 1);
    await page.locator('#sound').click();
    await waitOperation(page, 'sound');
    const wav = await page.evaluate(() => {
      const source = window.__sdkTest.audioSources.at(-1);
      if (!source?.startsWith('data:audio/wav;base64,')) return null;
      const bytes = Uint8Array.from(atob(source.split(',')[1]), char => char.charCodeAt(0));
      const header = new DataView(bytes.buffer);
      const sampleRate = header.getUint32(24, true);
      const count = header.getUint32(40, true);
      const values = [...bytes.slice(44, 44 + count)];
      return { sampleRate, durationMs: count / sampleRate * 1000,
        complete: bytes.length === 44 + count, dynamic: new Set(values).size };
    });
    assert.ok(wav && wav.complete, 'Sound must contain a complete playable PCM WAV');
    assert.equal(wav.sampleRate, 8000);
    assert.ok(wav.durationMs >= 200, 'Sound demo must last long enough to be audible');
    assert.ok(wav.dynamic >= 8, 'Sound demo must contain a non-silent waveform');
    const audioBefore = await page.evaluate(() => window.__sdkTest.audio.filter(x => x === 'pause').length);

    await page.locator('#pause').click();
    await waitStatus(page, 'PAUSED');
    await page.evaluate(() => { window.__sdkTest.emit('game_api_pause'); window.__sdkTest.emit('game_api_resume'); });
    assert.equal(await page.locator('#status').getAttribute('data-host'), 'PAUSED', 'SDK resume cannot release manual pause');
    await page.locator('#resume').click();
    await waitStatus(page, 'RUNNING');
    await page.evaluate(() => window.__sdkTest.emit('game_api_pause'));
    await waitStatus(page, 'PAUSED');
    assert.ok(await page.evaluate(before => window.__sdkTest.audio.filter(x => x === 'pause').length > before, audioBefore));
    await page.evaluate(() => window.__sdkTest.emit('game_api_resume'));
    await waitStatus(page, 'RUNNING');

    await page.locator('#fullscreen-ad').click();
    await page.evaluate(() => window.__sdkTest.ads.at(-1).callbacks.onClose(false));
    await waitOperation(page, 'fullscreen-ad', 'error');
    assert.equal(await page.locator('#status').getAttribute('data-error-code'), 'ADS_NOT_SHOWN');
    await page.locator('#fullscreen-ad').click();
    await page.evaluate(() => window.__sdkTest.ads.at(-1).callbacks.onOpen());
    await waitStatus(page, 'PAUSED');
    await page.evaluate(() => window.__sdkTest.ads.at(-1).callbacks.onClose(true));
    await waitOperation(page, 'fullscreen-ad');
    await waitStatus(page, 'RUNNING');
    await page.locator('#rewarded-ad').click();
    await page.evaluate(() => window.__sdkTest.ads.at(-1).callbacks.onOpen());
    await waitStatus(page, 'PAUSED');
    await page.evaluate(() => { const ad = window.__sdkTest.ads.at(-1); ad.callbacks.onRewarded(); ad.callbacks.onClose(true); });
    await waitOperation(page, 'rewarded-ad');
    await waitStatus(page, 'RUNNING');
    assert.equal(await page.locator('#status').getAttribute('data-rewarded'), 'true');
    await page.locator('#rewarded-ad').click();
    await page.evaluate(() => {
      const ad = window.__sdkTest.ads.at(-1);
      ad.callbacks.onOpen();
      ad.callbacks.onClose(true);
    });
    await waitOperation(page, 'rewarded-ad');
    assert.equal(await page.locator('#status').getAttribute('data-rewarded'), 'false', 'no callback means no reward');
    await page.locator('#rewarded-ad').click();
    await page.evaluate(() => window.__sdkTest.ads.at(-1).callbacks.onOpen());
    await waitStatus(page, 'PAUSED');
    await page.locator('#pause').click();
    await page.evaluate(() => window.__sdkTest.ads.at(-1).callbacks.onClose(true));
    await waitOperation(page, 'rewarded-ad');
    assert.equal(await page.locator('#status').getAttribute('data-host'), 'PAUSED',
      'manual pause during an ad must outlive its pause lease');
    await page.locator('#resume').click();
    await waitStatus(page, 'RUNNING');

    await page.locator('#save').click();
    await waitOperation(page, 'save');
    assert.equal(await page.evaluate(() => window.__sdkTest.lastFlush), true);
    const oldScore = await page.locator('#score').textContent();
    await page.reload({ waitUntil: 'load' });
    await waitStatus(page, 'READY');
    await page.locator('#restore').click();
    await waitOperation(page, 'restore');
    assert.equal(await page.locator('#score').textContent(), oldScore);

    // New connector/Player instance on reload: guest refusal remains observable, with no local fallback.
    await page.reload({ waitUntil: 'load' });
    await waitStatus(page, 'READY');
    await page.evaluate(() => { window.__sdkTest.playerDenied = true; });
    await page.locator('#save').click();
    await waitOperation(page, 'save', 'error');
    assert.equal(await page.locator('#status').getAttribute('data-error-code'), 'SAVE_FAILED');
    assert.equal(await page.evaluate(() => window.__sdkTest.calls.includes('player:setData')), false);
    await page.evaluate(() => {
      window.__sdkTest.playerDenied = false;
      const current = window.__sdkTest.cloud;
      for (const value of Object.values(current)) value.snapshotSha256 = '0'.repeat(64);
      window.__sdkTest.cloud = current;
    });
    await page.locator('#restore').click();
    await waitOperation(page, 'restore', 'error');
    assert.equal(await page.locator('#status').getAttribute('data-error-code'), 'RESTORE_CORRUPT');
    assert.equal(await page.locator('#score').textContent(), '0', 'bad cloud data cannot mutate state');

    const missing = await context.newPage();
    const missingErrors = [];
    missing.on('pageerror', error => missingErrors.push(String(error)));
    try {
      await missing.route('**/sdk.js', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
      await missing.goto(url, { waitUntil: 'load' });
      await waitOperation(missing, 'bootstrap', 'error');
      assert.equal(await missing.locator('#status').getAttribute('data-host'), null);
      assert.equal(await missing.locator('#start').isDisabled(), true);
      assert.deepEqual(missingErrors, []);
    } finally { await missing.close(); }
    // Regression: Runtime READY is reached before LoadingAPI.ready completes.
    // An SDK ready failure must never be accepted as R3 platform bootstrap success.
    if (fixture.name === 'Chromium desktop') {
      const sdkError = await context.newPage();
      try {
        const failingSdk = fakeSdk.replace("calls.push('loading:ready');",
          "throw new Error('fixture LoadingAPI.ready failed');");
        assert.notEqual(failingSdk, fakeSdk);
        await sdkError.route('**/sdk.js', route => route.fulfill({
          status: 200, contentType: 'text/javascript; charset=utf-8', body: failingSdk,
        }));
        await sdkError.goto(url, { waitUntil: 'load' });
        await waitOperation(sdkError, 'bootstrap', 'error');
        assert.equal(await sdkError.locator('#status').getAttribute('data-host'), 'READY');
        assert.equal(await sdkError.locator('#status').getAttribute('data-sdk-ready'), null);
        assert.equal(await sdkError.locator('#status[data-sdk-ready="true"]').count(), 0);
        assert.equal(await sdkError.locator('#start').isDisabled(), true);
      } finally { await sdkError.close(); }
    }
    assert.deepEqual(errors, []);
    return { browser: fixture.name, engine: fixture.browserType.name(), emulated: fixture.emulated,
      phase: 'complete', status: 'SDK_CONTRACT_PASS' };
  } finally {
    await context.close();
    await browser.close();
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-yandex-c5-browser-'));
let server;
let candidateSha256 = null;
const results = [];
let failure = null;
try {
  const project = path.join(root, 'game');
  fs.mkdirSync(project);
  const plan = planCreate(project, {
    id: 'browser-yandex', title: 'Yandex browser smoke', lang: 'en', version: '1.0.0',
    profile: 'web-game', template: 'yandex-runtime', targets: ['yandex-games'],
  });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  const outputZip = path.join(root, 'candidate.zip');
  const candidate = await buildYandexCandidate({ projectDir: project, outputZip });
  candidateSha256 = candidate.sha256;
  const files = unzipSync(new Uint8Array(fs.readFileSync(outputZip)));
  assert.equal(Object.hasOwn(files, 'sdk.js'), false);
  server = await serve(files);
  for (const variant of fixtures) {
    try { results.push(await runVariant(variant, server.url)); }
    catch (error) {
      results.push({ browser: variant.name, engine: variant.browserType.name(),
        emulated: variant.emulated, phase: 'failed', status: 'SDK_CONTRACT_FAIL' });
      throw error;
    }
  }
  assert.equal(server.requests.filter(name => name === 'sdk.js').length >= fixtures.length, true);
  process.stdout.write(`${JSON.stringify(createYandexC5Evidence({ candidateSha256, results }))}\n`);
} catch (error) {
  failure = error;
  throw error;
} finally {
  try {
    if (process.env.LUDORY_C5_ARTIFACT_DIR) {
      await writeYandexC5Evidence(process.env.LUDORY_C5_ARTIFACT_DIR, { candidateSha256, results, failure });
    }
  } finally {
    await server?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
