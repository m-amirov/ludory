import test from 'node:test';
import assert from 'node:assert/strict';
import { createYandexLifecycle, YandexConnectError } from '../src/index.mjs';
import { createRuntimeHost } from '@ludory/runtime';

function fakeHost(initial = 'IDLE') {
  let status = initial;
  const listeners = new Set();
  const operations = [];
  const host = {
    getStatus: () => status,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    pause() { operations.push('pause'); if (status !== 'RUNNING') throw new Error('cannot pause'); transition('PAUSED'); },
    resume() { operations.push('resume'); if (status !== 'PAUSED') throw new Error('cannot resume'); transition('RUNNING'); },
  };
  function transition(next) {
    status = next;
    for (const listener of [...listeners]) listener({ schemaVersion: 1, type: 'status', status: next });
  }
  return { host, transition, operations, get subscribers() { return listeners.size; } };
}

function fakeSdk() {
  const calls = [];
  const listeners = new Map();
  const sdk = {
    features: {
      LoadingAPI: { ready() { calls.push('ready'); } },
      GameplayAPI: {
        start() { calls.push('start'); },
        stop() { calls.push('stop'); },
      },
    },
    on(name, handler) { calls.push(`on:${name}`); listeners.set(name, handler); },
    off(name, handler) { calls.push(`off:${name}`); if (listeners.get(name) === handler) listeners.delete(name); },
  };
  return { sdk, calls, listeners, emit(name) { listeners.get(name)?.(); } };
}

function fakeEventTarget() {
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, event = {}) { for (const fn of [...(listeners.get(name) ?? [])]) fn(event); },
    count(name) { return listeners.get(name)?.size ?? 0; },
    first(name) { return [...(listeners.get(name) ?? [])][0]; },
  };
}

test('C2 is an inert import with strict dependencies', () => {
  assert.equal(typeof createYandexLifecycle, 'function');
  assert.throws(() => createYandexLifecycle(), TypeError);
  assert.throws(() => createYandexLifecycle({ sdk: {}, host: {} }), TypeError);
  assert.throws(() => createYandexLifecycle({ sdk: fakeSdk().sdk, host: fakeHost().host, canResume: 'yes' }), TypeError);
});

test('LoadingAPI.ready is explicit, after host initialization, idempotent and awaited', async () => {
  const h = fakeHost();
  const s = fakeSdk();
  let resolveReady;
  s.sdk.features.LoadingAPI.ready = () => new Promise(resolve => { s.calls.push('ready'); resolveReady = resolve; });
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  assert.equal(await lifecycle.markReady(), false);
  assert.equal(s.calls.includes('ready'), false);
  h.transition('READY');
  const pendingA = lifecycle.markReady();
  const pendingB = lifecycle.markReady();
  assert.equal(s.calls.filter(call => call === 'ready').length, 1);
  resolveReady();
  assert.deepEqual(await Promise.all([pendingA, pendingB]), [true, true]);
  assert.equal(await lifecycle.markReady(), true);
  assert.equal(s.calls.filter(call => call === 'ready').length, 1);
});

test('missing or rejecting LoadingAPI does not forge ready state', async () => {
  const h = fakeHost('READY');
  const s = fakeSdk();
  delete s.sdk.features.LoadingAPI;
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  assert.equal(await lifecycle.markReady(), false);
  assert.equal(lifecycle.getLastError()?.code, 'CAPABILITY_UNAVAILABLE');
  s.sdk.features.LoadingAPI = { ready() { return Promise.reject(new Error('network')); } };
  assert.equal(await lifecycle.markReady(), false);
  assert.ok(lifecycle.getLastError() instanceof YandexConnectError);
  assert.equal(lifecycle.getLastError().code, 'LIFECYCLE_FAILED');
});

