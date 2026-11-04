import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEconomyReadiness } from '../src/economy-readiness.mjs';

test('disabled economy is not applicable and cannot change ordinary release authority', () => {
  const result = assessEconomyReadiness({ target: 'yandex-games', enabled: false });
  assert.equal(result.status, 'NOT_APPLICABLE');
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  assert.deepEqual(result.checks, []);
});

test('Yandex local simulation cannot count as real SKU, cloud, cross-device or payment verification', () => {
  const result = assessEconomyReadiness({ target: 'yandex-games', enabled: true, activeSkus: ['pack_small'],
    simulation: { wallet: true, premium: true, rewards: true, purchases: true } });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  for (const id of ['sdk-catalog', 'portal-currency', 'purchase-restore',
    'cloud-cross-device', 'rewarded-sdk', 'platform-policy']) {
    assert.deepEqual(result.checks.find(row => row.id === id)?.status, 'BLOCKED', id);
  }
  for (const row of result.checks.filter(row => row.provenance === 'LOCAL_SIMULATION')) {
    assert.equal(row.status, 'PASS', `Only local simulation evidence can pass ${row.id}`);
  }
});

test('missing local simulations remain NOT_RUN but never become fabricated PASS', () => {
  const result = assessEconomyReadiness({ target: 'yandex-games', enabled: true });
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.checks.find(row => row.id === 'wallet'),
    { id: 'wallet', status: 'NOT_RUN', provenance: 'LOCAL_SIMULATION', reasonCode: 'SIMULATION_NOT_RUN' });
  assert.equal(result.checks.find(row => row.id === 'cloud-cross-device').status, 'BLOCKED');
});

test('VK never presents native IAP as verified, and explicit SKU activation is an issue', () => {
  const result = assessEconomyReadiness({ target: 'vk-games', enabled: true,
    activeSkus: ['real_sku'] });
  assert.equal(result.status, 'ISSUES_FOUND');
  assert.deepEqual(result.checks.find(row => row.id === 'vk-iap'), {
    id: 'vk-iap', status: 'FAIL', provenance: 'UNSUPPORTED', reasonCode: 'VK_IAP_UNSUPPORTED',
  });
  assert.equal(result.publicationAllowed, false);
});

test('rejects forged portal attestations and invalid evidence shapes without upgrading readiness', () => {
  for (const value of [
    { target: 'unknown', enabled: true },
    { target: 'yandex-games', enabled: 'yes' },
    { target: 'yandex-games', enabled: true, platform: { portalCurrency: 'PASS' } },
    { target: 'yandex-games', enabled: true, simulation: { wallet: 'PASS' } },
    { target: 'vk-games', enabled: true, activeSkus: ['../../bad'] },
  ]) assert.throws(() => assessEconomyReadiness(value), TypeError);
});
