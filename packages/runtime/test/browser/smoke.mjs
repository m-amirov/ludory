import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium, firefox, webkit, devices } from 'playwright';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-r6-'));
const plan = planCreate(root, { id: 'r6-smoke', title: 'R6 Smoke', lang: 'en', profile: 'web-game',
  template: 'runtime-basic', targets: ['yandex-games'] });
if (plan.status !== 'READY') throw new Error(plan.conflicts.join('; '));
applyCreatePlan(plan);
const MIME = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!target.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream' }).end(data);
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${server.address().port}/`;
const origin = new URL(url).origin;
const bundleSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'assets/ludory-runtime.js'))).digest('hex');
const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: new URL('../../../../', import.meta.url) }).trim();
const results = [];
async function scenario(name, browserType, options = {}) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  const remoteRequests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {
    const requested = request.url();
    if (!requested.startsWith(origin) && !requested.startsWith('data:')) remoteRequests.push(requested);
  });
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'READY');
    const initialOrientation = options.viewport?.width > options.viewport?.height ? 'landscape' :
      options.isMobile ? 'portrait' : 'landscape';
    const mountedOrientation = await page.locator('#game').getAttribute('data-orientation');
    if (mountedOrientation !== initialOrientation) {
      throw new Error(`Initial orientation was ${mountedOrientation}, expected ${initialOrientation}`);
    }
    await page.click('#start');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'RUNNING');
    if (options.isMobile) await page.locator('#game').tap({ position: { x: 30, y: 30 } });
    else await page.locator('#game').click({ position: { x: 30, y: 30 } });
    await page.waitForFunction(() => Number(document.querySelector('#score').value) > 0);
    let savedScore = Number(await page.locator('#score').textContent());
    await page.locator('#game').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(expected => Number(document.querySelector('#score').value) > expected, savedScore);
    savedScore = Number(await page.locator('#score').textContent());
    await page.click('#pause');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'PAUSED');
    await page.locator('#game').focus();
    await page.keyboard.press('Space');
    await page.click('#resume');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'RUNNING');
    await page.waitForTimeout(80);
    if (Number(await page.locator('#score').textContent()) !== savedScore) {
      throw new Error('Paused input replayed after resume');
    }
    await page.locator('#game').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(expected => Number(document.querySelector('#score').value) > expected, savedScore);
    if (Number(await page.locator('#score').textContent()) !== savedScore + 1) throw new Error('Input duplicated after resume');
    savedScore += 1;
    await page.click('#pause');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'PAUSED');
    await page.click('#save');
    await page.waitForFunction(() => document.querySelector('#status').dataset.lastOperation === 'save:ok');
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('r6-smoke:r6-smoke:runtime-basic')));
    if (!persisted || persisted.snapshot.state.score !== savedScore || !persisted.snapshotSha256) {
      throw new Error('Save completion did not persist a verified snapshot');
    }
    await page.reload();
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'READY');
    await page.click('#restore');
    await page.waitForFunction(expected => window.ludoryHost?.getSnapshot()?.state?.score === expected, savedScore);
    if (Number(await page.locator('#score').textContent()) !== savedScore) throw new Error('Restored DOM does not match Core');
    await page.click('#start');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'RUNNING');
    const audioResult = await page.evaluate(async () => {
      try { await window.ludoryAudio.play('beep'); return 'PLAYED'; }
      catch (error) { return error.code ?? 'ERROR'; }
    });
    if (audioResult !== 'PLAYED') throw new Error(`Audio did not play after user activation: ${audioResult}`);
    await page.click('#sound');
    await page.setViewportSize({ width: 800, height: 480 });
    await page.waitForFunction(() => document.querySelector('#game').dataset.orientation === 'landscape');
    const landscape = await page.locator('#game').boundingBox();
    await page.setViewportSize({ width: 480, height: 800 });
    await page.waitForFunction(() => document.querySelector('#game').dataset.orientation === 'portrait');
    const portrait = await page.locator('#game').boundingBox();
    if (!(landscape.width > portrait.width && landscape.height < portrait.height)) {
      throw new Error('Game root did not respond to viewport change');
    }
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.waitForFunction(() => window.ludoryHost.getStatus() === 'PAUSED');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(() => window.ludoryHost.getStatus() === 'RUNNING');
    await page.click('#stop');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'STOPPED');
    await page.evaluate(() => window.ludoryHost.destroy());
    if (errors.length) throw new Error(errors.join('; '));
    if (remoteRequests.length) throw new Error(`Unexpected external requests: ${remoteRequests.join(', ')}`);
    results.push({ name, verdict: 'PASS', score: savedScore, audioResult, browserVersion: browser.version(),
      viewport: await page.evaluate(() => [innerWidth, innerHeight]), offlineImports: true });
  } finally { await context.close(); await browser.close(); }
}
async function storageDeniedScenario() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('Storage denied', 'SecurityError'); },
  }));
  const page = await context.newPage();
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'READY');
    await page.click('#start');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'RUNNING');
    await page.click('#save');
    await page.waitForFunction(() => document.querySelector('#status').dataset.lastOperation === 'save:error');
    const error = await page.locator('#status').textContent();
    if (!error.startsWith('STORAGE_UNAVAILABLE:')) throw new Error(`Wrong storage denial: ${error}`);
    results.push({ name: 'Chromium denied storage', verdict: 'PASS', errorCode: 'STORAGE_UNAVAILABLE' });
  } finally { await context.close(); await browser.close(); }
}
async function autoplayDeniedScenario() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const OriginalAudio = window.Audio;
    window.Audio = class DeniedAudio extends OriginalAudio {
      play() { return Promise.reject(new DOMException('User gesture required', 'NotAllowedError')); }
    };
  });
  const page = await context.newPage();
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'READY');
    await page.click('#start');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'RUNNING');
    await page.click('#sound');
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'AUDIO_UNAVAILABLE');
    if (await page.evaluate(() => window.ludoryHost.getStatus()) !== 'RUNNING') {
      throw new Error('Autoplay denial stopped gameplay');
    }
    results.push({ name: 'Chromium simulated autoplay denial', verdict: 'PASS', errorCode: 'AUDIO_UNAVAILABLE' });
  } finally { await context.close(); await browser.close(); }
}
try {
  await storageDeniedScenario();
  await autoplayDeniedScenario();
  const variants = [
    ['Chromium desktop', chromium, { viewport: { width: 1200, height: 760 } }],
    ['Firefox desktop', firefox, { viewport: { width: 1200, height: 760 } }],
    ['WebKit desktop', webkit, { viewport: { width: 1200, height: 760 } }],
    ['Android Chromium emulation', chromium, devices['Pixel 7']],
    ['iPhone WebKit emulation', webkit, devices['iPhone 13']],
  ];
  for (const [name, type, settings] of variants) {
    try { await scenario(name, type, settings); }
    catch (error) {
      const detail = String(error);
      const blocked = /Executable doesn't exist|Host system is missing dependencies|browserType.launch:.*ENOENT/s.test(detail);
      results.push({ name, verdict: blocked ? 'BLOCKED' : 'FAIL', error: detail });
      if (process.env.R6_REQUIRE_ALL === '1') throw error;
    }
  }
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, headSha, bundleSha256,
    playwrightVersion: '1.56.1', runtimeR6: results, realDevices: 'NOT_RUN' })}\n`);
  if (results.some(x => x.verdict !== 'PASS')) process.exitCode = 1;
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
