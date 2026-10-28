import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeHost, RuntimeError } from '../src/index.mjs';

const game = {
  schemaVersion: 1, id: 'runtime-r2', version: '1.0.0',
  title: { en: 'Runtime R2' }, engine: 'web', targets: ['yandex-games'],
};

function harness(overrides = {}) {
  let time = 0;
  let nextHandle = 0;
  const pending = new Map();
  const callbacks = new Map();
  const viewportListeners = new Set();
  const inputListeners = new Set();
  const actions = [];
  let viewport = { width: 800, height: 600, dpr: 1, orientation: 'landscape' };
  const environment = {
    root: Object.freeze({ name: 'test-root' }),
    now: () => time,
    requestFrame(callback) { const handle = ++nextHandle; pending.set(handle, callback); callbacks.set(handle, callback); return handle; },
    cancelFrame(handle) { pending.delete(handle); actions.push('frame:cancel'); },
    getViewport: () => viewport,
    observeViewport(listener) { viewportListeners.add(listener); return () => { viewportListeners.delete(listener); actions.push('viewport:unsubscribe'); }; },
  };
  const input = {
    subscribe(listener) { inputListeners.add(listener); return () => { inputListeners.delete(listener); actions.push('input:unsubscribe'); }; },
    enable() { actions.push('input:enable'); },
    disable() { actions.push('input:disable'); },
    destroy() { actions.push('input:destroy'); },
  };
  const renderer = {
    async mount(context) { actions.push('renderer:mount'); assert.equal(context.root, environment.root); },
    resize(next) { actions.push(`renderer:resize:${next.width}`); },
    render(snapshot) { actions.push(`renderer:render:${snapshot.revision}`); },
    async unmount() { actions.push('renderer:unmount'); },
  };
  const audio = {
    pauseAll() { actions.push('audio:pause'); },
    resumeAll() { actions.push('audio:resume'); },
  };
  const options = {
    game, initialState: { score: 1 },
    update({ deltaMs, inputs, state, setState }) {
      assert.deepEqual(inputs, []);
      setState({ score: state.score + deltaMs + 1 });
    },
    renderer, input, audio, environment,
    ...overrides,
  };
  return {
    host: createRuntimeHost(options), environment, input, renderer, audio, actions,
    get pending() { return pending.size; },
    setTime(value) { time = value; },
    step() { assert.equal(pending.size, 1); const [[handle, callback]] = pending; pending.delete(handle); callback(); },
    late(handle) { callbacks.get(handle)(); },
    emitViewport(next) { viewport = next; for (const listener of [...viewportListeners]) listener(next); },
    get subscriptions() { return { viewport: viewportListeners.size, input: inputListeners.size }; },
  };
}

function assertError(code) {
  return error => error instanceof RuntimeError && error.code === code;
}

test('host uses real Core session with terminal stop and idempotent lifecycle operations', async () => {
  const fixture = harness();
  const { host } = fixture;
  assert.equal(host.getStatus(), 'IDLE');
  assert.throws(() => host.start(), assertError('INVALID_RUNTIME_TRANSITION'));
  await host.initialize();
  assert.equal(host.getStatus(), 'READY');
  assert.deepEqual(host.getSnapshot(), {
    schemaVersion: 1, gameId: 'runtime-r2', gameVersion: '1.0.0', revision: 0, state: { score: 1 },
  });
  host.start();
  assert.equal(host.getStatus(), 'RUNNING');
  fixture.setTime(123);
  fixture.step();
  assert.deepEqual(host.getSnapshot().state, { score: 2 });
  fixture.setTime(143);
  fixture.step();
  assert.deepEqual(host.getSnapshot().state, { score: 23 });
  host.pause();
  host.pause();
  assert.equal(host.getStatus(), 'PAUSED');
  assert.equal(fixture.pending, 0);
  assert.throws(() => host.start(), assertError('INVALID_RUNTIME_TRANSITION'));
  host.resume();
  host.resume();
  fixture.setTime(70_000);
  fixture.step();
  assert.deepEqual(host.getSnapshot().state, { score: 24 });
  host.stop();
  host.stop();
  assert.equal(host.getStatus(), 'STOPPED');
  assert.equal(fixture.pending, 0);
  assert.throws(() => host.resume(), assertError('INVALID_RUNTIME_TRANSITION'));
  await assert.rejects(host.initialize(), assertError('INVALID_RUNTIME_TRANSITION'));
  await host.destroy();
  await host.destroy();
  assert.equal(host.getStatus(), 'DESTROYED');
  assert.deepEqual(fixture.subscriptions, { viewport: 0, input: 0 });
  assert.equal(fixture.actions.filter(action => action === 'renderer:unmount').length, 1);
  assert.equal(fixture.actions.includes('input:destroy'), false);
});

