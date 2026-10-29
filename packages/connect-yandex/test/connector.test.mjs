import test from 'node:test';
import assert from 'node:assert/strict';
import { createYandexConnector } from '../src/connector.mjs';
import { YandexConnectError } from '../src/errors.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function errorCode(code) {
  return error => error instanceof YandexConnectError && error.code === code;
}

test('connector performs one SDK initialization for simultaneous callers', async () => {
  const pending = deferred();
  const initOptions = { signed: false };
  const sdk = { features: { LoadingAPI: { ready() {} } }, adv: {} };
  let loads = 0;
  let inits = 0;
  const connector = createYandexConnector({ initOptions, sdkLoader: ({ signal }) => {
    loads++;
    assert.ok(signal instanceof AbortSignal);
    return pending.promise;
  } });
  assert.equal(connector.getStatus(), 'IDLE');
  const first = connector.initialize();
  const second = connector.initialize();
  assert.strictEqual(first, second);
  assert.equal(connector.getStatus(), 'LOADING');
  pending.resolve({ init: async options => {
    inits++;
    assert.strictEqual(options, initOptions);
    return sdk;
  } });
  const connection = await first;
  assert.equal(loads, 1);
  assert.equal(inits, 1);
  assert.equal(connector.getStatus(), 'READY');
  assert.strictEqual(connection.sdk, sdk);
  assert.deepEqual(connection.capabilities, {
    loading: true, gameplay: false, player: false,
    fullscreenAds: false, rewardedAds: false,
  });
  assert.ok(Object.isFrozen(connection));
  assert.strictEqual(await connector.initialize(), connection);
});

test('omitted initOptions calls SDK init without an argument', async () => {
  let args;
  const connector = createYandexConnector({ sdkLoader: async () => ({ init(...values) {
    args = values;
    return { adv: {} };
  } }) });
  await connector.initialize();
  assert.deepEqual(args, []);
});

test('SDK loader and init errors expose stable distinct failures', async () => {
  const network = new Error('DNS failure');
  const loaded = createYandexConnector({ sdkLoader: async () => { throw network; } });
  await assert.rejects(loaded.initialize(), error => errorCode('SDK_LOAD_FAILED')(error) && error.cause === network);
  assert.equal(loaded.getStatus(), 'FAILED');
  await assert.rejects(loaded.initialize(), errorCode('SDK_INIT_FAILED'));

  const original = new YandexConnectError('SDK_UNAVAILABLE', { message: 'missing' });
  const absent = createYandexConnector({ sdkLoader: async () => { throw original; } });
  await assert.rejects(absent.initialize(), error => error === original);

  const cause = new Error('invalid init');
  const rejected = createYandexConnector({ sdkLoader: async () => ({ init: async () => { throw cause; } }) });
  await assert.rejects(rejected.initialize(), error => errorCode('SDK_INIT_FAILED')(error) && error.cause === cause);
  assert.equal(rejected.getStatus(), 'FAILED');
});

test('malformed SDK factories and initialized values never reach READY', async () => {
  for (const badFactory of [null, {}, { init: 1 }]) {
    const connector = createYandexConnector({ sdkLoader: async () => badFactory });
    await assert.rejects(connector.initialize(), errorCode('SDK_INIT_FAILED'));
    assert.equal(connector.getStatus(), 'FAILED');
  }
  for (const badResult of [null, false, 5, 'sdk', []]) {
    const connector = createYandexConnector({ sdkLoader: async () => ({ init: async () => badResult }) });
    await assert.rejects(connector.initialize(), errorCode('SDK_INIT_FAILED'));
    assert.equal(connector.getStatus(), 'FAILED');
  }
});

test('deadline bounds loader and SDK initialization, not only the script event', async () => {
  const never = new Promise(() => {});
  const loader = createYandexConnector({ timeoutMs: 20, sdkLoader: () => never });
  await assert.rejects(loader.initialize(), errorCode('SDK_TIMEOUT'));
  assert.equal(loader.getStatus(), 'FAILED');
  const init = createYandexConnector({ timeoutMs: 20,
    sdkLoader: async () => ({ init: () => never }) });
  await assert.rejects(init.initialize(), errorCode('SDK_TIMEOUT'));
  assert.equal(init.getStatus(), 'FAILED');
});

