import test from 'node:test';
import assert from 'node:assert/strict';
import { createYandexAds } from '../src/ads.mjs';
import { createYandexLifecycle } from '../src/lifecycle.mjs';
import { createRuntimeHost } from '@ludory/runtime';

function fixture({ fullscreen = true, rewarded = true } = {}) {
  let status = 'RUNNING';
  const listeners = new Set();
  const events = new Map();
  const calls = [];
  const host = {
    getStatus: () => status,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    pause() { assert.equal(status, 'RUNNING'); calls.push('pause'); transition('PAUSED'); },
    resume() { assert.equal(status, 'PAUSED'); calls.push('resume'); transition('RUNNING'); },
  };
  function transition(next) {
    status = next;
    for (const fn of listeners) fn({ schemaVersion: 1, type: 'status', status });
  }
  const sdkEvents = new Map();
  const sdk = {
    features: { GameplayAPI: { start() {}, stop() {} } },
    on(name, callback) { sdkEvents.set(name, callback); },
    off(name, callback) { if (sdkEvents.get(name) === callback) sdkEvents.delete(name); },
    adv: {
      ...(fullscreen ? { showFullscreenAdv({ callbacks }) { calls.push('fullscreen'); events.set('fullscreen', callbacks); } } : {}),
      ...(rewarded ? { showRewardedVideo({ callbacks }) { calls.push('rewarded'); events.set('rewarded', callbacks); } } : {}),
    },
  };
  const lifecycle = createYandexLifecycle({ sdk, host });
  lifecycle.attach();
  return {
    sdk, host, lifecycle, calls, events,
    ads: createYandexAds({ sdk, host, lifecycle }),
    emitSdk(name) { sdkEvents.get(name)?.(); },
    transition,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error?.name === 'YandexConnectError' && error.code === code);
}

test('constructor validates inputs and creation never calls SDK', () => {
  assert.throws(() => createYandexAds(), TypeError);
  assert.throws(() => createYandexAds({ sdk: {}, host: {}, lifecycle: {} }), TypeError);
  const f = fixture();
  assert.equal(Object.isFrozen(f.ads), true);
  assert.deepEqual(f.calls, []);
});

test('fullscreen waits for SDK callbacks, pauses on open and resumes after observed close', async () => {
  const f = fixture();
  const pending = f.ads.showFullscreen();
  assert.deepEqual(f.calls, ['fullscreen']);
  assert.equal(f.host.getStatus(), 'RUNNING', 'request alone does not pause gameplay');
  let done = false;
  pending.finally(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false, 'SDK returning void is not proof of display');
  f.events.get('fullscreen').onOpen();
  assert.equal(f.host.getStatus(), 'PAUSED');
  f.events.get('fullscreen').onClose(true);
  assert.deepEqual(await pending, { shown: true });
  assert.equal(f.host.getStatus(), 'RUNNING');
  assert.deepEqual(f.calls, ['fullscreen', 'pause', 'resume']);
});

test('fullscreen no-show and SDK error reject without fabricated display', async () => {
  const f = fixture();
  const noShow = f.ads.showFullscreen();
  f.events.get('fullscreen').onClose(false);
  await expectCode(noShow, 'ADS_NOT_SHOWN');
  assert.deepEqual(f.calls, ['fullscreen']);
  const failure = f.ads.showFullscreen();
  f.events.get('fullscreen').onOpen();
  assert.equal(f.host.getStatus(), 'PAUSED');
  f.events.get('fullscreen').onError(new Error('network'));
  await expectCode(failure, 'ADS_FAILED');
  assert.equal(f.host.getStatus(), 'RUNNING');
});

test('rewarded returns true only on open, rewarded, shown close in that order', async () => {
  const f = fixture();
  const success = f.ads.showRewarded();
  const callbacks = f.events.get('rewarded');
  callbacks.onRewarded(); // Spoofed pre-open callback must not earn the reward.
  callbacks.onOpen();
  callbacks.onClose(true);
  assert.deepEqual(await success, { shown: true, rewarded: false });
  const valid = f.ads.showRewarded();
  const validCallbacks = f.events.get('rewarded');
  validCallbacks.onOpen();
  validCallbacks.onRewarded();
  validCallbacks.onRewarded();
  validCallbacks.onClose(true);
  assert.deepEqual(await valid, { shown: true, rewarded: true });
  assert.deepEqual(f.calls, ['rewarded', 'pause', 'resume', 'rewarded', 'pause', 'resume']);
});

test('rewarded no-show rejects even when a reward callback arrived', async () => {
  const f = fixture();
  const pending = f.ads.showRewarded();
  const callbacks = f.events.get('rewarded');
  callbacks.onOpen();
  callbacks.onRewarded();
  callbacks.onClose(false);
  await expectCode(pending, 'ADS_NOT_SHOWN');
  assert.equal(f.host.getStatus(), 'RUNNING');
});

