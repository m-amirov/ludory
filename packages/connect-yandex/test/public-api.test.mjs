import test from 'node:test';
import assert from 'node:assert/strict';

test('public workspace import is side-effect-free and exposes the C1/C2/C3 API', async () => {
  let inits = 0;
  const original = globalThis.YaGames;
  globalThis.YaGames = { init() { inits++; return {}; } };
  try {
    const exports = await import('@ludory/connect-yandex');
    assert.deepEqual(Object.keys(exports).sort(), [
      'YANDEX_CONNECT_ERROR_CODES', 'YandexConnectError', 'createYandexConnector',
      'createYandexLifecycle', 'createYandexPlayerStorage',
      'detectYandexCapabilities', 'loadYandexSdkScript',
    ].sort());
    assert.equal(inits, 0);
    assert.equal(typeof exports.createYandexConnector, 'function');
    assert.equal(typeof exports.createYandexPlayerStorage, 'function');
    const connector = exports.createYandexConnector({ sdkLoader: async () => ({ init: async () => ({}) }) });
    const connection = await connector.initialize();
    assert.equal(connector.getStatus(), 'READY');
    assert.equal(connection.capabilities.player, false);
    assert.equal(inits, 0);
  } finally {
    if (original === undefined) delete globalThis.YaGames;
    else globalThis.YaGames = original;
  }
});
