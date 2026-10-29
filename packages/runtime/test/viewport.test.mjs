import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewportTracker } from '../src/viewport.mjs';

const landscape = { width: 800, height: 600, dpr: 1, orientation: 'landscape' };

test('viewport tracker passes mount dimensions, ordered resize and DPR without device guessing', () => {
  let current = landscape;
  const listeners = new Set();
  const updates = [];
  const tracker = createViewportTracker({
    getViewport: () => current,
    observeViewport(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    onResize: viewport => updates.push(viewport),
    onError: error => { throw error; },
  });
  assert.deepEqual(tracker.initial(), landscape);
  tracker.attach();
  assert.deepEqual(updates, []);
  current = { width: 375, height: 812, dpr: 3, orientation: 'portrait' };
  for (const listener of listeners) listener(current);
  current = { width: 600, height: 600, dpr: 2, orientation: 'portrait' };
  for (const listener of listeners) listener(current);
  assert.deepEqual(updates, [
    { width: 375, height: 812, dpr: 3, orientation: 'portrait' },
    { width: 600, height: 600, dpr: 2, orientation: 'portrait' },
  ]);
  assert.equal(Object.hasOwn(updates[0], 'deviceClass'), false);
  tracker.detach();
  assert.equal(listeners.size, 0);
});

test('viewport tracker catches changes during async mount and ignores late callbacks after detach', () => {
  let current = landscape;
  let stale;
  const seen = [];
  const tracker = createViewportTracker({
    getViewport: () => current,
    observeViewport(callback) { stale = callback; return () => {}; },
    onResize: viewport => seen.push(viewport),
    onError: error => { throw error; },
  });
  tracker.initial();
  current = { width: 320, height: 480, dpr: 2, orientation: 'portrait' };
  tracker.attach();
  assert.deepEqual(seen, [current]);
  tracker.detach();
  stale({ width: 500, height: 600, dpr: 3, orientation: 'portrait' });
  assert.deepEqual(seen, [current]);
});

test('viewport tracker rejects invalid dimensions and reports invalid live viewport', () => {
  const errors = [];
  let callback;
  const tracker = createViewportTracker({
    getViewport: () => landscape,
    observeViewport(listener) { callback = listener; return () => {}; },
    onResize() {},
    onError: error => errors.push(error),
  });
  tracker.initial();
  tracker.attach();
  callback({ width: 0, height: 600, dpr: 1, orientation: 'portrait' });
  callback({ width: 600, height: 600, dpr: NaN, orientation: 'portrait' });
  callback({ width: 600, height: 600, dpr: 1, orientation: 'landscape' });
  assert.equal(errors.length, 3);
  for (const error of errors) assert.ok(error instanceof TypeError);
  tracker.detach();
});