test('close(true) without onOpen rejects; duplicate and late callbacks cannot create rewards or pause', async () => {
  const f = fixture();
  const early = f.ads.showRewarded();
  const stale = f.events.get('rewarded');
  stale.onClose(true);
  await expectCode(early, 'ADS_FAILED');
  stale.onOpen();
  stale.onRewarded();
  stale.onClose(true);
  assert.deepEqual(f.calls, ['rewarded']);
  const next = f.ads.showRewarded();
  const current = f.events.get('rewarded');
  current.onOpen();
  current.onOpen();
  current.onClose(true);
  current.onRewarded();
  current.onError(new Error('late'));
  await next.then(value => assert.deepEqual(value, { shown: true, rewarded: false }));
  assert.deepEqual(f.calls, ['rewarded', 'rewarded', 'pause', 'resume']);
});

test('missing SDK methods and concurrent operations fail visibly without disrupting first attempt', async () => {
  const f = fixture({ rewarded: false });
  await expectCode(f.ads.showRewarded(), 'CAPABILITY_UNAVAILABLE');
  const first = f.ads.showFullscreen();
  await expectCode(f.ads.showFullscreen(), 'ADS_FAILED');
  await expectCode(f.ads.showRewarded(), 'ADS_FAILED');
  assert.deepEqual(f.calls, ['fullscreen']);
  f.events.get('fullscreen').onOpen();
  f.events.get('fullscreen').onClose(true);
  assert.deepEqual(await first, { shown: true });
});

test('sync SDK throw and rejected thenable reject; fulfilled SDK return remains pending', async () => {
  const f = fixture();
  f.sdk.adv.showFullscreenAdv = () => { throw new Error('sync SDK throw'); };
  await expectCode(f.ads.showFullscreen(), 'ADS_FAILED');
  f.sdk.adv.showFullscreenAdv = () => Promise.reject(new Error('async SDK throw'));
  await expectCode(f.ads.showFullscreen(), 'ADS_FAILED');
  let callbacks;
  f.sdk.adv.showFullscreenAdv = ({ callbacks: c }) => { callbacks = c; return Promise.resolve(); };
  const pending = f.ads.showFullscreen();
  await new Promise(resolve => setImmediate(resolve));
  callbacks.onOpen();
  callbacks.onClose(true);
  assert.deepEqual(await pending, { shown: true });
});

test('destroy during open ad releases its lease, rejects pending and makes late callbacks inert', async () => {
  const f = fixture();
  const pending = f.ads.showRewarded();
  const callbacks = f.events.get('rewarded');
  callbacks.onOpen();
  f.ads.destroy();
  f.ads.destroy();
  await expectCode(pending, 'ADS_FAILED');
  assert.equal(f.host.getStatus(), 'RUNNING');
  callbacks.onRewarded();
  callbacks.onClose(true);
  callbacks.onOpen();
  assert.deepEqual(f.calls, ['rewarded', 'pause', 'resume']);
  await expectCode(f.ads.showRewarded(), 'ADS_FAILED');
});

test('manual and platform pause ownership survives ad close', async () => {
  const f = fixture();
  const pending = f.ads.showFullscreen();
  f.events.get('fullscreen').onOpen();
  f.lifecycle.setManualPaused(true);
  f.emitSdk('game_api_pause');
  f.events.get('fullscreen').onClose(true);
  assert.deepEqual(await pending, { shown: true });
  assert.equal(f.host.getStatus(), 'PAUSED');
  f.emitSdk('game_api_resume');
  assert.equal(f.host.getStatus(), 'PAUSED');
});

test('SDK open after lifecycle teardown fails closed, cannot resume host or claim display', async () => {
  const f = fixture();
  const pending = f.ads.showFullscreen();
  f.lifecycle.detach();
  const callbacks = f.events.get('fullscreen');
  callbacks.onOpen();
  callbacks.onClose(true);
  await expectCode(pending, 'ADS_FAILED');
  assert.equal(f.host.getStatus(), 'RUNNING');
});

test('reentrant destroy while pause is being acquired cannot leave an orphan pause reason', async () => {
  const f = fixture();
  f.host.subscribe(event => {
    if (event.status === 'PAUSED') f.ads.destroy();
  });
  const pending = f.ads.showFullscreen();
  f.events.get('fullscreen').onOpen();
  await expectCode(pending, 'ADS_FAILED');
  assert.equal(f.host.getStatus(), 'RUNNING', 'destroy should restore owned pause');
  f.host.pause();
  f.host.resume();
  assert.equal(f.host.getStatus(), 'RUNNING', 'no orphan lease should re-pause future user resume');
});