test('destroy cancels a pending load immediately and ignores late completion', async () => {
  const pending = deferred();
  const connector = createYandexConnector({ sdkLoader: () => pending.promise });
  const initializing = connector.initialize();
  await connector.destroy();
  assert.equal(connector.getStatus(), 'DESTROYED');
  await assert.rejects(initializing, errorCode('SDK_LOAD_FAILED'));
  pending.resolve({ init: async () => ({}) });
  await Promise.resolve();
  assert.equal(connector.getStatus(), 'DESTROYED');
  await connector.destroy();
  await assert.rejects(connector.initialize(), errorCode('SDK_INIT_FAILED'));
});

test('late SDK script resolution after destroy cannot start YaGames.init', async () => {
  const pending = deferred();
  let initCalls = 0;
  const connector = createYandexConnector({ sdkLoader: () => pending.promise });
  const initializing = connector.initialize();
  await connector.destroy();
  await assert.rejects(initializing, errorCode('SDK_LOAD_FAILED'));
  pending.resolve({ init() { initCalls++; return {}; } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(initCalls, 0);
  assert.equal(connector.getStatus(), 'DESTROYED');
});

test('late SDK script resolution after timeout cannot start YaGames.init', async () => {
  const pending = deferred();
  let initCalls = 0;
  const connector = createYandexConnector({ timeoutMs: 10, sdkLoader: () => pending.promise });
  await assert.rejects(connector.initialize(), errorCode('SDK_TIMEOUT'));
  pending.resolve({ init() { initCalls++; return {}; } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(initCalls, 0);
  assert.equal(connector.getStatus(), 'FAILED');
});

test('destroy during a pending SDK init cannot emit late READY', async () => {
  const pending = deferred();
  const enteredInit = deferred();
  const connector = createYandexConnector({ sdkLoader: async () => ({ init: () => {
    enteredInit.resolve();
    return pending.promise;
  } }) });
  const initializing = connector.initialize();
  await enteredInit.promise;
  await connector.destroy();
  await assert.rejects(initializing, errorCode('SDK_LOAD_FAILED'));
  pending.resolve({ getPlayer() {} });
  await Promise.resolve();
  assert.equal(connector.getStatus(), 'DESTROYED');
});

test('throwing YaGames.init accessor is wrapped with its original cause', async () => {
  const cause = new Error('SDK getter denied');
  const factory = Object.defineProperty({}, 'init', { get() { throw cause; } });
  const connector = createYandexConnector({ sdkLoader: async () => factory });
  await assert.rejects(connector.initialize(), error =>
    errorCode('SDK_INIT_FAILED')(error) && error.cause === cause);
  assert.equal(connector.getStatus(), 'FAILED');
});

test('destroy before initialize and after READY is idempotent and does not mutate SDK', async () => {
  const before = createYandexConnector({ sdkLoader: async () => ({ init: async () => ({}) }) });
  await before.destroy();
  assert.equal(before.getStatus(), 'DESTROYED');
  await assert.rejects(before.initialize(), errorCode('SDK_INIT_FAILED'));

  const sdk = { adv: {} };
  const ready = createYandexConnector({ sdkLoader: async () => ({ init: async () => sdk }) });
  await ready.initialize();
  await ready.destroy();
  await ready.destroy();
  assert.equal(ready.getStatus(), 'DESTROYED');
  assert.deepEqual(sdk, { adv: {} });
});

test('connector rejects invalid config and timeout values before loading', () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, '100']) {
    assert.throws(() => createYandexConnector({ timeoutMs }), TypeError);
  }
  assert.throws(() => createYandexConnector({ sdkLoader: 12 }), TypeError);
  assert.throws(() => createYandexConnector(null), TypeError);
});