test('initialize is single-flight; failed mount cleans up and leaves IDLE for retry', async () => {
  let release;
  let attempts = 0;
  const renderer = {
    mount() { attempts++; return new Promise((resolve, reject) => { release = { resolve, reject }; }); },
    resize() {}, render() {}, unmount() { attempts += 10; },
  };
  const f = harness({ renderer });
  const pending = f.host.initialize();
  assert.equal(attempts, 1);
  await assert.rejects(f.host.initialize(), assertError('RUNTIME_OPERATION_IN_PROGRESS'));
  assert.throws(() => f.host.start(), assertError('RUNTIME_OPERATION_IN_PROGRESS'));
  release.reject(new Error('mount denied'));
  await assert.rejects(pending, error => assertError('INITIALIZE_FAILED')(error) && error.cause?.message === 'mount denied');
  assert.equal(f.host.getStatus(), 'IDLE');
  assert.equal(attempts, 11);
  const retried = f.host.initialize();
  release.resolve();
  await retried;
  assert.equal(f.host.getStatus(), 'READY');
  await f.host.destroy();
});

test('update and renderer exceptions fault host, cancel scheduling and stop gameplay', async () => {
  for (const part of ['update', 'render']) {
    const issue = new Error(`${part} exploded`);
    const f = harness(part === 'update'
      ? { update() { throw issue; } }
      : { renderer: { mount() {}, resize() {}, render() { throw issue; }, unmount() {} } });
    const events = [];
    f.host.subscribe(event => events.push(event));
    assert.equal(f.host.getLastError(), null);
    await f.host.initialize();
    f.host.start();
    f.step();
    assert.equal(f.host.getStatus(), 'FAULTED');
    assert.equal(f.pending, 0);
    const fault = f.host.getLastError();
    assert.ok(fault instanceof RuntimeError);
    assert.equal(fault.cause, issue);
    assert.equal(fault.code, 'INVALID_RUNTIME_TRANSITION');
    assert.ok(events.some(event => event.type === 'error' && event.status === 'FAULTED' && typeof event.errorCode === 'string'));
    assert.throws(() => f.host.resume(), assertError('INVALID_RUNTIME_TRANSITION'));
    await f.host.destroy();
    assert.equal(f.host.getStatus(), 'DESTROYED');
    assert.strictEqual(f.host.getLastError(), fault, 'fault remains inspectable after destruction');
  }
});

test('viewport callback failures fault host; subscriber errors cannot suppress other listeners', async () => {
  const cause = new Error('resize failure');
  const f = harness({ renderer: { mount() {}, resize() { throw cause; }, render() {}, unmount() {} } });
  const events = [];
  f.host.subscribe(() => { throw Error('listener failed'); });
  f.host.subscribe(event => events.push(event));
  await f.host.initialize();
  f.host.start();
  f.emitViewport({ width: 360, height: 640, dpr: 2, orientation: 'portrait' });
  assert.equal(f.host.getStatus(), 'FAULTED');
  assert.equal(f.pending, 0);
  assert.strictEqual(f.host.getLastError()?.cause, cause);
  assert.ok(events.some(event => event.type === 'status' && event.status === 'RUNNING'));
  assert.ok(events.some(event => event.type === 'error' && event.status === 'FAULTED'));
  await f.host.destroy();
});

test('destroy cleans up after unmount failure and never destroys caller-owned adapters', async () => {
  const cause = new Error('unmount failed');
  const f = harness({ renderer: { mount() {}, resize() {}, render() {}, unmount() { throw cause; } } });
  await f.host.initialize();
  f.host.start();
  await assert.rejects(f.host.destroy(), error => {
    assert.strictEqual(f.host.getLastError(), error);
    return error instanceof RuntimeError && error.cause === cause;
  });
  assert.equal(f.host.getStatus(), 'DESTROYED');
  assert.equal(f.pending, 0);
  assert.deepEqual(f.subscriptions, { viewport: 0, input: 0 });
  assert.equal(f.actions.includes('input:destroy'), false);
});

test('destroy still detaches both listeners when an earlier cleanup step fails', async () => {
  const f = harness();
  await f.host.initialize();
  f.host.start();
  f.input.disable = () => { throw new Error('input disable failed'); };
  await assert.rejects(f.host.destroy(), error => error instanceof RuntimeError && error.cause?.message === 'input disable failed');
  assert.equal(f.host.getStatus(), 'DESTROYED');
  assert.equal(f.pending, 0);
  assert.deepEqual(f.subscriptions, { viewport: 0, input: 0 });
  assert.equal(f.actions.filter(action => action === 'renderer:unmount').length, 1);
});

test('late frame callback after pause or stop cannot tick Core or render', async () => {
  const f = harness();
  await f.host.initialize();
  f.host.start();
  f.host.pause();
  f.late(1);
  assert.equal(f.host.getSnapshot().revision, 0);
  f.host.resume();
  f.step();
  const beforeStop = f.host.getSnapshot();
  f.host.stop();
  f.late(2);
  assert.deepEqual(f.host.getSnapshot(), beforeStop);
  await f.host.destroy();
});