test('reentrant show during destroy cleanup cannot start an uncancellable second ad request', { timeout: 2000 }, async () => {
  const f = fixture();
  let second;
  f.host.subscribe(event => {
    if (event.status === 'RUNNING') second = f.ads.showRewarded();
  });
  const first = f.ads.showFullscreen();
  f.events.get('fullscreen').onOpen();
  f.ads.destroy();
  await expectCode(first, 'ADS_FAILED');
  assert.ok(second, 'resume callback attempted a second request');
  await expectCode(second, 'ADS_FAILED');
  assert.equal(f.calls.includes('rewarded'), false, 'destroy forbids SDK reentry');
});

test('synchronous SDK throw after reward callbacks takes precedence over staged ad success', async () => {
  const f = fixture();
  f.sdk.adv.showRewardedVideo = ({ callbacks }) => {
    callbacks.onOpen();
    callbacks.onRewarded();
    callbacks.onClose(true);
    throw new Error('throw after callbacks');
  };
  await expectCode(f.ads.showRewarded(), 'ADS_FAILED');
  assert.equal(f.host.getStatus(), 'RUNNING');
});

test('SDK rejected thenable after synchronous close overrides callback success', async () => {
  const f = fixture();
  f.sdk.adv.showRewardedVideo = ({ callbacks }) => {
    callbacks.onOpen();
    callbacks.onRewarded();
    callbacks.onClose(true);
    return Promise.reject(new Error('later rejection'));
  };
  await expectCode(f.ads.showRewarded(), 'ADS_FAILED');
});

test('FAULTED host during ad open cannot produce a rewarded success', async () => {
  const f = fixture();
  f.host.pause = () => { f.transition('FAULTED'); throw new Error('fault during pause'); };
  const pending = f.ads.showRewarded();
  const callbacks = f.events.get('rewarded');
  callbacks.onOpen();
  callbacks.onRewarded();
  callbacks.onClose(true);
  await expectCode(pending, 'ADS_FAILED');
  assert.equal(f.host.getStatus(), 'FAULTED');
});

test('old rewarded callbacks from a previous lifecycle attachment cannot grant rewards', async () => {
  const f = fixture();
  const pending = f.ads.showRewarded();
  const callbacks = f.events.get('rewarded');
  callbacks.onOpen();
  f.lifecycle.detach();
  f.transition('RUNNING');
  f.lifecycle.attach();
  callbacks.onRewarded();
  callbacks.onClose(true);
  await expectCode(pending, 'ADS_FAILED');
  assert.equal(f.host.getStatus(), 'RUNNING');
});

test('late SDK open from a prior detached attachment cannot pause a new Runtime session', async () => {
  const f = fixture();
  const pending = f.ads.showFullscreen();
  const callbacks = f.events.get('fullscreen');
  f.lifecycle.detach();
  f.lifecycle.attach();
  callbacks.onOpen();
  callbacks.onClose(true);
  await expectCode(pending, 'ADS_FAILED');
  assert.equal(f.host.getStatus(), 'RUNNING');
  assert.deepEqual(f.calls, ['fullscreen']);
});

test('real Runtime entering FAULTED on pause cannot complete a rewarded attempt', async () => {
  let faultOnPause = false;
  let callbacks;
  const host = createRuntimeHost({
    game: { schemaVersion: 1, id: 'c4-fault', version: '1.0.0', title: { en: 'C4 Fault' }, engine: 'web', targets: ['yandex-games'] },
    initialState: { score: 0 },
    update({ state, setState }) { setState(state); },
    renderer: { mount() {}, resize() {}, render() {}, unmount() {} },
    input: {
      subscribe() { return () => {}; },
      enable() {},
      disable() { if (faultOnPause) throw new Error('input lost during pause'); },
    },
    environment: {
      root: {}, now: () => 0,
      requestFrame() { return 1; }, cancelFrame() {},
      getViewport() { return { width: 1000, height: 720, dpr: 1, orientation: 'landscape' }; },
      observeViewport() { return () => {}; },
    },
  });
  const sdkEvents = new Map();
  const sdk = {
    features: { GameplayAPI: { start() {}, stop() {} } },
    on(name, fn) { sdkEvents.set(name, fn); },
    off(name) { sdkEvents.delete(name); },
    adv: { showRewardedVideo({ callbacks: c }) { callbacks = c; } },
  };
  const lifecycle = createYandexLifecycle({ sdk, host });
  lifecycle.attach();
  await host.initialize();
  host.start();
  const ads = createYandexAds({ sdk, host, lifecycle });
  faultOnPause = true;
  const pending = ads.showRewarded();
  callbacks.onOpen();
  callbacks.onRewarded();
  callbacks.onClose(true);
  await expectCode(pending, 'ADS_FAILED');
  assert.equal(host.getStatus(), 'FAULTED');
  ads.destroy();
  lifecycle.detach();
});
