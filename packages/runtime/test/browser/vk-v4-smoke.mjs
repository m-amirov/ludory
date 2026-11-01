import '../../../studio/test/setup-trust-env.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium, devices } from 'playwright';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';

// This fixture replaces a LOCAL ESM module on a LOCAL test server. It is never included in a generated game.
const fakeBridge = String.raw`
const listeners = new Set();
const state = {
  calls: [], ads: [],
  emit(type) { for (const listener of listeners) listener({ detail: { type } }); },
  get cloud() { return JSON.parse(localStorage.getItem('__vk_v4_cloud') || '{}'); },
  set cloud(value) { localStorage.setItem('__vk_v4_cloud', JSON.stringify(value)); },
};
globalThis.__vkTest = state;
globalThis.Audio = class {
  constructor(src) { this.src = src; this.currentTime = 0; this.paused = true; this.volume = 1; this.muted = false; }
  addEventListener() {}
  removeEventListener() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
};
const bridge = {
  subscribe(fn) { listeners.add(fn); },
  unsubscribe(fn) { listeners.delete(fn); },
  send(method, params) {
    state.calls.push({ method, params });
    if (method === 'VKWebAppInit') return Promise.resolve({ result: true });
    if (method === 'VKWebAppStorageGet') {
      const cloud = state.cloud;
      return Promise.resolve({ keys: params.keys.filter(key => Object.hasOwn(cloud, key))
        .map(key => ({ key, value: cloud[key] })) });
    }
    if (method === 'VKWebAppStorageSet') {
      state.cloud = { ...state.cloud, [params.key]: params.value };
      return Promise.resolve({ result: true });
    }
    if (method === 'VKWebAppShowNativeAds') {
      return new Promise((resolve, reject) => { state.ads.push({ format: params.ad_format, resolve, reject }); });
    }
    return Promise.reject(new Error('Unexpected VK method: ' + method));
  },
};
export default bridge;`;

const types = filename => filename.endsWith('.html') ? 'text/html; charset=utf-8'
  : filename.endsWith('.json') ? 'application/json'
    : 'text/javascript; charset=utf-8';