test('renderer receives independent Core snapshots and cannot mutate game state', async () => {
  let snapshotFromMount;
  const f = harness({ renderer: {
    mount({ snapshot }) { snapshotFromMount = snapshot; snapshot.state.score = 999; },
    resize() {},
    render(snapshot) { snapshot.state.score = -999; },
    unmount() {},
  } });
  await f.host.initialize();
  assert.deepEqual(f.host.getSnapshot().state, { score: 1 });
  f.host.start();
  f.step();
  assert.deepEqual(f.host.getSnapshot().state, { score: 2 });
  const external = f.host.getSnapshot();
  external.state.score = 1000;
  assert.deepEqual(f.host.getSnapshot().state, { score: 2 });
  assert.notStrictEqual(snapshotFromMount, external);
  await f.host.destroy();
});

test('subscriber may stop host during RUNNING event without leaving a live scheduler', async () => {
  const f = harness();
  await f.host.initialize();
  f.host.subscribe(event => { if (event.type === 'status' && event.status === 'RUNNING') f.host.stop(); });
  f.host.start();
  assert.equal(f.host.getStatus(), 'STOPPED');
  assert.equal(f.pending, 0);
  await f.host.destroy();
});

test('subscriber may asynchronously destroy during RUNNING event without scheduling on stopped Core', async () => {
  const f = harness();
  await f.host.initialize();
  let destruction;
  f.host.subscribe(event => {
    if (event.type === 'status' && event.status === 'RUNNING') destruction = f.host.destroy();
  });
  f.host.start();
  assert.equal(f.pending, 0);
  await destruction;
  assert.equal(f.host.getStatus(), 'DESTROYED');
  assert.equal(f.pending, 0);
});

test('synchronous update stopping Core prevents a renderer call after terminal stop', async () => {
  let fixture;
  let renders = 0;
  fixture = harness({
    update() { fixture.host.stop(); },
    renderer: { mount() {}, resize() {}, render() { renders++; }, unmount() {} },
  });
  await fixture.host.initialize();
  fixture.host.start();
  fixture.step();
  assert.equal(fixture.host.getStatus(), 'STOPPED');
  assert.equal(fixture.pending, 0);
  assert.equal(renders, 0);
  await fixture.host.destroy();
});

test('synchronous update beginning async destroy never renders onto unmounted adapter', async () => {
  let fixture;
  let destruction;
  let renders = 0;
  fixture = harness({
    update() { destruction = fixture.host.destroy(); },
    renderer: { mount() {}, resize() {}, render() { renders++; }, unmount() {} },
  });
  await fixture.host.initialize();
  fixture.host.start();
  fixture.step();
  assert.equal(renders, 0);
  await destruction;
  assert.equal(fixture.host.getStatus(), 'DESTROYED');
  assert.equal(fixture.pending, 0);
});

test('input enable may synchronously stop newly running host without resurrecting status or frame', async () => {
  const f = harness();
  await f.host.initialize();
  f.input.enable = () => { f.host.stop(); };
  f.host.start();
  assert.equal(f.host.getStatus(), 'STOPPED');
  assert.equal(f.pending, 0);
  await f.host.destroy();
});

test('input enable on resume may stop host without scheduling a resumed tick', async () => {
  const f = harness();
  await f.host.initialize();
  f.host.start();
  f.host.pause();
  f.input.enable = () => { f.host.stop(); };
  f.host.resume();
  assert.equal(f.host.getStatus(), 'STOPPED');
  assert.equal(f.pending, 0);
  await f.host.destroy();
});

test('stale viewport callbacks during async unmount cannot resize a closing renderer', async () => {
  let finishUnmount;
  let resizeCount = 0;
  const f = harness({ renderer: {
    mount() {},
    resize() { resizeCount++; },
    render() {},
    unmount() { return new Promise(resolve => { finishUnmount = resolve; }); },
  } });
  const observe = f.environment.observeViewport;
  let staleCallback;
  f.environment.observeViewport = callback => {
    staleCallback = callback;
    return observe(callback);
  };
  await f.host.initialize();
  f.host.start();
  const destruction = f.host.destroy();
  staleCallback({ width: 360, height: 640, dpr: 2, orientation: 'portrait' });
  assert.equal(resizeCount, 0);
  finishUnmount();
  await destruction;
  assert.equal(f.host.getStatus(), 'DESTROYED');
});

test('save and restore are fail-closed until R4 with no false successful persistence', async () => {
  const f = harness();
  await assert.rejects(f.host.save(), assertError('INVALID_RUNTIME_TRANSITION'));
  await f.host.initialize();
  await assert.rejects(f.host.save(), assertError('STORAGE_UNAVAILABLE'));
  await assert.rejects(f.host.restore(), assertError('STORAGE_UNAVAILABLE'));
  assert.equal(f.host.getStatus(), 'READY');
  await f.host.destroy();
});

test('last error captures failed initialization and clears when a fresh initialization succeeds', async () => {
  let failMount = true;
  const cause = new Error('mount unavailable');
  const f = harness({ renderer: {
    mount() { if (failMount) throw cause; },
    resize() {}, render() {}, unmount() {},
  } });
  await assert.rejects(f.host.initialize(), error => {
    assert.strictEqual(f.host.getLastError(), error);
    return error instanceof RuntimeError && error.cause === cause && error.code === 'INITIALIZE_FAILED';
  });
  failMount = false;
  await f.host.initialize();
  assert.equal(f.host.getLastError(), null);
  await f.host.destroy();
});