test('markReady cannot succeed from STOPPED or after detach during pending SDK response', async () => {
  const h = fakeHost('STOPPED');
  const s = fakeSdk();
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  assert.equal(await lifecycle.markReady(), false);
  assert.equal(s.calls.includes('ready'), false);
  h.transition('READY');
  let complete;
  s.sdk.features.LoadingAPI.ready = () => new Promise(resolve => { complete = resolve; });
  const pending = lifecycle.markReady();
  lifecycle.detach();
  complete();
  assert.equal(await pending, false);
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
});

test('LoadingAPI success stays SDK-idempotent across detach and reattach', async () => {
  const h = fakeHost('READY');
  const s = fakeSdk();
  let notifyReady;
  s.sdk.features.LoadingAPI.ready = () => {
    s.calls.push('ready');
    if (s.calls.filter(x => x === 'ready').length > 1) return;
    return new Promise(resolve => { notifyReady = resolve; });
  };
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  const outdated = lifecycle.markReady();
  lifecycle.detach();
  lifecycle.attach();
  notifyReady();
  assert.equal(await outdated, false);
  assert.equal(await lifecycle.markReady(), true);
  assert.equal(s.calls.filter(x => x === 'ready').length, 1);
  lifecycle.detach();
  assert.equal(await lifecycle.markReady(), false, 'detached lifecycle must not report ready');
});

test('gameplay markers follow host status and detach is idempotent', () => {
  const h = fakeHost('READY');
  const s = fakeSdk();
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  lifecycle.attach();
  h.transition('RUNNING');
  h.transition('RUNNING');
  h.transition('PAUSED');
  h.transition('RUNNING');
  h.transition('STOPPED');
  lifecycle.detach();
  lifecycle.detach();
  h.transition('RUNNING');
  assert.deepEqual(s.calls.filter(x => ['start', 'stop'].includes(x)), ['start', 'stop', 'start', 'stop']);
  assert.equal(h.subscribers, 0);
  assert.equal(lifecycle.getStatus(), 'DETACHED');
});

test('missing and throwing GameplayAPI degrade without faulting host', () => {
  const h = fakeHost('READY');
  const s = fakeSdk();
  delete s.sdk.features.GameplayAPI;
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  h.transition('RUNNING');
  assert.equal(lifecycle.getLastError()?.code, 'CAPABILITY_UNAVAILABLE');
  s.sdk.features.GameplayAPI = { start() { throw new Error('marker rejected'); }, stop() {} };
  h.transition('PAUSED');
  h.transition('RUNNING');
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
  assert.equal(h.host.getStatus(), 'RUNNING');
});

test('partial GameplayAPI cannot publish start without a matching stop capability', () => {
  const h = fakeHost('READY');
  const s = fakeSdk();
  s.sdk.features.GameplayAPI = { start() { s.calls.push('start'); } };
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  h.transition('RUNNING');
  h.transition('PAUSED');
  assert.deepEqual(s.calls.filter(x => ['start', 'stop'].includes(x)), []);
  assert.equal(lifecycle.getLastError()?.code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(h.host.getStatus(), 'PAUSED');
});

test('rejected asynchronous gameplay marker is not a recorded success and can retry', async () => {
  const h = fakeHost('READY');
  const s = fakeSdk();
  let starts = 0;
  s.sdk.features.GameplayAPI.start = () => {
    starts++;
    return Promise.reject(new Error('temporary failure'));
  };
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  h.transition('RUNNING');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
  h.transition('RUNNING');
  assert.equal(starts, 2);
});

test('late asynchronous start cannot remain published after host pauses or lifecycle detaches', async () => {
  for (const ending of ['pause', 'detach']) {
    const h = fakeHost('READY');
    const s = fakeSdk();
    let complete;
    s.sdk.features.GameplayAPI.start = () => new Promise(resolve => {
      complete = () => { s.calls.push('start:resolved'); resolve(); };
    });
    const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
    lifecycle.attach();
    h.transition('RUNNING');
    if (ending === 'pause') h.transition('PAUSED');
    else lifecycle.detach();
    complete();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(s.calls.at(-1), 'stop', `late start wasn't compensated after ${ending}`);
  }
});

test('pending asynchronous stop from old attachment cannot suppress a new gameplay start', async () => {
  const h = fakeHost('READY');
  const s = fakeSdk();
  let completeStop;
  s.sdk.features.GameplayAPI.stop = () => new Promise(resolve => {
    s.calls.push('stop:pending');
    completeStop = resolve;
  });
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  h.transition('RUNNING');
  h.transition('PAUSED');
  assert.equal(s.calls.at(-1), 'stop:pending');
  lifecycle.detach();
  h.transition('RUNNING');
  lifecycle.attach();
  completeStop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.calls.at(-1), 'start');
});

