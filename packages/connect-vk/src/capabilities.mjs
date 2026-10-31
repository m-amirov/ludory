const METHODS = Object.freeze({
  storageRead: 'VKWebAppStorageGet',
  storageWrite: 'VKWebAppStorageSet',
  interstitialAds: 'VKWebAppShowNativeAds',
  checkAds: 'VKWebAppCheckNativeAds',
});

/** Advertised VK Bridge method support, never proof of actual storage, ads or device behavior. */
export async function probeVkCapabilities(bridge, { timeoutMs = 1500 } = {}) {
  if (!bridge || typeof bridge !== 'object' || Array.isArray(bridge)) throw new TypeError('bridge must be an object');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError('timeoutMs must be an integer between 1 and 30000');
  }
  let supports;
  try { supports = bridge.supportsAsync; }
  catch { supports = null; }
  const entries = await Promise.all(Object.entries(METHODS).map(async ([key, method]) => {
    if (typeof supports !== 'function') return [key, 'UNKNOWN'];
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => supports.call(bridge, method)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PROBE_TIMEOUT')), timeoutMs); }),
      ]);
      return [key, value === true ? 'DECLARED_SUPPORTED' : value === false ? 'DECLARED_UNSUPPORTED' : 'UNKNOWN'];
    } catch {
      return [key, 'UNKNOWN'];
    } finally { clearTimeout(timer); }
  }));
  return Object.freeze(Object.fromEntries(entries));
}
