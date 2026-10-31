import test from 'node:test';
import assert from 'node:assert/strict';
import { createVkConnector, probeVkCapabilities, VkConnectError } from '../src/index.mjs';

const makeBridge = (send = async () => ({})) => ({
  send, subscribe() {}, unsubscribe() {},
});
const code = expected => error => error instanceof VkConnectError && error.code === expected;
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('V1 exports are browser-global-free on Node import', async () => {
  assert.equal(typeof createVkConnector, 'function');
  assert.equal(typeof probeVkCapabilities, 'function');
  assert.equal(globalThis.window, undefined);
});

test('no injected bridge fails closed: does not fabricate VK SDK', async () => {
  const connector = createVkConnector();
  await assert.rejects(connector.initialize(), code('BRIDGE_UNAVAILABLE'));
  assert.equal(connector.getStatus(), 'FAILED');
  await assert.rejects(connector.initialize(), code('SDK_INIT_FAILED'));
});

test('concurrent initialization performs VKWebAppInit only once', async () => {
  const waiting = deferred();
  let loads = 0; let initCount = 0;
  const bridge = makeBridge(async method => {
    assert.equal(method, 'VKWebAppInit');
    initCount++;
    return {};
  });
  const connector = createVkConnector({ bridgeLoader: ({ signal }) => {
    assert.ok(signal instanceof AbortSignal);
    loads++;
    return waiting.promise;
  } });
  const one = connector.initialize(), two = connector.initialize();
  assert.strictEqual(one, two);
  assert.equal(connector.getStatus(), 'INITIALIZING');
  waiting.resolve(bridge);
  const result = await one;
  assert.equal(loads, 1); assert.equal(initCount, 1);
  assert.equal(connector.getStatus(), 'READY');
  assert.strictEqual(result.bridge, bridge);
  assert.equal(result.livePlatformVerified, false);
  assert.ok(Object.isFrozen(result));
  assert.strictEqual((await connector.initialize()).bridge, bridge);
});

test('bridge validation and rejected init are not silently accepted', async () => {
  for (const invalid of [null, {}, [], { send() {} }, { send() {}, subscribe() {} }]) {
    const connector = createVkConnector({ bridgeLoader: async () => invalid });
    await assert.rejects(connector.initialize(), code('BRIDGE_INVALID'));
    assert.equal(connector.getStatus(), 'FAILED');
  }
  const original = new Error('platform refused init');
  const connector = createVkConnector({ bridgeLoader: async () => makeBridge(() => Promise.reject(original)) });
  await assert.rejects(connector.initialize(), error => code('SDK_INIT_FAILED')(error) && error.cause === original);
});

test('loader errors preserve cause; invalid options are rejected early', async () => {
  const root = new Error('missing asset');
  const connector = createVkConnector({ bridgeLoader: async () => { throw root; } });
  await assert.rejects(connector.initialize(), error => code('BRIDGE_LOAD_FAILED')(error) && error.cause === root);
  for (const timeoutMs of [0, -1, NaN, 12.5, Infinity, '5', 120001]) {
    assert.throws(() => createVkConnector({ timeoutMs }), TypeError);
  }
  assert.throws(() => createVkConnector({ bridgeLoader: 4 }), TypeError);
});

test('timeout and destroy prevent delayed SDK init and READY', async () => {
  const loading = deferred(); let initCalls = 0;
  const timeout = createVkConnector({ timeoutMs: 12, bridgeLoader: () => loading.promise });
  await assert.rejects(timeout.initialize(), code('SDK_TIMEOUT'));
  loading.resolve(makeBridge(() => { initCalls++; return {}; }));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(timeout.getStatus(), 'FAILED');
  assert.equal(initCalls, 0);

  const wait = deferred();
  const connector = createVkConnector({ bridgeLoader: () => wait.promise });
  const pending = connector.initialize();
  await connector.destroy();
  await assert.rejects(pending, code('SDK_CANCELLED'));
  wait.resolve(makeBridge(() => { initCalls++; return {}; }));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(initCalls, 0);
  assert.equal(connector.getStatus(), 'DESTROYED');
  await connector.destroy();
  await assert.rejects(connector.initialize(), code('SDK_INIT_FAILED'));
});

test('destroy during VKWebAppInit cannot create late READY', async () => {
  const waiting = deferred();
  const connector = createVkConnector({ bridgeLoader: async () => makeBridge(() => waiting.promise) });
  const pending = connector.initialize();
  // Allow loader to reach send() before cancelling.
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await connector.destroy();
  await assert.rejects(pending, code('SDK_CANCELLED'));
  waiting.resolve({});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(connector.getStatus(), 'DESTROYED');
});

test('capability probes only report advertised support, not real VK tests', async () => {
  const methods = [];
  const bridge = makeBridge();
  bridge.supportsAsync = async method => {
    methods.push(method);
    return method === 'VKWebAppStorageGet' || method === 'VKWebAppShowNativeAds';
  };
  const connector = createVkConnector({ bridgeLoader: async () => bridge });
  await assert.rejects(connector.probeCapabilities(), code('SDK_INIT_FAILED'));
  await connector.initialize();
  const got = await connector.probeCapabilities();
  assert.deepEqual(got, {
    storageRead: 'DECLARED_SUPPORTED',
    storageWrite: 'DECLARED_UNSUPPORTED',
    interstitialAds: 'DECLARED_SUPPORTED',
    checkAds: 'DECLARED_UNSUPPORTED',
  });
  assert.equal(methods.length, 4);
  assert.ok(Object.isFrozen(got));
});

test('capability probing absent, malformed or hung support detection stays UNKNOWN', async () => {
  const noProbe = await probeVkCapabilities(makeBridge());
  assert.ok(Object.values(noProbe).every(value => value === 'UNKNOWN'));
  const hung = makeBridge();
  hung.supportsAsync = () => new Promise(() => {});
  const result = await probeVkCapabilities(hung, { timeoutMs: 12 });
  assert.ok(Object.values(result).every(value => value === 'UNKNOWN'));
  await assert.rejects(probeVkCapabilities(null), TypeError);
  await assert.rejects(probeVkCapabilities(hung, { timeoutMs: 0 }), TypeError);
});