test('rejected asynchronous cleanup stop is captured rather than unhandled', async () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  s.sdk.features.GameplayAPI.stop = () => Promise.reject(new Error('stop failure'));
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  lifecycle.detach();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
});

test('SDK pause and resume suspend and restore running host, markers and optional audio', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const audioCalls = [];
  const audio = { pauseAll() { audioCalls.push('pause'); }, resumeAll() { audioCalls.push('resume'); } };
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host, audio });
  lifecycle.attach();
  s.emit('game_api_pause');
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.deepEqual(audioCalls, ['pause']);
  s.emit('game_api_pause');
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'RUNNING');
  assert.deepEqual(h.operations, ['pause', 'resume']);
  assert.deepEqual(audioCalls, ['pause', 'resume']);
  assert.deepEqual(s.calls.filter(x => ['start', 'stop'].includes(x)), ['start', 'stop', 'start']);
});

test('manual pause before an SDK event is never stolen by platform resume', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const audioCalls = [];
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host,
    audio: { pauseAll() { audioCalls.push('pause'); }, resumeAll() { audioCalls.push('resume'); } } });
  lifecycle.attach();
  lifecycle.setManualPaused(true);
  h.host.pause();
  s.emit('game_api_pause');
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.deepEqual(h.operations, ['pause']);
  assert.deepEqual(audioCalls, [], 'platform resume must not wake audio after a manual pause');
  assert.deepEqual(s.calls.filter(x => ['start', 'stop'].includes(x)), ['start', 'stop']);
});

test('manual pause during SDK pause cannot auto-resume after flag clears', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const audioCalls = [];
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host,
    audio: { pauseAll() { audioCalls.push('pause'); }, resumeAll() { audioCalls.push('resume'); } } });
  lifecycle.attach();
  s.emit('game_api_pause');
  lifecycle.setManualPaused(true);
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'PAUSED');
  lifecycle.setManualPaused(false);
  assert.equal(h.host.getStatus(), 'PAUSED');
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.deepEqual(h.operations, ['pause']);
  assert.deepEqual(audioCalls, ['pause'], 'platform resume must not restart audio while manual pause holds');
});

test('ad pause lease pauses once and idempotent release resumes only owned pause', () => {
  const h = fakeHost('RUNNING');
  const lifecycle = createYandexLifecycle({ sdk: fakeSdk().sdk, host: h.host });
  lifecycle.attach();
  const releaseA = lifecycle.acquireAdPause();
  const releaseB = lifecycle.acquireAdPause();
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.deepEqual(h.operations, ['pause']);
  releaseA();
  releaseA();
  assert.equal(h.host.getStatus(), 'PAUSED', 'second lease remains active');
  releaseB();
  releaseB();
  assert.equal(h.host.getStatus(), 'RUNNING');
  assert.deepEqual(h.operations, ['pause', 'resume']);
});

test('ad lease release respects manual pause made while ad was open', () => {
  const h = fakeHost('RUNNING');
  const lifecycle = createYandexLifecycle({ sdk: fakeSdk().sdk, host: h.host });
  lifecycle.attach();
  const release = lifecycle.acquireAdPause();
  lifecycle.setManualPaused(true);
  release();
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.deepEqual(h.operations, ['pause']);
  lifecycle.setManualPaused(false);
  assert.equal(h.host.getStatus(), 'PAUSED', 'clearing manual flag is not an auto-resume');
});

