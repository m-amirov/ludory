import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeHost } from '@ludory/runtime';
import { createPhaserRenderer } from '../src/index.mjs';

const viewport = { width: 640, height: 360, dpr: 2, orientation: 'landscape' };
const snapshot = { schemaVersion: 1, gameId: 'r5-test', gameVersion: '1.0.0',
  revision: 2, state: { score: 5, nested: { title: 'hello' } } };

function emitter() {
  const handlers = new Map();
  return {
    _events: Object.create(null),
    on(name, listener, context) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(listener);
      const item = { fn: listener, context: context ?? this };
      const prev = this._events[name];
      this._events[name] = prev ? (Array.isArray(prev) ? [...prev, item] : [prev, item]) : item;
      return this;
    },
    once(name, listener) { const wrapped = (...args) => { this.off(name, wrapped); listener(...args); }; return this.on(name, wrapped); },
    off(name, listener) { handlers.get(name)?.delete(listener); return this; },
    emit(name, ...args) { for (const listener of [...(handlers.get(name) ?? [])]) listener(...args); },
    count(name) { return handlers.get(name)?.size ?? 0; },
  };
}

function fakePhaser({ booted = true, running = booted, throwOnGame = false } = {}) {
  const games = [];
  class Game {
    constructor(config) {
      if (throwOnGame) throw new Error('Phaser context unavailable');
      this.config = config;
      this.isBooted = booted;
      this.isRunning = running;
      this.events = emitter();
      this.resizes = [];
      this.scale = { resize: (width, height) => this.resizes.push({ width, height }) };
      this.destroyed = [];
      this.runDestroyed = 0;
      games.push(this);
    }
    destroy(removeCanvas, noReturn) { this.destroyed.push([removeCanvas, noReturn]); }
    runDestroy() { this.runDestroyed++; }
  }
  return { Phaser: { AUTO: 0, Scale: { NONE: 0 }, Game }, games };
}

function makeRenderer(Phaser, records, options = {}) {
  const factory = createPhaserRenderer({
    Phaser,
    sceneFactory(context) {
      records.contexts.push(context);
      const scene = { key: 'test-scene', create() {} };
      records.scenes.push(scene);
      return {
        scene,
        renderSnapshot(next) { records.renders.push(next); },
        onResize(next) { records.viewports.push(next); },
        dispose() { records.disposals++; },
      };
    },
    ...options,
  });
  return factory;
}

function records() { return { contexts: [], scenes: [], renders: [], viewports: [], disposals: 0 }; }

test('mount owns exactly one Phaser.Game and maps root, viewport and scene to game config', async () => {
  const { Phaser, games } = fakePhaser();
  const results = records();
  const renderer = makeRenderer(Phaser, results, { gameConfig: { backgroundColor: '#1a2b3c', width: 1, parent: 'wrong',
    scale: { width: 1, height: 1, parent: 'wrong', mode: 777, autoCenter: 1 } } });
  const root = { id: 'game-container' };
  const initial = structuredClone(snapshot);
  await renderer.mount({ root, viewport, snapshot: initial, dispatchInput() {} });
  assert.equal(games.length, 1);
  assert.equal(games[0].config.parent, root);
  assert.equal(games[0].config.width, 640);
  assert.equal(games[0].config.height, 360);
  assert.equal(games[0].config.scene, results.scenes[0], 'scene must come from factory');
  assert.equal(games[0].config.backgroundColor, '#1a2b3c');
  assert.equal(games[0].config.scale.mode, Phaser.Scale.NONE);
  assert.equal(games[0].config.scale.width, 640);
  assert.equal(games[0].config.scale.height, 360);
  assert.equal(games[0].config.scale.parent, root);
  assert.equal(games[0].config.scale.autoCenter, 1);
  assert.equal(results.contexts[0].Phaser, Phaser);
  assert.deepEqual(results.contexts[0].snapshot, snapshot);
  assert.notStrictEqual(results.contexts[0].snapshot, initial);
  await assert.rejects(renderer.mount({ root, viewport, snapshot, dispatchInput() {} }), /already mounted/i);
  await renderer.unmount();
  assert.deepEqual(games[0].destroyed, [[true, false]]);
  assert.equal(results.disposals, 1);
  await renderer.unmount();
  assert.equal(results.disposals, 1);
});

