import test from 'node:test';
import assert from 'node:assert/strict';
import { createVkLifecycle } from '../src/lifecycle.mjs';

function fixture(status = 'RUNNING') {
  const listeners = new Set();
  const trace = [];
  const bridge = {
    subscribe(fn) { listeners.add(fn); },
    unsubscribe(fn) { listeners.delete(fn); },
    emit(type) { for (const fn of listeners) fn({ detail: { type } }); },
    size() { return listeners.size; },
  };
  const host = {
    getStatus: () => status,
    pause() { trace.push('pause'); status = 'PAUSED'; },
    resume() { trace.push('resume'); status = 'RUNNING'; },
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
