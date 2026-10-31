import test from 'node:test';
import assert from 'node:assert/strict';
import { createVkLifecycle } from '../src/lifecycle.mjs';

function fixture(status = 'RUNNING') {
  const listeners = new Set();
  const trace = [];
  const statusListeners = new Set();
  const emitStatus = () => { for (const fn of [...statusListeners]) fn({ type: 'status', status }); };
  const bridge = {
    subscribe(fn) { listeners.add(fn); },
    unsubscribe(fn) { listeners.delete(fn); },
    emit(type) { for (const fn of listeners) fn({ detail: { type } }); },
    size() { return listeners.size; },
  };
  const host = {
    getStatus: () => status,
    subscribe(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    start() { trace.push('start'); status = 'RUNNING'; emitStatus(); },
    pause() { trace.push('pause'); status = 'PAUSED'; emitStatus(); },
    resume() { trace.push('resume'); status = 'RUNNING'; emitStatus(); },
  };
  const audio = {
    pauseAll() { trace.push('audio:pause'); },
    resumeAll() { trace.push('audio:resume'); },
  };
  return { bridge, host, audio, trace, get status() { return status; } };
}

test('VK hide/restore pauses once, resumes once and cleans up subscriptions', () => {
  const f = fixture(), lifecycle = createVkLifecycle(f);
  assert.equal(lifecycle.attach(), true);
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  f.bridge.emit('VKWebAppViewHide');
  assert.deepEqual(f.trace, ['pause', 'audio:pause']);
  f.bridge.emit('VKWebAppViewRestore');
  f.bridge.emit('VKWebAppViewRestore');
  assert.deepEqual(f.trace, ['pause', 'audio:pause', 'resume', 'audio:resume']);
  lifecycle.detach();
  lifecycle.detach();
  assert.equal(f.bridge.size(), 0);
  f.bridge.emit('VKWebAppViewHide');
  assert.equal(f.status, 'RUNNING');
});

test('VK restore cannot resume a game that was already manually paused', () => {
  const f = fixture('PAUSED'), lifecycle = createVkLifecycle(f);
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  f.bridge.emit('VKWebAppViewRestore');
  assert.deepEqual(f.trace, []);
  assert.equal(f.status, 'PAUSED');
});

test('manual pause set during VK-owned pause outlives view restore', () => {
  const f = fixture(), lifecycle = createVkLifecycle(f);
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  lifecycle.setManualPaused(true);
  f.bridge.emit('VKWebAppViewRestore');
  assert.equal(f.status, 'PAUSED');
  lifecycle.setManualPaused(false);
  assert.equal(f.status, 'RUNNING');
  assert.deepEqual(f.trace, ['pause', 'audio:pause', 'resume', 'audio:resume']);
});

test('browser visibility and VK view events retain independent pause reasons', () => {
  const f = fixture();
  const documentObject = { visibilityState: 'visible', callbacks: new Map(),
    addEventListener(name, fn) { this.callbacks.set(name, fn); },
    removeEventListener(name) { this.callbacks.delete(name); },
    emit(name) { this.callbacks.get(name)?.(); },
  };
  const lifecycle = createVkLifecycle({ ...f, documentObject });
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  documentObject.visibilityState = 'hidden';
  documentObject.emit('visibilitychange');
  f.bridge.emit('VKWebAppViewRestore');
  assert.equal(f.status, 'PAUSED');
  documentObject.visibilityState = 'visible';
  documentObject.emit('visibilitychange');
  assert.equal(f.status, 'RUNNING');
  lifecycle.detach();
  assert.equal(documentObject.callbacks.size, 0);
});

test('canResume=false holds VK pause, and detach prevents late resume', () => {
  const f = fixture(); let permitted = false;
  const lifecycle = createVkLifecycle({ ...f, canResume: () => permitted });
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  f.bridge.emit('VKWebAppViewRestore');
  assert.equal(f.status, 'PAUSED');
  permitted = true;
  lifecycle.setManualPaused(false);
  assert.equal(f.status, 'RUNNING');
  f.bridge.emit('VKWebAppViewHide');
  lifecycle.detach();
  f.bridge.emit('VKWebAppViewRestore');
  assert.equal(f.status, 'PAUSED');
});

test('bridge subscribe errors and asynchronous canResume fail closed', () => {
  const f = fixture();
  f.bridge.subscribe = () => { throw new Error('SDK denied'); };
  const lifecycle = createVkLifecycle(f);
  assert.equal(lifecycle.attach(), false);
  assert.equal(lifecycle.getStatus(), 'DETACHED');
  assert.equal(lifecycle.getLastError().code, 'LIFECYCLE_FAILED');
  const g = fixture();
  const other = createVkLifecycle({ ...g, canResume: async () => true });
  other.attach();
  g.bridge.emit('VKWebAppViewHide');
  g.bridge.emit('VKWebAppViewRestore');
  assert.equal(g.status, 'PAUSED');
  assert.equal(other.getLastError().code, 'LIFECYCLE_FAILED');
});

test('invalid lifecycle inputs are rejected before subscribing', () => {
  const f = fixture();
  assert.throws(() => createVkLifecycle({ ...f, bridge: {} }), TypeError);
  assert.throws(() => createVkLifecycle({ ...f, host: {} }), TypeError);
  assert.throws(() => createVkLifecycle({ ...f, canResume: 0 }), TypeError);
});


test('active VK hide reason pauses a Runtime that starts later', () => {
  const f = fixture('READY'), lifecycle = createVkLifecycle(f);
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  f.host.start();
  assert.equal(f.status, 'PAUSED');
  assert.deepEqual(f.trace, ['start', 'pause', 'audio:pause']);
  lifecycle.detach();
});

test('external host resume is re-paused while the VK view remains hidden', () => {
  const f = fixture(), lifecycle = createVkLifecycle(f);
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  f.host.resume();
  assert.equal(f.status, 'PAUSED');
  assert.equal(f.trace.filter(action => action === 'pause').length, 2);
});

test('async canResume rejection is observed, does not cause unhandled rejection', async () => {
  const f = fixture(), lifecycle = createVkLifecycle({
    ...f, canResume: async () => { throw new Error('denied'); },
  });
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  f.bridge.emit('VKWebAppViewRestore');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.status, 'PAUSED');
  assert.equal(lifecycle.getLastError().code, 'LIFECYCLE_FAILED');
});

