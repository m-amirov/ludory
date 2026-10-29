import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { chromium, firefox, webkit, devices } from 'playwright';

const browserBundle = buildSync({
  entryPoints: [new URL('./yandex-c2-entry.mjs', import.meta.url).pathname],
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'LudoryC2Smoke',
}).outputFiles[0].text;

const variants = [
  ['Chromium desktop', chromium, { viewport: { width: 1000, height: 720 } }],
  ['Firefox desktop', firefox, { viewport: { width: 1000, height: 720 } }],
  ['Android Chromium emulation', chromium, devices['Pixel 7']],
  ['iPhone WebKit emulation', webkit, devices['iPhone 13']],
];

const results = [];
for (const [name, browserType, options] of variants) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.setContent('<!doctype html><html><body><main id="game"></main></body></html>');
    await page.addScriptTag({ content: browserBundle });
    const result = await page.evaluate(async () => {
      const { createRuntimeHost, createYandexLifecycle } = window.LudoryC2Smoke;
      const calls = [];
      const handlers = new Map();
      const sdk = {
        features: {
          LoadingAPI: { ready() { calls.push('loading:ready'); } },
          GameplayAPI: {
            start() { calls.push('gameplay:start'); },
            stop() { calls.push('gameplay:stop'); },
          },
        },
        on(name, fn) { handlers.set(name, fn); },
        off(name, fn) { if (handlers.get(name) === fn) handlers.delete(name); },
      };
      const audio = {
        pauseAll() { calls.push('audio:pause'); },
        resumeAll() { calls.push('audio:resume'); },
      };
      const host = createRuntimeHost({
        game: { schemaVersion: 1, id: 'browser-c2', version: '1.0.0',
          title: { en: 'Browser C2' }, engine: 'web', targets: ['yandex-games'] },
        initialState: { tick: 0 },
        update({ state, setState }) { setState({ tick: state.tick + 1 }); },
        renderer: { mount() {}, resize() {}, render() {}, unmount() {} },
        input: { subscribe() { return () => {}; }, enable() { calls.push('input:enable'); },
          disable() { calls.push('input:disable'); } },
        audio,
        environment: {
          root: document.querySelector('#game'),
          now: () => performance.now(),
          requestFrame: fn => requestAnimationFrame(fn),
          cancelFrame: id => cancelAnimationFrame(id),
          getViewport: () => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1,
            orientation: innerWidth > innerHeight ? 'landscape' : 'portrait' }),
          observeViewport() { return () => {}; },
        },
      });
      const lifecycle = createYandexLifecycle({ sdk, host });
      lifecycle.attach();
      await host.initialize();
      if (await lifecycle.markReady() !== true) throw new Error('ready marker rejected');
      host.start();
      if (host.getStatus() !== 'RUNNING') throw new Error('host failed to run');
      handlers.get('game_api_pause')();
      if (host.getStatus() !== 'PAUSED') throw new Error('SDK pause failed');
      lifecycle.setManualPaused(true);
      handlers.get('game_api_resume')();
      if (host.getStatus() !== 'PAUSED') throw new Error('manual pause was overridden');
      lifecycle.setManualPaused(false);
      host.resume();
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      if (host.getStatus() !== 'PAUSED') throw new Error('BFCache pagehide did not pause');
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      if (host.getStatus() !== 'RUNNING') throw new Error('BFCache pageshow did not resume');
      lifecycle.detach();
      await host.destroy();
      return { calls, remainingSdkHandlers: handlers.size, status: host.getStatus() };
    });
    assert.equal(result.status, 'DESTROYED');
    assert.equal(result.remainingSdkHandlers, 0);
    assert.deepEqual(result.calls.filter(x => x.startsWith('gameplay:')),
      ['gameplay:start', 'gameplay:stop', 'gameplay:start', 'gameplay:stop', 'gameplay:start', 'gameplay:stop']);
    assert.ok(result.calls.includes('audio:pause'));
    assert.ok(result.calls.includes('audio:resume'));
    assert.equal(result.calls.filter(x => x === 'loading:ready').length, 1);
    assert.deepEqual(errors, []);
    results.push({ name, verdict: 'PASS', sdk: 'fake', device: 'emulated' });
  } finally {
    await context.close();
    await browser.close();
  }
}
process.stdout.write(`${JSON.stringify({ connectYandexC2: results, platformSdk: 'NOT_RUN', realDevices: 'NOT_RUN' })}\n`);
