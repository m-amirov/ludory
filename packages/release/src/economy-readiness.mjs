const TARGETS = new Set(['yandex-games', 'vk-games']);
const SIMULATIONS = ['wallet', 'premium', 'rewards', 'purchases'];
const PORTAL_GATES = Object.freeze([
  ['cloud-cross-device', 'CLOUD_CROSS_DEVICE_NOT_OBSERVED'],
  ['rewarded-sdk', 'REWARDED_CALLBACK_NOT_OBSERVED'],
  ['platform-policy', 'LIVE_POLICY_VERIFICATION_REQUIRED'],
]);
const IAP_GATES = Object.freeze([
  ['sdk-catalog', 'SDK_CATALOG_NOT_OBSERVED'],
  ['portal-currency', 'PORTAL_CURRENCY_NOT_OBSERVED'],
  ['purchase-restore', 'CONSUMABLE_RECOVERY_NOT_OBSERVED'],
]);
const row = (id, status, provenance, reasonCode) => Object.freeze({ id, status, provenance, reasonCode });

function fields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}: object required`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError(`${label}: unsupported field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label}: data fields only`);
  }
}

/** Advisory only: simulated findings never grant publication authority. */
export function assessEconomyReadiness(options = {}) {
  fields(options, ['target','enabled','simulation','activeSkus'], 'economy release request');
  const { target, enabled, simulation = {}, activeSkus = [] } = options;
  if (!TARGETS.has(target) || typeof enabled !== 'boolean') throw new TypeError('Valid target and boolean enabled required');
  fields(simulation, SIMULATIONS, 'economy simulation');
  for (const value of Object.values(simulation)) {
    if (typeof value !== 'boolean') throw new TypeError('Only boolean local simulation results accepted');
  }
  if (!Array.isArray(activeSkus) || activeSkus.length > 1024 ||
      activeSkus.some(sku => typeof sku !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sku)) ||
      new Set(activeSkus).size !== activeSkus.length) throw new TypeError('Invalid active SKU list');

  const checks = [];
  if (enabled) {
    for (const id of SIMULATIONS) {
      checks.push(row(id, simulation[id] === true ? 'PASS' : simulation[id] === false ? 'FAIL' : 'NOT_RUN',
        'LOCAL_SIMULATION', simulation[id] === true ? 'LOCAL_SIMULATION_ONLY'
          : simulation[id] === false ? 'SIMULATION_FAILED' : 'SIMULATION_NOT_RUN'));
    }
    for (const [id, reason] of PORTAL_GATES) checks.push(row(id, 'BLOCKED', 'REAL_PLATFORM', reason));
    if (target === 'yandex-games') {
      for (const [id, reason] of IAP_GATES) checks.push(activeSkus.length
        ? row(id, 'BLOCKED', 'REAL_PLATFORM', reason)
        : row(id, 'NOT_APPLICABLE', 'REAL_PLATFORM', 'NO_ACTIVE_PURCHASE_SKUS'));
    } else {
      checks.push(activeSkus.length ? row('vk-iap', 'FAIL', 'UNSUPPORTED', 'VK_IAP_UNSUPPORTED')
        : row('vk-iap', 'NOT_APPLICABLE', 'UNSUPPORTED', 'VK_IAP_DISABLED'));
    }
  }
  const status = !enabled ? 'NOT_APPLICABLE' : checks.some(x => x.status === 'FAIL') ? 'ISSUES_FOUND' : 'BLOCKED';
  return Object.freeze({ schemaVersion: 1, kind: 'economy-moderation-simulation', target, enabled,
    status, checks: Object.freeze(checks), releaseReady: false, publicationAllowed: false,
    actualPlatformReview: 'NOT_RUN', limitations: Object.freeze([
      'LOCAL_SIMULATION_ONLY', 'NO_CROSS_DEVICE_ATOMICITY', 'NO_AUTHORITATIVE_SERVER_LEDGER',
    ]) });
}
