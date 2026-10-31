import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../');
const routes = new Map([
  ['/phaser.js', resolve(here, 'node_modules/phaser/dist/phaser.min.js')],
  ['/adapter.mjs', resolve(repo, 'packages/runtime-phaser/src/index.mjs')],
  ['/contracts.mjs', resolve(repo, 'packages/runtime/src/contracts.mjs')],
  ['/ludory-yandex.js', resolve(repo, 'packages/studio/catalog/templates/yandex-runtime/assets/ludory-yandex.js')],
]);

// The SDK fixture is test-only. Neither this script nor its HTML are emitted by the packager.
const html = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="importmap">{"imports":{"@ludory/runtime/contracts":"/contracts.mjs"}}</script>
<script src="/phaser.js"></script></head>
<body><div id="game" style="width:360px;height:560px"></div>
<script type="module">
import { createRuntimeHost, createBrowserEnvironment, createYandexLifecycle } from '/ludory-yandex.js';
import { createPhaserRenderer } from '/adapter.mjs';

const sdkCalls = [];
const listeners = new Map();
const sdk = {
  features: {
    LoadingAPI: { ready() { sdkCalls.push('loading:ready'); } },
    GameplayAPI: {
      start() { sdkCalls.push('gameplay:start'); },
      stop() { sdkCalls.push('gameplay:stop'); },
    },
  },
  on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
  off(name, fn) { listeners.get(name)?.delete(fn); },
};
const audioCalls = [];
const audio = { pauseAll() { audioCalls.push('pause'); }, resumeAll() { audioCalls.push('resume'); } };
let sceneDispatch;
let sceneCreated = false;
let sceneDisposed = false;
let viewportAfterResize = null;
let renderCount = 0;
const root = document.querySelector('#game');
const renderer = createPhaserRenderer({ Phaser: window.Phaser,
  gameConfig: { type: Phaser.CANVAS, backgroundColor: '#132534' },
  sceneFactory({ dispatchInput }) {
    sceneDispatch = dispatchInput;
    let announceReady;
    const ready = new Promise(resolve => { announceReady = resolve; });
    return {
      scene: { create() {
        sceneCreated = true;
        this.input.on('pointerdown', pointer => {
          sceneDispatch({ schemaVersion: 1, type: 'touch', action: 'activate', phase: 'down',
            source: 'renderer', timestamp: performance.now(),
            pointer: { id: pointer.id, x: pointer.x, y: pointer.y } });
        });
        announceReady();
      } },
      ready,
      renderSnapshot() { renderCount++; },
      onResize(viewport) { viewportAfterResize = viewport; },
      dispose() { sceneDisposed = true; },
    };
  },
});
const game = { schemaVersion: 1, id: 'phaser-yandex-c5', version: '1.0.0',
  title: { ru: 'Тест Phaser C5', en: 'Phaser C5 test' },
  engine: 'phaser', targets: ['yandex-games'] };
const input = {
  subscribe() { return () => {}; },
  enable() {}, disable() {},
};
const host = createRuntimeHost({ game, initialState: { score: 0 }, renderer, input,
  environment: createBrowserEnvironment({ root }), audio,
  update({ inputs, state, setState }) {
    if (inputs.some(e => e.type === 'touch' && e.action === 'activate' && e.phase === 'down')) {
      setState({ score: state.score + 1 });
    }
  },
});
const lifecycle = createYandexLifecycle({ sdk, host, audio });
const emit = name => { for (const listener of listeners.get(name) ?? []) listener(); };
const bridge = { sdkCalls, audioCalls, host, lifecycle, emit, get sceneCreated() { return sceneCreated; },
  get sceneDisposed() { return sceneDisposed; }, get viewportAfterResize() { return viewportAfterResize; },
  get renderCount() { return renderCount; }, get sceneDispatch() { return sceneDispatch; }, ready: false };