test('ad lease cannot override other SDK and visibility pause reasons', () => {
  const h = fakeHost('RUNNING');
  const sdk = fakeSdk();
  const documentObject = fakeEventTarget();
  const lifecycle = createYandexLifecycle({ sdk: sdk.sdk, host: h.host, documentObject });
  lifecycle.attach();
  const release = lifecycle.acquireAdPause();
  sdk.emit('game_api_pause');
  documentObject.visibilityState = 'hidden';
  documentObject.emit('visibilitychange');
  release();
  assert.equal(h.host.getStatus(), 'PAUSED');
  sdk.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'PAUSED');
  documentObject.visibilityState = 'visible';
  documentObject.emit('visibilitychange');
  assert.equal(h.host.getStatus(), 'RUNNING');
  assert.deepEqual(h.operations, ['pause', 'resume']);
});

test('detached ad acquisition fails and stale release after detach and reattach is inert', () => {
  const h = fakeHost('RUNNING');
  const lifecycle = createYandexLifecycle({ sdk: fakeSdk().sdk, host: h.host });
  assert.throws(() => lifecycle.acquireAdPause(), error => error?.code === 'LIFECYCLE_FAILED');
  lifecycle.attach();
  const releaseOld = lifecycle.acquireAdPause();
  lifecycle.detach();
  h.transition('RUNNING'); // A new host session has started after teardown.
  lifecycle.attach();
  const releaseNew = lifecycle.acquireAdPause();
  releaseOld();
  assert.equal(h.host.getStatus(), 'PAUSED');
  releaseNew();
  assert.equal(h.host.getStatus(), 'RUNNING');
  lifecycle.detach();
  assert.throws(() => lifecycle.acquireAdPause(), error => error?.code === 'LIFECYCLE_FAILED');
});

test('attachment token changes on detach/reattach and cannot be confused with an old session', () => {
  const lifecycle = createYandexLifecycle({ sdk: fakeSdk().sdk, host: fakeHost().host });
  assert.equal(lifecycle.getAttachmentToken(), null);
  lifecycle.attach();
  const first = lifecycle.getAttachmentToken();
  assert.notEqual(first, null);
  lifecycle.detach();
  assert.equal(lifecycle.getAttachmentToken(), null);
  lifecycle.attach();
  assert.notEqual(lifecycle.getAttachmentToken(), first);
});

test('ad lease rejects a pause that faults the Runtime instead of entering PAUSED', () => {
  const h = fakeHost('RUNNING');
  h.host.pause = () => { h.transition('FAULTED'); throw new Error('Runtime faulted during pause'); };
  const lifecycle = createYandexLifecycle({ sdk: fakeSdk().sdk, host: h.host });
  lifecycle.attach();
  assert.throws(() => lifecycle.acquireAdPause(), error => error?.code === 'LIFECYCLE_FAILED');
  assert.equal(h.host.getStatus(), 'FAULTED');
});

test('canResume veto and error keep host paused without false gameplay start', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  let mode = 'no';
  const lifecycle = createYandexLifecycle({
    sdk: s.sdk, host: h.host,
    canResume() { if (mode === 'throw') throw new Error('app state unreadable'); return mode === 'yes'; },
  });
  lifecycle.attach();
  s.emit('game_api_pause');
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'PAUSED');
  mode = 'throw';
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
  mode = 'yes';
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'RUNNING');
});

test('canResume with no explicit veto allows platform-owned resume', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host, canResume() {} });
  lifecycle.attach();
  s.emit('game_api_pause');
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'RUNNING');
});

test('invalid asynchronous canResume rejection is observed and leaves host paused', async () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const lifecycle = createYandexLifecycle({
    sdk: s.sdk, host: h.host,
    canResume() { return Promise.reject(new Error('async veto not supported')); },
  });
  lifecycle.attach();
  s.emit('game_api_pause');
  s.emit('game_api_resume');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
});

