import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../');
const routes = new Map([
  ['/', [resolve(here, 'fixture.html'), 'text/html; charset=utf-8']],
  ['/phaser.js', [resolve(here, 'node_modules/phaser/dist/phaser.min.js'), 'text/javascript']],
  ['/adapter.mjs', [resolve(repo, 'packages/runtime-phaser/src/index.mjs'), 'text/javascript']],
  ['/contracts.mjs', [resolve(repo, 'packages/runtime/src/contracts.mjs'), 'text/javascript']],
]);
const server = createServer(async (req, res) => {
  const requestPath = new URL(req.url, 'http://localhost').pathname;
  if (requestPath === '/early') {
    const html = await readFile(resolve(here, 'early-fixture.html'), 'utf8');
    const [head, tail] = html.split('<!-- PARSER_WAIT_HERE -->');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.write(head);
    // Keep the parser in readyState=loading while async import completes.
    setTimeout(() => res.end(tail), 1_000);
    return;
  }
  const route = routes.get(requestPath);
  if (!route) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(route[0]);
    res.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});

await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__smoke, null, { timeout: 20_000 });
  const { ok, result, error } = await page.evaluate(() => window.__smoke);
  assert.equal(ok, true, error);
  // Phaser destroys the canvas on a later game step, after unmount returns.
  await page.waitForFunction(() => document.querySelector('#game canvas') === null, null, { timeout: 3_000 });
  assert.deepEqual({ booted: result.booted, initialCanvasValid: result.initialCanvasValid,
    originalUntouched: result.originalUntouched,
    inputAccepted: result.inputAccepted, inputCount: result.inputCount,
    inputSource: result.inputSource, canvasWidth: result.canvasWidth,
    canvasHeight: result.canvasHeight, inputAfterUnmount: result.inputAfterUnmount },
  { booted: true, initialCanvasValid: true, originalUntouched: true, inputAccepted: true, inputCount: 1,
    inputSource: 'renderer', canvasWidth: 360, canvasHeight: 640, inputAfterUnmount: false });
  assert.deepEqual(result.viewport, { width: 360, height: 640, dpr: 2, orientation: 'portrait' });
  for (const [attempt, stalled] of result.stalledAttempts.entries()) {
    assert.match(stalled.error, /timed out/i);
    assert.equal(stalled.canvasCount, 0, `stalled attempt ${attempt} must not leak DOM canvas`);
    assert.equal(stalled.poolTotal, result.stalledPoolBaseline, `stalled attempt ${attempt} must return CanvasPool usage to baseline`);
    assert.equal(stalled.retainedInput, false, `stalled attempt ${attempt} retains InputManager.game`);
    assert.equal(stalled.retainedScale, false, `stalled attempt ${attempt} retains ScaleManager.game`);
    assert.equal(stalled.retainedTextures, false, `stalled attempt ${attempt} retains TextureManager.game`);
  }
  assert.match(result.immediateAbort.abortMountError, /interrupted/i);
  assert.equal(result.immediateAbort.abortUnmountError, null);
  assert.equal(result.immediateAbort.canvasCount, 0);
  assert.equal(result.immediateAbort.poolTotal, result.stalledPoolBaseline);
  assert.equal(result.immediateAbort.retainedInput, false);
  assert.equal(result.immediateAbort.retainedScale, false);
  assert.equal(result.immediateAbort.retainedTextures, false);
  assert.equal(result.remountAfterAbort, true, 'Phaser must mount again after cancelled startup');
  assert.equal(result.remountCanvasRemoved, true, 'remounted game must unmount cleanly');
  assert.equal(result.stoppedLoopCleanup.gameStillMarkedRunning, true,
    'regression must reproduce actual Phaser TimeStep.stop() keeping Game.isRunning true');
  assert.equal(result.stoppedLoopCleanup.canvasCount, 0,
    'stopped game loop cannot defer cleanup to a future frame');
  assert.equal(result.stoppedLoopCleanup.poolTotal, result.stalledPoolBaseline);
  assert.equal(result.stoppedLoopCleanup.retainedScale, false);
  assert.equal(result.stoppedLoopCleanup.disposalsAfterSecond, 1,
    'a concurrent second unmount must await the same scene disposal');
  assert.equal(result.stoppedLoopCleanup.disposals, 1);
  assert.equal(result.reentrantPreBootCleanup.preBootCalled, true,
    'real Phaser must invoke a preBoot callback during its constructor');
  assert.match(result.reentrantPreBootCleanup.mountError, /interrupted/i);
  assert.equal(result.reentrantPreBootCleanup.canvasCount, 0,
    'preBoot reentrant unmount cannot leave an orphan canvas');
  assert.equal(result.reentrantPreBootCleanup.poolTotal, result.stalledPoolBaseline);
  assert.equal(result.reentrantPostBootCleanup.postBootCalled, true,
    'real Phaser must invoke postBoot immediately before starting its loop');
  assert.match(result.reentrantPostBootCleanup.mountResult, /interrupted/i);
  assert.equal(result.reentrantPostBootCleanup.canvasCount, 0,
    'postBoot reentrant unmount cannot leave an orphan canvas');
  assert.equal(result.reentrantPostBootCleanup.poolTotal, result.stalledPoolBaseline);
  assert.equal(result.reentrantPostBootCleanup.retainedScale, false);
  assert.deepEqual(errors, []);
  const earlyPage = await browser.newPage();
  const earlyErrors = [];
  earlyPage.on('pageerror', error => earlyErrors.push(String(error)));
  await earlyPage.goto(`http://127.0.0.1:${server.address().port}/early`, { waitUntil: 'load' });
  await earlyPage.waitForFunction(() => window.__early);
  await earlyPage.waitForTimeout(120);
  const early = await earlyPage.evaluate(() => ({ ...window.__early,
    constructedCanvas: document.querySelectorAll('#game canvas').length,
    poolAfter: Phaser.Display.Canvas.CanvasPool.total(),
  }));
  assert.equal(early.testError, undefined, early.testError);
  assert.equal(early.stateAtStart, 'loading');
  assert.match(early.mountError, /interrupted/i);
  assert.equal(early.unmountError, null);
  assert.equal(early.constructedBefore, 0);
  assert.equal(early.constructedAfter, 0);
  assert.equal(early.constructedCanvas, 0);
  assert.equal(early.poolAfter, early.baseline);
  assert.deepEqual(earlyErrors, []);
  console.log('PASS_REAL_PHASER_BROWSER_SMOKE', JSON.stringify(result));
  console.log('PASS_PRE_DOM_READY_CANCELLATION', JSON.stringify(early));
} finally {
  await browser?.close();
  await new Promise((resolveServer, reject) => server.close(error => error ? reject(error) : resolveServer()));
}