window.__c5Phaser = bridge;
try {
  lifecycle.attach();
  await host.initialize();
  if (!await lifecycle.markReady()) throw new Error('Yandex loading marker rejected');
  host.start();
  bridge.ready = true;
} catch (error) { bridge.error = String(error) + String(error?.cause ?? ''); }
</script></body></html>`;

const requests = [];
const server = createServer(async (request, response) => {
  const requestPath = new URL(request.url, 'http://localhost').pathname;
  requests.push(requestPath);
  if (requestPath === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
    return;
  }
  const file = routes.get(requestPath);
  if (!file) { response.writeHead(404); response.end(); return; }
  try {
    response.writeHead(200, { 'Content-Type': requestPath.endsWith('.js') || requestPath.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream' });
    response.end(await readFile(file));
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});

await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 420, height: 760 },
    deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__c5Phaser?.ready || window.__c5Phaser?.error, null, { timeout: 20_000 });
  const boot = await page.evaluate(() => ({ error: window.__c5Phaser.error,
    status: window.__c5Phaser.host.getStatus(), created: window.__c5Phaser.sceneCreated,
    loadingCalls: [...window.__c5Phaser.sdkCalls], canvas: document.querySelectorAll('#game canvas').length }));
  assert.equal(boot.error, undefined);
  assert.equal(boot.created, true);
  assert.equal(boot.status, 'RUNNING');
  assert.equal(boot.canvas, 1);
  assert.deepEqual(boot.loadingCalls, ['loading:ready', 'gameplay:start']);

  await page.locator('#game canvas').tap({ position: { x: 150, y: 180 } });
  await page.waitForFunction(() => window.__c5Phaser.host.getSnapshot().state.score === 1);
  const paused = await page.evaluate(() => {
    const b = window.__c5Phaser;
    b.lifecycle.setManualPaused(true);
    b.host.pause();
    b.emit('game_api_pause');
    b.emit('game_api_resume');
    return { status: b.host.getStatus(), audio: [...b.audioCalls], sdk: [...b.sdkCalls] };
  });
  assert.equal(paused.status, 'PAUSED', 'platform resume cannot override manual pause');
  assert.ok(paused.audio.includes('pause'));
  assert.equal(paused.sdk.at(-1), 'gameplay:stop');
  const lifecycleResult = await page.evaluate(() => {
    const b = window.__c5Phaser;
    b.lifecycle.setManualPaused(false);
    b.host.resume();
    b.emit('game_api_pause');
    const platformPaused = b.host.getStatus();
    b.emit('game_api_resume');
    const platformResumed = b.host.getStatus();
    const acceptedWhileRunning = b.sceneDispatch({ schemaVersion: 1, type: 'touch',
      action: 'activate', phase: 'up', timestamp: performance.now(), source: 'renderer',
      pointer: { id: 1, x: 20, y: 20 } });
    return { platformPaused, platformResumed, acceptedWhileRunning, audio: [...b.audioCalls] };
  });
  assert.equal(lifecycleResult.platformPaused, 'PAUSED');
  assert.equal(lifecycleResult.platformResumed, 'RUNNING');
  assert.equal(lifecycleResult.acceptedWhileRunning, true);
  assert.ok(lifecycleResult.audio.filter(x => x === 'resume').length >= 2);

  await page.evaluate(() => {
    const root = document.querySelector('#game');
    root.style.width = '480px';
    root.style.height = '270px';
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(() => document.querySelector('#game canvas')?.width === 480);
  const resizing = await page.evaluate(() => ({ canvasWidth: document.querySelector('#game canvas')?.width,
    viewport: window.__c5Phaser.viewportAfterResize }));
  assert.equal(resizing.canvasWidth, 480);
  assert.equal(resizing.viewport?.width, 480);
  assert.equal(resizing.viewport?.height, 270);

  const finish = await page.evaluate(async () => {
    const b = window.__c5Phaser;
    b.host.stop();
    const scoreAtStop = b.host.getSnapshot().state.score;
    const inputAfterStop = b.sceneDispatch({ schemaVersion: 1, type: 'touch', action: 'activate',
      phase: 'down', timestamp: performance.now(), source: 'renderer', pointer: { id: 1, x: 5, y: 5 } });
    const scoreAfterStopInput = b.host.getSnapshot().state.score;
    b.lifecycle.detach();
    await b.host.destroy();
    const inputAfterDestroy = b.sceneDispatch({ schemaVersion: 1, type: 'touch', action: 'activate',
      phase: 'down', timestamp: performance.now(), source: 'renderer', pointer: { id: 1, x: 5, y: 5 } });
    return { status: b.host.getStatus(), disposed: b.sceneDisposed, inputAfterStop, inputAfterDestroy,
      scoreAtStop, scoreAfterStopInput, sdkCalls: [...b.sdkCalls], audioCalls: [...b.audioCalls] };
  });
  await page.waitForFunction(() => document.querySelector('#game canvas') === null, null, { timeout: 4_000 });
  assert.equal(finish.status, 'DESTROYED');
  assert.equal(finish.disposed, true);
  assert.equal(finish.scoreAfterStopInput, finish.scoreAtStop,
    'Runtime must discard renderer input after stop even while Phaser is mounted');
  assert.equal(finish.inputAfterDestroy, false);
  assert.equal(finish.sdkCalls.at(-1), 'gameplay:stop');
  assert.deepEqual(pageErrors, []);
  assert.equal(requests.some(x => /vk|sdk\.js/i.test(x)), false, 'Phaser fixture must not load a foreign or host SDK');
  console.log(JSON.stringify({ stage: 'Connect Yandex C5 / optional Phaser',
    engine: 'Phaser 3.90.0', browser: 'Chromium touch emulation',
    verdict: 'SDK_CONTRACT_PASS', liveYandex: 'YANDEX_LIVE_NOT_RUN',
    physicalDevices: 'NOT_RUN', scoreAfterTouch: 1, canvasWidthAfterResize: resizing.canvasWidth,
    audioCalls: finish.audioCalls.length, sdkCalls: finish.sdkCalls.length }));
} finally {
  await browser?.close();
  await new Promise((resolveServer, reject) => server.close(error => error ? reject(error) : resolveServer()));
}