test('asynchronous audio adapter rejection is observed without faulting Runtime', async () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const lifecycle = createYandexLifecycle({
    sdk: s.sdk, host: h.host,
    audio: {
      pauseAll() { return Promise.reject(new Error('audio unavailable')); },
      resumeAll() { return Promise.reject(new Error('audio unavailable')); },
    },
  });
  lifecycle.attach();
  s.emit('game_api_pause');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
  s.emit('game_api_resume');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.host.getStatus(), 'RUNNING');
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
});

test('missing or partially subscribing SDK events does not retain live callbacks', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  s.sdk.on = undefined;
  const missing = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  missing.attach();
  assert.equal(missing.getLastError()?.code, 'CAPABILITY_UNAVAILABLE');
  missing.detach();

  const t = fakeSdk();
  const originalOn = t.sdk.on;
  t.sdk.on = (name, cb) => {
    if (name === 'game_api_resume') throw new Error('partial subscription failure');
    return originalOn(name, cb);
  };
  const lifecycle = createYandexLifecycle({ sdk: t.sdk, host: h.host });
  lifecycle.attach();
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
  assert.equal(t.listeners.size, 0);
  lifecycle.detach();
});

test('SDK callbacks observed after detach, including failed off, cannot change host', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  const stalePause = s.listeners.get('game_api_pause');
  const staleResume = s.listeners.get('game_api_resume');
  assert.equal(typeof stalePause, 'function');
  s.sdk.off = () => { throw new Error('SDK off failed'); };
  lifecycle.detach();
  stalePause();
  staleResume();
  assert.equal(h.host.getStatus(), 'RUNNING');
  assert.equal(lifecycle.getStatus(), 'DETACHED');
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
});

test('platform must not resume terminal host or a failed pause', () => {
  const s = fakeSdk();
  const h = fakeHost('RUNNING');
  h.host.pause = () => { throw new Error('pause denied'); };
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  s.emit('game_api_pause');
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'RUNNING');
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
  h.transition('STOPPED');
  s.emit('game_api_resume');
  assert.equal(h.host.getStatus(), 'STOPPED');
  assert.deepEqual(h.operations, []);
});

test('platform pause received before host start intercepts later RUNNING without a start marker', () => {
  const s = fakeSdk();
  const h = fakeHost('IDLE');
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host });
  lifecycle.attach();
  s.emit('game_api_pause');
  h.transition('READY');
  h.transition('RUNNING');
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.deepEqual(s.calls.filter(x => ['start', 'stop'].includes(x)), []);
});

test('BFCache pagehide/pageshow suspends and restores only platform-owned pause', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const windowObject = fakeEventTarget();
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host, windowObject });
  lifecycle.attach();
  windowObject.emit('pagehide', { persisted: true });
  assert.equal(h.host.getStatus(), 'PAUSED');
  windowObject.emit('pageshow', { persisted: false });
  assert.equal(h.host.getStatus(), 'PAUSED');
  windowObject.emit('pageshow', { persisted: true });
  assert.equal(h.host.getStatus(), 'RUNNING');
  lifecycle.detach();
  assert.equal(windowObject.count('pagehide'), 0);
  assert.equal(windowObject.count('pageshow'), 0);
});

test('SDK resume cannot restore gameplay while page is hidden or in BFCache', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const windowObject = fakeEventTarget();
  const documentObject = fakeEventTarget();
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host, windowObject, documentObject });
  lifecycle.attach();
  s.emit('game_api_pause');
  windowObject.emit('pagehide', { persisted: true });
  documentObject.visibilityState = 'hidden';
  documentObject.emit('visibilitychange');
  s.emit('game_api_resume');
  windowObject.emit('pageshow', { persisted: true });
  assert.equal(h.host.getStatus(), 'PAUSED');
  documentObject.visibilityState = 'visible';
  documentObject.emit('visibilitychange');
  assert.equal(h.host.getStatus(), 'RUNNING');
});