test('resize passes CSS dimensions to Phaser scale and preserves DPR/orientation for scene hook', async () => {
  const { Phaser, games } = fakePhaser();
  const r = records();
  const renderer = makeRenderer(Phaser, r);
  await renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  renderer.resize({ width: 320, height: 720, dpr: 3, orientation: 'portrait' });
  assert.deepEqual(games[0].resizes, [{ width: 320, height: 720 }]);
  assert.deepEqual(r.viewports.at(-1), { width: 320, height: 720, dpr: 3, orientation: 'portrait' });
  assert.throws(() => renderer.resize({ width: 0, height: 720, dpr: 1, orientation: 'portrait' }), TypeError);
  await renderer.unmount();
});

test('render delivers a detached Core snapshot that scene code cannot mutate in caller', async () => {
  const { Phaser } = fakePhaser();
  const r = records();
  const renderer = makeRenderer(Phaser, r);
  await renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  renderer.render(snapshot);
  assert.deepEqual(r.renders.at(-1), snapshot);
  r.renders.at(-1).state.nested.title = 'tampered';
  r.renders.at(-1).state.score = 100;
  assert.deepEqual(snapshot.state, { score: 5, nested: { title: 'hello' } });
  await renderer.unmount();
});

test('scene input bridge accepts normalized renderer events and blocks stale source and generation', async () => {
  const { Phaser } = fakePhaser();
  const r = records();
  const forwarded = [];
  const renderer = makeRenderer(Phaser, r);
  const context = { root: {}, viewport, snapshot, dispatchInput: event => forwarded.push(event) };
  await renderer.mount(context);
  const emit = r.contexts[0].dispatchInput;
  assert.equal(emit({ schemaVersion: 1, type: 'keyboard', action: 'jump', phase: 'down',
    timestamp: 10, source: 'renderer', key: 'Space' }), true);
  assert.equal(emit({ schemaVersion: 1, type: 'keyboard', action: 'jump', phase: 'down',
    timestamp: 11, source: 'input', key: 'Space' }), false);
  assert.equal(emit({ schemaVersion: 1, type: 'keyboard', action: '', phase: 'down',
    timestamp: 12, source: 'renderer' }), false);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].source, 'renderer');
  await renderer.unmount();
  assert.equal(emit({ schemaVersion: 1, type: 'keyboard', action: 'jump', phase: 'up',
    timestamp: 13, source: 'renderer', key: 'Space' }), false);
  await renderer.mount(context);
  assert.equal(emit({ schemaVersion: 1, type: 'keyboard', action: 'jump', phase: 'up',
    timestamp: 14, source: 'renderer', key: 'Space' }), false);
  await renderer.unmount();
});

test('async Phaser boot gates mount and times out without leaking the game', async () => {
  const delayed = fakePhaser({ booted: false });
  const renderer = makeRenderer(delayed.Phaser, records(), { readyTimeoutMs: 50 });
  let finished = false;
  const mounted = renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} }).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(delayed.games[0].events.count('ready'), 1);
  delayed.games[0].isBooted = true;
  delayed.games[0].events.emit('ready');
  await mounted;
  assert.equal(finished, true);
  await renderer.unmount();

  const stuck = fakePhaser({ booted: false });
  const blocked = makeRenderer(stuck.Phaser, records(), { readyTimeoutMs: 8 });
  await assert.rejects(blocked.mount({ root: {}, viewport, snapshot, dispatchInput() {} }), /boot timed out/i);
  assert.deepEqual(stuck.games[0].destroyed, [[true, false]]);
  assert.equal(stuck.games[0].runDestroyed, 1);
  assert.equal(stuck.games[0].events.count('ready'), 0);
  await blocked.unmount();
});

test('Phaser isBooted may be true before ready event and running frame loop', async () => {
  const early = fakePhaser({ booted: true, running: false });
  const renderer = makeRenderer(early.Phaser, records(), { readyTimeoutMs: 50 });
  let finished = false;
  const mount = renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} }).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(early.games[0].events.count('ready'), 1);
  early.games[0].events.emit('ready');
  await mount;
  await renderer.unmount();
});

