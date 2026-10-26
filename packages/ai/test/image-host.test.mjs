import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverImageHost } from '../src/image-host.mjs';

const terra = { available: true, transportVerified: true, entitlementVerified: true,
  imageGenCallable: true, routeObserved: 'image-gen', modelObserved: 'gpt-6-terra',
  attestationScope: 'live-execution-context' };
const sol = { ...terra, modelObserved: 'gpt-6-sol' };

test('image host requires one live paired model and callable tool, not an advertised model name', async () => {
  assert.equal((await discoverImageHost(null)).imageTerra.available, false);
  for (const bad of [Object.create(terra), { ...terra, imageGenCallable: false },
    { ...terra, modelObserved: 'gpt-6-sol' }, { ...terra, routeObserved: 'web-dev' },
    { ...terra, attestationScope: 'configured' },
    Object.defineProperty({}, 'available', { get() { throw new Error('accessor'); } }),
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('revoked'); } })]) {
    const result = await discoverImageHost({ probe: async () => ({ terra: bad, sol: null }),
      generate: async () => { throw new Error('unreachable'); } });
    assert.equal(result.imageTerra.available, false);
  }
});

test('host preflight checks Terra and SOL without ever invoking generation', async () => {
  let generates = 0;
  const result = await discoverImageHost({ probe: async () => ({ terra, sol }),
    generate: async () => { generates++; } });
  assert.equal(result.imageTerra.modelObserved, 'gpt-6-terra');
  assert.equal(result.imageSol.modelObserved, 'gpt-6-sol');
  assert.equal(generates, 0);
});

export { terra, sol };
