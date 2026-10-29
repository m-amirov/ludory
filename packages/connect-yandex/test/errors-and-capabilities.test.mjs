import test from 'node:test';
import assert from 'node:assert/strict';
import { YANDEX_CONNECT_ERROR_CODES, YandexConnectError } from '../src/errors.mjs';
import { detectYandexCapabilities } from '../src/capabilities.mjs';

test('Connect errors expose stable codes and preserve original causes', () => {
  const cause = new Error('request timed out');
  const error = new YandexConnectError('SDK_TIMEOUT', { message: 'Yandex SDK timeout', cause });
  assert.equal(error.name, 'YandexConnectError');
  assert.equal(error.code, 'SDK_TIMEOUT');
  assert.equal(error.message, 'Yandex SDK timeout');
  assert.equal(error.cause, cause);
  assert.ok(error instanceof Error);
  assert.equal(YANDEX_CONNECT_ERROR_CODES.SDK_LOAD_FAILED, 'SDK_LOAD_FAILED');
  assert.ok(Object.isFrozen(YANDEX_CONNECT_ERROR_CODES));
  assert.throws(() => new YandexConnectError('UNKNOWN'), TypeError);
});

test('capability detection reports unavailable optional features without guessing', () => {
  const capability = detectYandexCapabilities({ features: {}, adv: {} });
  assert.deepEqual(capability, {
    loading: false, gameplay: false, player: false,
    fullscreenAds: false, rewardedAds: false,
  });
  assert.ok(Object.isFrozen(capability));
  assert.equal(detectYandexCapabilities({ features: { GameplayAPI: { start() {} } } }).gameplay, false);
  assert.equal(detectYandexCapabilities({ getPlayer: true }).player, false);
  assert.throws(() => detectYandexCapabilities(null), TypeError);
  assert.throws(() => detectYandexCapabilities('sdk'), TypeError);
});

test('capability detection maps each supported method independently', () => {
  const sdk = {
    getPlayer() {},
    features: {
      LoadingAPI: { ready() {} },
      GameplayAPI: { start() {}, stop() {} },
    },
    adv: { showFullscreenAdv() {}, showRewardedVideo() {} },
  };
  assert.deepEqual(detectYandexCapabilities(sdk), {
    loading: true, gameplay: true, player: true,
    fullscreenAds: true, rewardedAds: true,
  });
  delete sdk.adv.showRewardedVideo;
  assert.deepEqual(detectYandexCapabilities(sdk), {
    loading: true, gameplay: true, player: true,
    fullscreenAds: true, rewardedAds: false,
  });
});
