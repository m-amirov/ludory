import test from 'node:test';
import assert from 'node:assert/strict';
import { loadYandexSdkScript } from '../src/sdk-loader.mjs';

function fakeDocument() {
  const children = [];
  const scripts = [];
  return {
    children, scripts,
    createElement(name) {
      assert.equal(name, 'script');
      const events = new Map();
      const script = {
        src: '',
        async: false,
        events,
        addEventListener(type, handler) { events.set(type, handler); },
        removeEventListener(type, handler) {
          if (events.get(type) === handler) events.delete(type);
        },
        dispatch(type) { events.get(type)?.(); },
        remove() {
          const index = children.indexOf(script);
          if (index >= 0) children.splice(index, 1);
        },
      };
      scripts.push(script);
      return script;
    },
    head: {
      appendChild(script) { children.push(script); },
    },
  };
}

function assertYandexError(code) {
  return error => error?.name === 'YandexConnectError' && error.code === code;
}

test('preloaded SDK is returned without creating any script', async () => {
  const factory = { init: async () => ({}) };
  const documentObject = fakeDocument();
  assert.equal(await loadYandexSdkScript({ documentObject, globalObject: { YaGames: factory } }), factory);
  assert.equal(documentObject.scripts.length, 0);
});

test('official SDK path loads before YaGames factory is returned', async () => {
  const documentObject = fakeDocument();
  const globalObject = {};
  const pending = loadYandexSdkScript({ documentObject, globalObject });
  const [script] = documentObject.scripts;
  assert.equal(script.src, '/sdk.js');
  assert.equal(script.async, true);
  const factory = { init: async () => ({}) };
  globalObject.YaGames = factory;
  script.dispatch('load');
  assert.equal(await pending, factory);
  assert.equal(documentObject.children.length, 1);
  assert.equal(script.events.size, 0);
});

test('network failure removes injected script and listeners', async () => {
  const documentObject = fakeDocument();
  const pending = loadYandexSdkScript({ documentObject, globalObject: {} });
  const [script] = documentObject.scripts;
  script.dispatch('error');
  await assert.rejects(pending, assertYandexError('SDK_LOAD_FAILED'));
  assert.deepEqual(documentObject.children, []);
  assert.equal(script.events.size, 0);
});

test('successful script event without YaGames.init is not initialization success', async () => {
  const documentObject = fakeDocument();
  const pending = loadYandexSdkScript({ documentObject, globalObject: { YaGames: {} } });
  const [script] = documentObject.scripts;
  script.dispatch('load');
  await assert.rejects(pending, assertYandexError('SDK_UNAVAILABLE'));
  assert.equal(documentObject.children.length, 0);
  assert.equal(script.events.size, 0);
});

test('throwing DOM listener cleanup never prevents SDK load failure from settling', async () => {
  for (const event of ['load', 'error']) {
    const documentObject = fakeDocument();
    const pending = loadYandexSdkScript({ documentObject, globalObject: {} });
    const [script] = documentObject.scripts;
    script.removeEventListener = () => { throw new Error('restricted DOM cleanup'); };
    assert.doesNotThrow(() => script.dispatch(event));
    await assert.rejects(pending, assertYandexError(event === 'load' ? 'SDK_UNAVAILABLE' : 'SDK_LOAD_FAILED'));
    assert.equal(documentObject.children.length, 0);
  }
});

test('a cleanup exception after successful SDK script load cannot leave the promise pending', async () => {
  const documentObject = fakeDocument();
  const factory = { init: async () => ({}) };
  const globalObject = {};
  const pending = loadYandexSdkScript({ documentObject, globalObject });
  const [script] = documentObject.scripts;
  script.removeEventListener = () => { throw new Error('restricted DOM cleanup'); };
  globalObject.YaGames = factory;
  assert.doesNotThrow(() => script.dispatch('load'));
  assert.equal(await pending, factory);
});

test('abort before or during SDK loading never leaves a script', async () => {
  const doc = fakeDocument();
  const controller = new AbortController();
  const pending = loadYandexSdkScript({ documentObject: doc, globalObject: {}, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, assertYandexError('SDK_LOAD_FAILED'));
  assert.equal(doc.children.length, 0);
  assert.equal(doc.scripts[0].events.size, 0);

  const aborted = new AbortController();
  aborted.abort();
  const before = fakeDocument();
  await assert.rejects(loadYandexSdkScript({ documentObject: before, globalObject: {}, signal: aborted.signal }),
    assertYandexError('SDK_LOAD_FAILED'));
  assert.equal(before.scripts.length, 0);
});

test('invalid SDK URL, missing DOM and denied global access fail explicitly', async () => {
  for (const scriptUrl of ['http://example.com/sdk.js', '//example.com/sdk.js', 'data:text/javascript,1']) {
    await assert.rejects(loadYandexSdkScript({ scriptUrl, documentObject: fakeDocument(), globalObject: {} }), TypeError);
  }
  const doc = fakeDocument();
  const globalObject = {};
  assert.equal(await import('../src/sdk-loader.mjs').then(module => module.loadYandexSdkScript), loadYandexSdkScript);
  await assert.rejects(loadYandexSdkScript({ documentObject: null, globalObject }),
    assertYandexError('SDK_UNAVAILABLE'));
  await assert.rejects(loadYandexSdkScript({ documentObject: doc,
    globalObject: new Proxy({}, { get() { throw new Error('blocked'); } }) }),
    assertYandexError('SDK_UNAVAILABLE'));
  assert.equal(doc.children.length, 0);
});
