/** The flags indicate SDK method availability, not observed platform behavior. */
export function detectYandexCapabilities(ysdk) {
  if (!ysdk || typeof ysdk !== 'object' || Array.isArray(ysdk)) {
    throw new TypeError('Initialized Yandex SDK must be an object');
  }
  const loading = ysdk.features?.LoadingAPI;
  const gameplay = ysdk.features?.GameplayAPI;
  const ads = ysdk.adv;
  return Object.freeze({
    loading: typeof loading?.ready === 'function',
    gameplay: typeof gameplay?.start === 'function' && typeof gameplay?.stop === 'function',
    player: typeof ysdk.getPlayer === 'function',
    fullscreenAds: typeof ads?.showFullscreenAdv === 'function',
    rewardedAds: typeof ads?.showRewardedVideo === 'function',
  });
}
