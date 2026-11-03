import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('economy workspace has an exact lockfile record and is included in root gates', () => {
  const manifest = json('package.json');
  const lock = json('package-lock.json');
  assert.match(manifest.scripts.pretest, /packages\/economy\/test\/\*\.test\.mjs/);
  assert.ok(manifest.scripts.precheck.includes('npm run check:economy'));
  for (const name of ['index', 'validate', 'state', 'operations', 'errors']) {
    assert.ok(manifest.scripts['check:economy'].includes(`packages/economy/src/${name}.mjs`));
  }
  assert.deepEqual(lock.packages['packages/economy'].name, '@ludory/economy');
  assert.equal(lock.packages['packages/economy'].version, manifest.version);
  assert.equal(lock.packages['node_modules/@ludory/economy'].resolved, 'packages/economy');
  assert.equal(lock.packages['node_modules/@ludory/economy'].link, true);
});

test('public package resolution exports the E1 entrypoint', async () => {
  const sdk = await import('@ludory/economy');
  for (const key of ['defineEconomy', 'createEconomyState', 'validateEconomyState', 'applyEconomyOperation', 'getPremiumAccess', 'getEconomyView']) {
    assert.equal(typeof sdk[key], 'function');
  }
});

test('pure economy entrypoint bundles for browser targets without Node polyfills', async () => {
  const result = await build({
    entryPoints: [path.join(root, 'packages/economy/src/index.mjs')],
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    write: false, logLevel: 'silent',
  });
  assert.equal(result.errors.length, 0);
  assert.ok(result.outputFiles[0].text.includes('function applyEconomyOperation'));
});

test('runtime-economy workspace is versioned, exposed and covered by root gates', async () => {
  const manifest = json('package.json');
  const lock = json('package-lock.json');
  assert.match(manifest.scripts.pretest, /packages\/runtime-economy\/test\/\*\.test\.mjs/);
  for (const name of ['index','manifest','free-paths','coordinator']) {
    assert.ok(manifest.scripts['check:economy'].includes(`packages/runtime-economy/src/${name}.mjs`));
  }
  assert.equal(lock.packages['packages/runtime-economy'].name, '@ludory/runtime-economy');
  assert.equal(lock.packages['node_modules/@ludory/runtime-economy'].resolved, 'packages/runtime-economy');
  const sdk = await import('@ludory/runtime-economy');
  for (const name of ['definePremiumManifest','verifyFreeNarrativePaths','createEconomyRuntime']) {
    assert.equal(typeof sdk[name], 'function');
  }
});

test('runtime-economy bundles for browser without Node polyfills', async () => {
  const result = await build({
    entryPoints: [path.join(root, 'packages/runtime-economy/src/index.mjs')],
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
  });
  assert.equal(result.errors.length, 0);
  assert.ok(result.outputFiles[0].text.includes('function createEconomyRuntime'));
});