test('hidden document at attach intercepts later game start and stale browser callbacks after detach are inert', () => {
  const h = fakeHost('READY');
  const s = fakeSdk();
  const documentObject = fakeEventTarget();
  documentObject.visibilityState = 'hidden';
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host, documentObject });
  lifecycle.attach();
  const stale = documentObject.first('visibilitychange');
  h.transition('RUNNING');
  assert.equal(h.host.getStatus(), 'PAUSED');
  lifecycle.setManualPaused(true);
  lifecycle.detach();
  documentObject.visibilityState = 'visible';
  stale?.();
  assert.equal(h.host.getStatus(), 'PAUSED');
  assert.equal(documentObject.count('visibilitychange'), 0);
});

test('throwing browser listener installation degrades without leaking previous handlers', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const windowObject = fakeEventTarget();
  const original = windowObject.addEventListener;
  windowObject.addEventListener = (name, fn) => {
    if (name === 'pageshow') throw new Error('listener blocked');
    original(name, fn);
  };
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host, windowObject });
  lifecycle.attach();
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
  assert.equal(windowObject.count('pagehide'), 0);
  s.emit('game_api_pause');
  assert.equal(h.host.getStatus(), 'PAUSED');
  lifecycle.detach();
});

test('document subscription failure does not remove functioning window pagehide handlers', () => {
  const h = fakeHost('RUNNING');
  const s = fakeSdk();
  const windowObject = fakeEventTarget();
  const documentObject = fakeEventTarget();
  documentObject.addEventListener = () => { throw new Error('visibility unavailable'); };
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host: h.host, windowObject, documentObject });
  lifecycle.attach();
  assert.equal(lifecycle.getLastError()?.code, 'LIFECYCLE_FAILED');
  assert.equal(windowObject.count('pagehide'), 1);
  windowObject.emit('pagehide', { persisted: true });
  assert.equal(h.host.getStatus(), 'PAUSED');
  lifecycle.detach();
  assert.equal(windowObject.count('pagehide'), 0);
});

test('real Runtime host stops frames, input and audio across SDK pause/resume', async () => {
  const pending = new Map();
  let frame = 0;
  const calls = [];
  const host = createRuntimeHost({
    game: { schemaVersion: 1, id: 'c2-lifecycle', version: '1.0.0', title: { en: 'C2' }, engine: 'web', targets: ['yandex-games'] },
    initialState: { score: 0 },
    update({ state, setState }) { setState(state); },
    renderer: { mount() {}, resize() {}, render() {}, unmount() {} },
    input: {
      subscribe() { return () => {}; },
      enable() { calls.push('input:enable'); },
      disable() { calls.push('input:disable'); },
    },
    audio: {
      pauseAll() { calls.push('audio:pause'); },
      resumeAll() { calls.push('audio:resume'); },
    },
    environment: {
      root: {}, now: () => 0,
      requestFrame(fn) { const id = ++frame; pending.set(id, fn); return id; },
      cancelFrame(id) { pending.delete(id); },
      getViewport() { return { width: 1000, height: 720, dpr: 1, orientation: 'landscape' }; },
      observeViewport() { return () => {}; },
    },
  });
  const s = fakeSdk();
  const lifecycle = createYandexLifecycle({ sdk: s.sdk, host });
  lifecycle.attach();
  await host.initialize();
  assert.equal(await lifecycle.markReady(), true);
  host.start();
  assert.equal(pending.size, 1);
  s.emit('game_api_pause');
  assert.equal(host.getStatus(), 'PAUSED');
  assert.equal(pending.size, 0);
  assert.equal(calls.at(-1), 'audio:pause');
  s.emit('game_api_resume');
  assert.equal(host.getStatus(), 'RUNNING');
  assert.equal(pending.size, 1);
  assert.ok(calls.includes('audio:resume'));
  lifecycle.detach();
  await host.destroy();
});