test('reentrant detach during host.pause does not revive stale pause ownership', () => {
  const f = fixture();
  let lifecycle;
  const pause = f.host.pause;
  f.host.pause = () => { pause(); lifecycle.detach(); };
  lifecycle = createVkLifecycle(f);
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  assert.equal(lifecycle.getStatus(), 'DETACHED');
  assert.deepEqual(f.trace, ['pause']);
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewRestore');
  assert.equal(f.status, 'PAUSED');
});


test('synchronous canResume detach never resumes a stale Runtime generation', () => {
  const f = fixture();
  let lifecycle;
  lifecycle = createVkLifecycle({ ...f, canResume: () => { lifecycle.detach(); return true; } });
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  f.bridge.emit('VKWebAppViewRestore');
  assert.equal(lifecycle.getStatus(), 'DETACHED');
  assert.equal(f.status, 'PAUSED');
  assert.equal(f.trace.includes('resume'), false);
});

test('synchronous resume guard adding new VK hide reason cannot resume', () => {
  const f = fixture();
  const lifecycle = createVkLifecycle({
    ...f, canResume: () => { f.bridge.emit('VKWebAppViewHide'); return true; },
  });
  lifecycle.attach();
  f.bridge.emit('VKWebAppViewHide');
  f.bridge.emit('VKWebAppViewRestore');
  assert.equal(f.status, 'PAUSED');
  assert.equal(f.trace.includes('resume'), false);
});
