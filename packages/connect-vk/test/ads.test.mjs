import test from 'node:test';
import assert from 'node:assert/strict';
import { createVkAds, createVkLifecycle, VkConnectError } from '../src/index.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ initial = 'RUNNING', respond = () => Promise.resolve({ result: true }), timeoutMs } = {}) {
  let status = initial;
  const bridgeListeners = new Set(), statusListeners = new Set();
  const calls = [], trace = [];
  const bridge = {
    send(method, params) {
      calls.push({ method, params });
      return respond(method, params);
    },
    subscribe(fn) { bridgeListeners.add(fn); },
    unsubscribe(fn) { bridgeListeners.delete(fn); },
    emit(type) { for (const fn of [...bridgeListeners]) fn({ detail: { type } }); },
  };
  const emitStatus = () => { for (const fn of [...statusListeners]) fn({ type: 'status', status }); };
  const host = {
    getStatus: () => status,
    subscribe(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    pause() { trace.push('pause'); status = 'PAUSED'; emitStatus(); },
    resume() { trace.push('resume'); status = 'RUNNING'; emitStatus(); },
  };
  const audio = {
    pauseAll() { trace.push('audio:pause'); },
    resumeAll() { trace.push('audio:resume'); },
  };
  const lifecycle = createVkLifecycle({ bridge, host, audio, windowObject: null, documentObject: null });
  lifecycle.attach();
  const ads = createVkAds({ bridge, lifecycle, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  return { bridge, host, lifecycle, ads, calls, trace, get status() { return status; } };
}

function expectCode(code) {
  return error => error instanceof VkConnectError && error.code === code;
}

test('fullscreen shows interstitial and releases Runtime pause on result true', async () => {
  const f = fixture();
  assert.deepEqual(await f.ads.showFullscreen(), { shown: true });
  assert.deepEqual(f.calls, [{ method: 'VKWebAppShowNativeAds', params: { ad_format: 'interstitial' } }]);
  assert.deepEqual(f.trace, ['pause', 'audio:pause', 'resume', 'audio:resume']);
  assert.equal(f.status, 'RUNNING');
});

test('reward requires result true from its own rewarded Bridge call', async () => {
  const f = fixture();
  assert.deepEqual(await f.ads.showRewarded(), { shown: true, rewarded: true });
  assert.deepEqual(f.calls, [{ method: 'VKWebAppShowNativeAds', params: { ad_format: 'reward' } }]);
});

test('false, missing, and malformed show responses never return a reward', async () => {
  for (const response of [{ result: false }, { result: 1 }, { result: 'true' }, {}, null]) {
    const f = fixture({ respond: () => Promise.resolve(response) });
    await assert.rejects(f.ads.showRewarded(), expectCode('ADS_NOT_SHOWN'));
    assert.equal(f.status, 'RUNNING');
    assert.deepEqual(f.trace, ['pause', 'audio:pause', 'resume', 'audio:resume']);
  }
});

test('SDK rejection, synchronous throw and non-Promise responses fail closed', async () => {
  for (const respond of [
    () => Promise.reject(new Error('SDK rejected')),
    () => { throw new Error('SDK throw'); },
    () => ({ result: true }),
  ]) {
    const f = fixture({ respond });
    await assert.rejects(f.ads.showRewarded(), expectCode('ADS_FAILED'));
    assert.equal(f.status, 'RUNNING');
  }
});

test('missing method and detached lifecycle never send an ad', async () => {
  const f = fixture();
  f.lifecycle.detach();
  await assert.rejects(f.ads.showFullscreen(), expectCode('ADS_FAILED'));
  assert.equal(f.calls.length, 0);
  const g = fixture();
  g.bridge.send = undefined;
  await assert.rejects(g.ads.showRewarded(), expectCode('CAPABILITY_UNAVAILABLE'));
  assert.equal(g.status, 'RUNNING');
  assert.deepEqual(g.trace, []);
});

test('single-flight rejects overlapping show while optional availability remains independent', async () => {
  const shown = deferred();
  const f = fixture({ respond: (method) => method === 'VKWebAppShowNativeAds'
    ? shown.promise : Promise.resolve({ result: false }) });
  const first = f.ads.showRewarded();
  await assert.rejects(f.ads.showFullscreen(), expectCode('ADS_FAILED'));
  assert.deepEqual(await f.ads.checkAvailability('fullscreen'), { available: false });
  assert.equal(f.status, 'PAUSED');
  shown.resolve({ result: true });
  assert.deepEqual(await first, { shown: true, rewarded: true });
  assert.equal(f.status, 'RUNNING');
});

test('availability uses the format-specific check and accepts strict boolean only', async () => {
  const responses = [Promise.resolve({ result: true }), Promise.resolve({ result: false }),
    Promise.resolve({ result: 'yes' })];
  const f = fixture({ respond: () => responses.shift() });
  assert.deepEqual(await f.ads.checkAvailability('rewarded'), { available: true });
  assert.deepEqual(await f.ads.checkAvailability('fullscreen'), { available: false });
  await assert.rejects(f.ads.checkAvailability('rewarded'), expectCode('ADS_FAILED'));
  assert.deepEqual(f.calls, [
    { method: 'VKWebAppCheckNativeAds', params: { ad_format: 'reward' } },
    { method: 'VKWebAppCheckNativeAds', params: { ad_format: 'interstitial' } },
    { method: 'VKWebAppCheckNativeAds', params: { ad_format: 'reward' } },
  ]);
  assert.deepEqual(f.trace, []);
  await assert.rejects(f.ads.checkAvailability('other'), TypeError);
});

test('availability rejects SDK failures and late answer after detach', async () => {
  const pending = deferred();
  const f = fixture({ respond: () => pending.promise });
  const check = f.ads.checkAvailability('rewarded');
  f.lifecycle.detach();
  pending.resolve({ result: true });
  await assert.rejects(check, expectCode('ADS_FAILED'));
  const g = fixture({ respond: () => Promise.reject(new Error('offline')) });
  await assert.rejects(g.ads.checkAvailability('fullscreen'), expectCode('ADS_FAILED'));
  assert.deepEqual(g.trace, []);
});

test('detach cancels pending reward immediately; old result cannot affect reattached lifecycle', async () => {
  const old = deferred();
  let next = old.promise;
  const f = fixture({ respond: () => next });
  const pending = f.ads.showRewarded();
  assert.equal(f.status, 'PAUSED');
  f.lifecycle.detach();
  await assert.rejects(pending, expectCode('ADS_FAILED'));
  f.lifecycle.attach();
  const newer = deferred();
  next = newer.promise;
  const second = f.ads.showRewarded();
  old.resolve({ result: true });
  await Promise.resolve();
  assert.equal(f.status, 'PAUSED');
  newer.resolve({ result: true });
  assert.deepEqual(await second, { shown: true, rewarded: true });
});

test('destroy cancels pending reward and rejects all subsequent operations', async () => {
  const pendingBridge = deferred();
  const f = fixture({ respond: () => pendingBridge.promise });
  const pending = f.ads.showRewarded();
  f.ads.destroy();
  f.ads.destroy();
  await assert.rejects(pending, expectCode('ADS_FAILED'));
  assert.equal(f.status, 'RUNNING');
  pendingBridge.resolve({ result: true });
  await Promise.resolve();
  await assert.rejects(f.ads.showFullscreen(), expectCode('ADS_FAILED'));
  await assert.rejects(f.ads.checkAvailability('rewarded'), expectCode('ADS_FAILED'));
});

test('ad release does not resume a Runtime with a newer view or manual pause', async () => {
  const pendingBridge = deferred();
  const f = fixture({ respond: () => pendingBridge.promise });
  const pending = f.ads.showRewarded();
  f.bridge.emit('VKWebAppViewHide');
  pendingBridge.resolve({ result: true });
  assert.deepEqual(await pending, { shown: true, rewarded: true });
  assert.equal(f.status, 'PAUSED');
  f.lifecycle.setManualPaused(true);
  f.bridge.emit('VKWebAppViewRestore');
  assert.equal(f.status, 'PAUSED');
  f.lifecycle.setManualPaused(false);
  assert.equal(f.status, 'RUNNING');
});

test('reentrant detach while acquiring pause does not invoke Bridge', async () => {
  const f = fixture();
  const pause = f.host.pause;
  f.host.pause = () => { pause(); f.lifecycle.detach(); };
  await assert.rejects(f.ads.showRewarded(), expectCode('ADS_FAILED'));
  assert.deepEqual(f.calls, []);
  assert.equal(f.status, 'PAUSED');
});

test('reentrant destroy during send ignores late rejection without unhandled rejection', async () => {
  const f = fixture();
  f.bridge.send = () => { f.ads.destroy(); return Promise.reject(new Error('late SDK failure')); };
  await assert.rejects(f.ads.showRewarded(), expectCode('ADS_FAILED'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.status, 'RUNNING');
});

test('unresponsive SDK times out, releases pause and ignores late rewarded success', async () => {
  const waiting = deferred();
  const f = fixture({ timeoutMs: 20, respond: () => waiting.promise });
  const pending = f.ads.showRewarded();
  await Promise.race([
    assert.rejects(pending, expectCode('ADS_FAILED')),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SDK timeout was not enforced')), 120)),
  ]);
  assert.equal(f.status, 'RUNNING');
  waiting.resolve({ result: true });
  await Promise.resolve();
  assert.deepEqual(f.trace, ['pause', 'audio:pause', 'resume', 'audio:resume']);
});

test('timeout config rejects invalid values', () => {
  for (const timeoutMs of [0, -1, 1.2, Infinity, 300_001]) {
    assert.throws(() => fixture({ timeoutMs }), TypeError);
  }
});