test('cancelled mount before document DOMContentLoaded must never construct a late Phaser.Game', async () => {
  const { Phaser, games } = fakePhaser();
  const listeners = new Set();
  const ownerDocument = { readyState: 'loading',
    addEventListener(event, listener) { if (event === 'DOMContentLoaded') listeners.add(listener); },
    removeEventListener(event, listener) { if (event === 'DOMContentLoaded') listeners.delete(listener); },
  };
  const renderer = makeRenderer(Phaser, records(), { readyTimeoutMs: 100 });
  const mounting = renderer.mount({ root: { ownerDocument }, viewport, snapshot, dispatchInput() {} });
  assert.equal(games.length, 0, 'no Phaser instance may be constructed while the owner document is loading');
  await renderer.unmount();
  await assert.rejects(mounting, /interrupted/);
  ownerDocument.readyState = 'complete';
  for (const callback of listeners) callback();
  assert.equal(listeners.size, 0, 'pending DOM listener must be released');
  assert.equal(games.length, 0, 'cancelled game must not be booted after DOM readiness');
  ownerDocument.readyState = 'loading';
  const timed = makeRenderer(Phaser, records(), { readyTimeoutMs: 8 });
  await assert.rejects(timed.mount({ root: { ownerDocument }, viewport, snapshot, dispatchInput() {} }), /DOM ready timed out/i);
  assert.equal(listeners.size, 0, 'DOM timeout must detach its listener');
  assert.equal(games.length, 0);
});

test('scene readiness rejected during engine boot rejects mount promptly without unhandled rejection', async () => {
  const early = fakePhaser({ booted: false });
  let rejectScene;
  const ready = new Promise((_, reject) => { rejectScene = reject; });
  const renderer = createPhaserRenderer({ Phaser: early.Phaser, readyTimeoutMs: 100,
    sceneFactory() { return { scene: {}, ready, renderSnapshot() {} }; },
  });
  const mount = renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  rejectScene(new Error('scene initialization failed'));
  await assert.rejects(mount, /scene initialization failed/i);
  assert.deepEqual(early.games[0].destroyed, [[true, false]]);
  assert.equal(early.games[0].events.count('ready'), 0);
});

test('falsy Promise rejection reasons still reject scene mount instead of marking ready', async () => {
  for (const reason of [undefined, null, false, 0, '']) {
    const { Phaser, games } = fakePhaser();
    const renderer = createPhaserRenderer({ Phaser, readyTimeoutMs: 20,
      sceneFactory() { return { scene: {}, ready: Promise.reject(reason), renderSnapshot() {} }; },
    });
    await assert.rejects(renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} }), /scene ready rejected/i);
    assert.deepEqual(games[0].destroyed, [[true, false]]);
  }
});

test('unmount during pending boot cancels pending mount and prevents a late ready resurrection', async () => {
  const { Phaser, games } = fakePhaser({ booted: false });
  const renderer = makeRenderer(Phaser, records(), { readyTimeoutMs: 200 });
  const mountPromise = renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  assert.equal(games[0].events.count('ready'), 1);
  await renderer.unmount();
  await assert.rejects(mountPromise, /interrupted/i);
  assert.equal(games[0].events.count('ready'), 0);
  games[0].events.emit('ready');
  assert.deepEqual(games[0].destroyed, [[true, false]]);
  const remount = renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  games[1].isBooted = true;
  games[1].events.emit('ready');
  await remount;
  assert.equal(games.length, 2, 'new mount must create a new game');
  await renderer.unmount();
});

test('stalled boot fallback attempts every Phaser destroy listener after one partially initialized subsystem throws', async () => {
  const { Phaser, games } = fakePhaser({ booted: false });
  const renderer = makeRenderer(Phaser, records());
  const mounting = renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  const game = games[0];
  game.runDestroy = () => { throw new Error('scene manager missing sys'); };
  let cleaned = 0;
  const subsystem = { cleanup() { throw new Error('uninitialized texture'); } };
  game.events.on('destroy', subsystem.cleanup, subsystem);
  game.events.on('destroy', () => { cleaned++; });
  await renderer.unmount();
  await assert.rejects(mounting, /interrupted/);
  assert.equal(cleaned, 1, 'one broken destroy listener must not prevent later subsystem cleanup');
});

test('unmount finishes destruction immediately if a previously running Phaser loop was stopped', async () => {
  const { Phaser: base, games } = fakePhaser();
  const Phaser = { ...base, Game: class extends base.Game {
    constructor(config) {
      super(config);
      // Phaser Game.isRunning stays true after TimeStep.stop(); no next
      // frame is scheduled to process pendingDestroy in this state.
      this.loop = { running: false };
    }
  } };
  const renderer = makeRenderer(Phaser, records());
  await renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  assert.equal(games[0].isRunning, true);
  await renderer.unmount();
  assert.deepEqual(games[0].destroyed, [[true, false]]);
  assert.equal(games[0].runDestroyed, 1, 'stopped frame loop must not strand pending destruction');
});

