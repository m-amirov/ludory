import { YandexConnectError } from './errors.mjs';

const issue = (code, message) => new YandexConnectError(code, { message });
const promised = value => {
  if (!value || typeof value.then !== 'function') throw new TypeError('Yandex payments SDK must return a Promise');
  return value;
};

/** Unsigned *client* SDK port. Strong purchase verification requires an external trusted backend. */
export function createYandexPurchases({ sdk, getPlayer, gameId, lockManager = globalThis.navigator?.locks,
  timeoutMs = 60_000 } = {}) {
  if (!sdk || typeof sdk !== 'object' || typeof getPlayer !== 'function') throw new TypeError('Yandex SDK and Player provider required');
  if (typeof gameId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(gameId)) throw new TypeError('Safe gameId required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new TypeError('Invalid Yandex payment timeout');
  function bounded(promise) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(issue('PURCHASE_FAILED', 'Yandex payment SDK operation timed out')), timeoutMs);
      Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(error); });
    });
  }
  let player, acquisition, payments, paymentPromise;
  async function authorized() {
    if (!acquisition && !player) acquisition = Promise.resolve().then(() => getPlayer()).then(candidate => {
      if (typeof candidate?.isAuthorized !== 'function') throw new TypeError('Yandex Player identity unavailable');
      player = candidate;
      return candidate;
    }).finally(() => { acquisition = null; });
    try {
      const current = player ?? await bounded(acquisition);
      if (current.isAuthorized() !== true) throw new TypeError('Yandex Player login required for IAP');
      return current;
    } catch { player = null; acquisition = null; payments = null; throw issue('PURCHASE_UNAVAILABLE', 'Authorized Yandex Player required'); }
  }
  async function getPayments() {
    await authorized();
    if (payments) return payments;
    if (!paymentPromise) paymentPromise = Promise.resolve().then(async () => {
      // Do not pass signed:true: server-side signature verification is not implemented.
      const candidate = typeof sdk.getPayments === 'function' ? await promised(sdk.getPayments()) : sdk.payments;
      if (!candidate || ['getCatalog', 'getPurchases', 'purchase', 'consumePurchase']
        .some(name => typeof candidate[name] !== 'function')) throw new TypeError('Incomplete Yandex Payments API');
      payments = candidate;
      return candidate;
    }).finally(() => { paymentPromise = null; });
    try { return await bounded(paymentPromise); }
    catch { paymentPromise = null; throw issue('PURCHASE_UNAVAILABLE', 'Yandex Purchases capability unavailable'); }
  }
  async function invoke(method, ...args) {
    const api = await getPayments();
    try { return await bounded(promised(api[method](...args))); }
    catch { throw issue('PURCHASE_FAILED', `Yandex ${method} operation failed`); }
  }
  return Object.freeze({
    async getCatalog() {
      const raw = await invoke('getCatalog');
      try {
        if (!Array.isArray(raw)) throw new TypeError('Catalog must be an array');
        const seen = new Set(), available = [];
        for (const product of raw) {
          try {
            if (!product || typeof product.id !== 'string' || seen.has(product.id) ||
                !/^[a-z][a-z0-9_-]{0,63}$/.test(product.id) ||
                typeof product.title !== 'string' || !product.title ||
                typeof product.price !== 'string' || !product.price ||
                !(typeof product.priceValue === 'number' ? Number.isFinite(product.priceValue) && product.priceValue >= 0
                  : typeof product.priceValue === 'string' && /^\d+(?:[.,]\d+)?$/.test(product.priceValue)) ||
                typeof product.priceCurrencyCode !== 'string' || !product.priceCurrencyCode ||
                typeof product.getPriceCurrencyImage !== 'function') throw new TypeError('Incomplete product metadata');
            const currencyImage = product.getPriceCurrencyImage('small');
            if (typeof currencyImage !== 'string' || !currencyImage) throw new TypeError('Missing SDK currency icon');
            seen.add(product.id);
            available.push(Object.freeze({
              id: product.id, title: product.title,
              description: typeof product.description === 'string' ? product.description : '',
              imageURI: typeof product.imageURI === 'string' ? product.imageURI : '',
              price: product.price, priceValue: product.priceValue,
              priceCurrencyCode: product.priceCurrencyCode, priceCurrencyImage: currencyImage,
            }));
          } catch { /* Ignore unrelated malformed SKUs; they cannot enter the active allowlist. */ }
        }
        if (raw.length > 0 && available.length === 0) throw new TypeError('No usable catalog entries');
        return Object.freeze(available);
      } catch { throw issue('PURCHASE_FAILED', 'Yandex catalog metadata cannot be trusted'); }
    },
    async getPurchases() {
      const list = await invoke('getPurchases');
      if (!Array.isArray(list)) throw issue('PURCHASE_FAILED', 'Yandex outstanding purchases response invalid');
      return list;
    },
    purchase(id) {
      if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(id)) {
        return Promise.reject(issue('PURCHASE_FAILED', 'Invalid product ID'));
      }
      return invoke('purchase', { id });
    },
    consumePurchase(token) {
      if (typeof token !== 'string' || !token) return Promise.reject(issue('PURCHASE_FAILED', 'Invalid purchase token'));
      return invoke('consumePurchase', token);
    },
    async runExclusive(action) {
      if (typeof action !== 'function' || typeof lockManager?.request !== 'function') {
        throw issue('PURCHASE_UNAVAILABLE', 'Web Locks required for same-origin payment exclusion');
      }
      return lockManager.request(`ludory-${gameId}-iap`, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) throw issue('PURCHASE_UNAVAILABLE', 'Another tab is processing purchases');
        return action();
      });
    },
  });
}
