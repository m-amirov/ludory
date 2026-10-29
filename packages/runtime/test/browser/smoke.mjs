import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
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
const results = [];
async function scenario(name, browserType, options = {}) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'READY');
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
    await page.click('#save');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'PAUSED');
    await page.reload();
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'READY');
    await page.click('#restore');
    await page.waitForFunction(expected => window.ludoryHost?.getSnapshot()?.state?.score === expected, savedScore);
    await page.click('#start');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'RUNNING');
    const audioResult = await page.evaluate(async () => {
      try { await window.ludoryAudio.play('beep'); return 'PLAYED'; }
      catch (error) { return error.code ?? 'ERROR'; }
    });
    if (!['PLAYED', 'AUDIO_UNAVAILABLE'].includes(audioResult)) throw new Error(`Unexpected audio result: ${audioResult}`);
    await page.click('#sound');
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.click('#stop');
    await page.waitForFunction(() => window.ludoryHost?.getStatus() === 'STOPPED');
    await page.evaluate(() => window.ludoryHost.destroy());
    if (errors.length) throw new Error(errors.join('; '));
    results.push({ name, verdict: 'PASS', score: savedScore, audioResult,
      viewport: await page.evaluate(() => [innerWidth, innerHeight]) });
  } finally { await context.close(); await browser.close(); }
}
try {
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
      results.push({ name, verdict: 'FAIL_OR_BLOCKED', error: String(error) });
      if (process.env.R6_REQUIRE_ALL === '1') throw error;
    }
  }
  process.stdout.write(`${JSON.stringify({ runtimeR6: results, realDevices: 'NOT_RUN' })}\n`);
  if (results.some(x => x.verdict !== 'PASS')) process.exitCode = 1;
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