async function startServer(root) {
  const files = new Set(['index.html', 'src/main.js', 'ludory.project.json',
    'assets/ludory-vk.js', 'assets/vk-bridge.js']);
  const requests = [];
  const server = createServer((request, response) => {
    const raw = new URL(request.url, 'http://localhost').pathname;
    const name = raw === '/' ? 'index.html' : raw.slice(1);
    requests.push(name);
    if (!files.has(name)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': types(name), 'Cache-Control': 'no-store' });
    response.end(name === 'assets/vk-bridge.js' ? fakeBridge : fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

async function operation(page, action, result = 'ok') {
  await page.waitForFunction(({ action, result }) =>
    document.querySelector('#status')?.dataset.lastOperation === `${action}:${result}`,
  { action, result }, { timeout: 8000 });
}

async function hostStatus(page, expected) {
  await page.waitForFunction(value => document.querySelector('#status')?.dataset.host === value,
    expected, { timeout: 8000 });
}

async function responsive(page) {
  const state = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll('#controls button')].map(button => {
      const r = button.getBoundingClientRect();
      return { label: button.textContent, left: r.left, right: r.right, height: r.height };
    }),
  }));
  assert.ok(state.scrollWidth <= state.viewport + 1, `Horizontal overflow: ${JSON.stringify(state)}`);
  for (const button of state.buttons) {
    assert.ok(button.left >= 0 && button.right <= state.viewport + 1 && button.height >= 44,
      `Inaccessible control: ${JSON.stringify(button)}`);
  }
}

async function runVariant(browser, config, label, url) {
  const context = await browser.newContext(config);
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {
    if (!request.url().startsWith(url)) external.push(request.url());
  });
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.locator('#status[data-sdk-ready="true"][data-host="READY"]').waitFor();
    assert.equal(await page.locator('#restore').isEnabled(), true, 'Restore is legal before Start');
    await responsive(page);
    assert.equal(await page.locator('#reward-notice').count(), 1, 'Ad acknowledgement must be visibly labelled');
    assert.match(await page.locator('#reward-notice').textContent(), /not confirmed/i);
    assert.deepEqual(await page.evaluate(() => __vkTest.calls.map(call => call.method)), ['VKWebAppInit']);
    assert.equal(await page.evaluate(() => __vkTest.ads.length), 0, 'Ads must not show automatically');

    await page.locator('#start').click();
    await hostStatus(page, 'RUNNING');
    assert.equal(await page.locator('#restore').isDisabled(), true,
      'Restore must not offer an invalid transition during gameplay');
    if (label === 'Android emulation') await page.locator('#game').tap();
    else await page.locator('#game').click();
    await page.waitForFunction(() => document.querySelector('#score')?.textContent === '1');
    await page.locator('#sound').click();
    await operation(page, 'sound');

    await page.locator('#pause').click();
    await hostStatus(page, 'PAUSED');
    await page.evaluate(() => { __vkTest.emit('VKWebAppViewHide'); __vkTest.emit('VKWebAppViewRestore'); });
    assert.equal(await page.locator('#status').getAttribute('data-host'), 'PAUSED',
      'VK restore cannot discard the manual pause');
    await page.locator('#resume').click();
    await hostStatus(page, 'RUNNING');
    await page.evaluate(() => __vkTest.emit('VKWebAppViewHide'));
    await hostStatus(page, 'PAUSED');
    await page.evaluate(() => __vkTest.emit('VKWebAppViewRestore'));
    await hostStatus(page, 'RUNNING');

    await page.locator('#fullscreen-ad').click();
    await hostStatus(page, 'PAUSED');
    await page.evaluate(() => __vkTest.ads.at(-1).resolve({ result: true }));
    await operation(page, 'fullscreen-ad');
    await hostStatus(page, 'RUNNING');
    await page.locator('#rewarded-ad').click();
    await hostStatus(page, 'PAUSED');
    assert.equal(await page.evaluate(() => __vkTest.ads.at(-1).format), 'reward');
    await page.evaluate(() => __vkTest.ads.at(-1).resolve({ result: false }));
    await operation(page, 'rewarded-ad', 'error');
    assert.equal(await page.locator('#status').getAttribute('data-rewarded'), 'false');
    assert.match(await page.locator('#reward-notice').textContent(), /not confirmed/i);
    await hostStatus(page, 'RUNNING');
    await page.locator('#rewarded-ad').click();
    await hostStatus(page, 'PAUSED');
    await page.evaluate(() => __vkTest.ads.at(-1).resolve({ result: true }));
    await operation(page, 'rewarded-ad');
    assert.equal(await page.locator('#status').getAttribute('data-rewarded'), 'true');
    assert.match(await page.locator('#reward-notice').textContent(), /SDK confirmed.*no prize credited/i);
    await hostStatus(page, 'RUNNING');
    await page.locator('#rewarded-ad').click();
    await hostStatus(page, 'PAUSED');
    await page.evaluate(() => __vkTest.ads.at(-1).resolve({ result: false }));
    await operation(page, 'rewarded-ad', 'error');
    assert.equal(await page.locator('#status').getAttribute('data-rewarded'), 'false');
    assert.match(await page.locator('#reward-notice').textContent(), /not confirmed/i,
      'A previous successful ad must not label a later failed attempt as successful');
    await hostStatus(page, 'RUNNING');

    await page.locator('#save').click();
    await operation(page, 'save');
    const saved = await page.evaluate(() => __vkTest.cloud);
    assert.equal(Object.keys(saved).length, 1, 'Only one VK-scoped save key is used');
    await page.reload({ waitUntil: 'load' });
    await hostStatus(page, 'READY');
    assert.equal(await page.locator('#restore').isEnabled(), true, 'Reload permits restore before Start');
    await page.locator('#restore').click();
    await operation(page, 'restore');
    assert.equal(await page.locator('#score').textContent(), '1');
    await responsive(page);

    const missing = await context.newPage();
    try {
      await missing.route('**/assets/vk-bridge.js', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'unavailable' }));
      await missing.goto(url, { waitUntil: 'load' });
      await missing.locator('#status[data-last-operation="bootstrap:error"]').waitFor({ timeout: 8000 });
      assert.equal(await missing.locator('#start').isDisabled(), true);
      assert.equal(await missing.locator('#status').getAttribute('data-sdk-ready'), null);
    } finally { await missing.close(); }

    const rejected = await context.newPage();
    try {
      const rejectingBridge = fakeBridge.replace("if (method === 'VKWebAppInit') return Promise.resolve({ result: true });",
        "if (method === 'VKWebAppInit') return Promise.reject(new Error('VK app refused initialization'));" );
      await rejected.route('**/assets/vk-bridge.js', route => route.fulfill({
        status: 200, contentType: 'text/javascript', body: rejectingBridge,
      }));
      await rejected.goto(url, { waitUntil: 'load' });
      await rejected.locator('#status[data-error-code="SDK_INIT_FAILED"]').waitFor({ timeout: 8000 });
      assert.equal(await rejected.locator('#start').isDisabled(), true);
    } finally { await rejected.close(); }

    const foreign = await context.newPage();
    try {
      await foreign.route('**/ludory.project.json', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ schemaVersion: 1, id: 'vk-smoke', version: '0.1.0',
          title: { en: 'Foreign' }, engine: 'web', targets: ['yandex-games'] }),
      }));
      await foreign.goto(url, { waitUntil: 'load' });
      await foreign.locator('#status[data-last-operation="bootstrap:error"]').waitFor({ timeout: 8000 });
      assert.equal(await foreign.locator('#start').isDisabled(), true);
    } finally { await foreign.close(); }

    assert.deepEqual(errors, [], `${label} page errors`);
    assert.deepEqual(external, [], `${label} must not fetch remote scripts`);
    process.stdout.write(`VK V4 ${label}: contract PASS (fake Bridge, not live VK)\n`);
  } finally { await context.close(); }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-vk-v4-browser-'));
let server;
let browser;
try {
  const plan = planCreate(root, { id: 'vk-smoke', title: 'VK Smoke', lang: 'en', version: '0.1.0',
    profile: 'web-game', template: 'vk-runtime', targets: ['vk-games'] });
  assert.equal(plan.status, 'READY', plan.conflicts.join('; '));
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  server = await startServer(root);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await runVariant(browser, { viewport: { width: 1000, height: 720 } }, 'Desktop 1000x720', server.url);
  await runVariant(browser, devices['Pixel 7'], 'Android emulation', server.url);
  assert.ok(server.requests.every(name => name !== 'sdk.js' && !name.includes('yandex')));
} finally {
  await browser?.close();
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