test('reentrant unmount inside Phaser.Game constructor cleans the constructed game', async () => {
  const { Phaser: base, games } = fakePhaser();
  let renderer;
  const Phaser = { ...base, Game: class extends base.Game {
    constructor(config) {
      super(config);
      // A game callback can synchronously unmount while new Game executes,
      // before its returned value is assigned to renderer state.
      void renderer.unmount();
    }
  } };
  renderer = makeRenderer(Phaser, records());
  await assert.rejects(renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} }), /interrupted/i);
  assert.equal(games.length, 1);
  assert.deepEqual(games[0].destroyed, [[true, false]], 'constructed game cannot be orphaned');
  await renderer.unmount();
});

test('postBoot unmount cannot destroy the Phaser loop before Game.start calls loop.start', async () => {
  const { Phaser: base, games } = fakePhaser({ booted: false, running: false });
  let renderer;
  const Phaser = { ...base, Game: class extends base.Game {
    constructor(config) {
      super(config);
      this.loop = { running: false, startedAfterDestroy: false,
        start: () => {
          this.loop.startedAfterDestroy = this.runDestroyed > 0;
          this.loop.running = true;
        },
      };
      this.events.on('ready', () => {
        // Phaser Game.start(): isRunning=true; postBoot(game); loop.start()
        this.isRunning = true;
        config.callbacks.postBoot(this);
        this.loop.start();
      });
    }
  } };
  renderer = makeRenderer(Phaser, records(), { gameConfig: {
    callbacks: { postBoot() { void renderer.unmount(); } },
  } });
  const mounting = renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  games[0].events.emit('ready');
  await assert.rejects(mounting, /interrupted/i);
  assert.deepEqual(games[0].destroyed, [[true, false]]);
  assert.equal(games[0].loop.startedAfterDestroy, false,
    'a postBoot callback must not destroy Phaser loop before the start stack unwinds');
});

test('concurrent unmount calls both wait for the same in-flight Phaser cleanup', async () => {
  const { Phaser: base } = fakePhaser();
  const Phaser = { ...base, Game: class extends base.Game {
    constructor(config) { super(config); this.loop = { running: false }; }
  } };
  const r = records();
  const renderer = makeRenderer(Phaser, r);
  await renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  const first = renderer.unmount();
  const second = renderer.unmount();
  await second;
  assert.equal(r.disposals, 1, 'later callers cannot observe unmount completion before cleanup');
  await first;
  assert.equal(r.disposals, 1, 'scene dispose occurs exactly once');
});

test('remount waits for the previous stopped Phaser game to be fully released', async () => {
  const { Phaser: base, games } = fakePhaser();
  const Phaser = { ...base, Game: class extends base.Game {
    constructor(config) { super(config); this.loop = { running: false }; }
  } };
  const r = records();
  const renderer = makeRenderer(Phaser, r);
  const context = { root: {}, viewport, snapshot, dispatchInput() {} };
  await renderer.mount(context);
  const release = renderer.unmount();
  const nextMount = renderer.mount(context);
  assert.equal(games.length, 1, 'new game must not be constructed before teardown settles');
  await nextMount;
  assert.equal(r.disposals, 1, 'prior scene must be disposed before next mount resolves');
  assert.equal(games.length, 2);
  await release;
  await renderer.unmount();
});

test('all concurrent unmount callers observe the same cleanup failure', async () => {
  const { Phaser: base } = fakePhaser();
  const Phaser = { ...base, Game: class extends base.Game {
    constructor(config) { super(config); this.loop = { running: false }; }
  } };
  let failDisposal = true;
  const renderer = createPhaserRenderer({ Phaser, sceneFactory() {
    return { scene: {}, renderSnapshot() {}, dispose() {
      if (failDisposal) throw new Error('scene teardown failed');
    } };
  } });
  const context = { root: {}, viewport, snapshot, dispatchInput() {} };
  await renderer.mount(context);
  const first = renderer.unmount();
  const second = renderer.unmount();
  await assert.rejects(second, /scene teardown failed/);
  await assert.rejects(first, /scene teardown failed/);
  failDisposal = false;
  await renderer.mount(context);
  await renderer.unmount();
});

test('reentrant unmount inside sceneFactory disposes the returned scene without constructing Phaser', async () => {
  const { Phaser, games } = fakePhaser();
  let renderer;
  let disposals = 0;
  renderer = createPhaserRenderer({ Phaser, sceneFactory() {
    void renderer.unmount();
    return { scene: {}, renderSnapshot() {}, dispose() { disposals++; } };
  } });
  await assert.rejects(renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} }), /interrupted/i);
  assert.equal(disposals, 1, 'a scene returned after cancellation still needs disposal');
  assert.equal(games.length, 0, 'cancelled factory must not create a Phaser game');
});

test('optional scene ready promise must settle before mount resolves or initial rendering starts', async () => {
  const { Phaser, games } = fakePhaser();
  let resolveScene;
  const sceneReady = new Promise(resolve => { resolveScene = resolve; });
  const rendered = [];
  const renderer = createPhaserRenderer({ Phaser, readyTimeoutMs: 50,
    sceneFactory() { return { scene: { create() {} }, ready: sceneReady,
      renderSnapshot(next) { rendered.push(next); } }; },
  });
  let mounted = false;
  const promise = renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} }).then(() => { mounted = true; });
  await Promise.resolve();
  assert.equal(mounted, false, 'Game boot alone is not enough for a ready scene');
  assert.throws(() => renderer.render(snapshot), /not mounted/i);
  resolveScene();
  await promise;
  renderer.render(snapshot);
  assert.equal(rendered.length, 1);
  await renderer.unmount();
  assert.deepEqual(games[0].destroyed, [[true, false]]);

  const hung = fakePhaser();
  const waiting = createPhaserRenderer({ Phaser: hung.Phaser, readyTimeoutMs: 8,
    sceneFactory() { return { scene: {}, ready: new Promise(() => {}), renderSnapshot() {} }; },
  });
  await assert.rejects(waiting.mount({ root: {}, viewport, snapshot, dispatchInput() {} }), /scene ready timed out/i);
  assert.deepEqual(hung.games[0].destroyed, [[true, false]]);
});

test('failed Phaser construction and scene hooks clean up without blocking later mounts', async () => {
  const dead = fakePhaser({ throwOnGame: true });
  const renderer = makeRenderer(dead.Phaser, records());
  await assert.rejects(renderer.mount({ root: {}, viewport, snapshot, dispatchInput() {} }), /context unavailable/);
  await renderer.unmount();
  const { Phaser, games } = fakePhaser();
  let phase = 0;
  const reusable = createPhaserRenderer({ Phaser, sceneFactory() {
    return { scene: { key: 'scene' }, renderSnapshot() {},
      dispose() { if (phase === 0) throw Error('dispose failed'); } };
  } });
  await reusable.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  await assert.rejects(reusable.unmount(), /dispose failed/);
  assert.deepEqual(games[0].destroyed, [[true, false]]);
  phase++;
  await reusable.mount({ root: {}, viewport, snapshot, dispatchInput() {} });
  await reusable.unmount();
});

test('real Runtime/Core consumes Phaser scene inputs exactly once per frame and ignores paused input', async () => {
  const { Phaser } = fakePhaser();
  const r = records();
  const renderer = makeRenderer(Phaser, r);
  const scheduled = new Map();
  let nextFrame = 0;
  let timestamp = 10;
  const input = { subscribe: () => () => {}, enable() {}, disable() {} };
  const host = createRuntimeHost({
    game: { schemaVersion: 1, id: 'r5-test', version: '1.0.0',
      title: { en: 'R5 Test' }, engine: 'web', targets: ['yandex-games'] },
    initialState: { score: 0 },
    update({ inputs, state, setState }) { setState({ score: state.score + inputs.length }); },
    renderer, input,
    environment: { root: {}, now: () => timestamp,
      requestFrame(fn) { const id = ++nextFrame; scheduled.set(id, fn); return id; },
      cancelFrame(id) { scheduled.delete(id); },
      getViewport: () => viewport, observeViewport: () => () => {} },
  });
  await host.initialize();
  host.start();
  const send = r.contexts[0].dispatchInput;
  const event = phase => ({ schemaVersion: 1, type: 'keyboard', action: 'jump', phase,
    timestamp: 10, source: 'renderer', key: 'Space' });
  send(event('down'));
  const tick = () => { const [id, callback] = scheduled.entries().next().value; scheduled.delete(id); callback(); };
  tick();
  assert.equal(host.getSnapshot().state.score, 1);
  host.pause();
  send(event('up'));
  host.resume();
  timestamp = 20;
  tick();
  assert.equal(host.getSnapshot().state.score, 1);
  assert.equal(r.renders.at(-1).revision, 2);
  await host.destroy();
});

test('adapter package loads in Node without Phaser or browser globals at module import', () => {
  assert.equal(typeof createPhaserRenderer, 'function');
  assert.throws(() => createPhaserRenderer({ sceneFactory() {} }), TypeError);
  assert.throws(() => createPhaserRenderer({ Phaser: fakePhaser().Phaser }), TypeError);
  assert.throws(() => createPhaserRenderer({ Phaser: fakePhaser().Phaser, sceneFactory() {}, readyTimeoutMs: 0 }), TypeError);
});
