import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createF6eInventory, verifyTemplateAssetLedger,
  checkF6eInventory, writeF6eInventory } from '../f6e-inventory.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const write = (root, relative, data) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f6e-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'package.json', { name: 'fixture', version: '0.1.0' });
  write(root, 'packages/core/package.json', { name: '@ludory/core', version: '0.1.0', license: 'UNLICENSED' });
  const sri = `sha512-${Buffer.from('cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e', 'hex').toString('base64')}`;
  write(root, 'package-lock.json', { name: 'fixture', version: '0.1.0', lockfileVersion: 3,
    packages: { '': { name: 'fixture', version: '0.1.0' },
      'packages/core': { name: '@ludory/core', version: '0.1.0' },
      'node_modules/@ludory/core': { link: true, resolved: 'packages/core' },
      'node_modules/alpha': { version: '2.0.0', license: 'MIT', integrity: sri } } });

  const vendor = 'packages/ai/vendor/codex-chatgpt-web/';
  write(root, `${vendor}node_modules/example/package.json`,
    { name: 'example', version: '1.0.0', license: 'Apache-2.0' });
  const runtimeFile = fs.readFileSync(path.join(root, vendor, 'node_modules/example/package.json'));
  const runtimeLine = `example/package.json\0${runtimeFile.length}\0${sha(runtimeFile)}\n`;
  const helper = 'module.exports = {};\n';
  write(root, `${vendor}browser-helper.cjs`, helper);
  const files = ['LICENSE', 'LICENSES/test.txt', 'THIRD_PARTY_NOTICES.txt'].map((name, i) => {
    const data = `notice-${i}\n`;
    write(root, `${vendor}${name}`, data);
    return { path: name, bytes: Buffer.byteLength(data), sha256: sha(data) };
  });
  const manifest = { schemaVersion: 1, distribution: 'ludory-vendored-prebuilt',
    artifact: { file: 'browser-helper.cjs', bytes: Buffer.byteLength(helper), sha256: sha(helper) },
    runtime: { nodeModulesDir: 'node_modules',
      tree: { order: 'utf8-byte-lexicographic', files: 1,
        bytes: runtimeFile.length, sha256: sha(runtimeLine) },
      requiredPackages: [{ name: 'example', version: '1.0.0' }] },
    protocol: { kind: 'browser-observation-v2', features: ['browser_observation_v2'] },
    licenses: { upstream: 'LICENSE', thirdPartyNotices: 'THIRD_PARTY_NOTICES.txt',
      sourceLicenseFiles: 'LICENSES/', files } };
  write(root, `${vendor}manifest.json`, manifest);
  const asset = 'packages/studio/catalog/templates/narrative-interactive/assets/example.svg';
  write(root, asset, '<svg/>\n');
  write(root, 'docs/evidence/f6e-template-asset-rights.json', { schemaVersion: 1,
    assets: [{ path: asset, sha256: sha('<svg/>\n'), provenanceStatus: 'UNVERIFIED',
      evidence: null, rightsStatus: 'BLOCKED' }] });
  return { root, vendor, manifest, asset };
}

test('F6e inventories actual lockfile packages and separately vendored Web Helper dependencies', () => {
  const bom = createF6eInventory(repo);
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.5');
  assert.equal(bom.components.filter(x => x.properties?.some(p => p.value === 'npm-lockfile')).length, 86);
  assert.equal(bom.components.filter(x => x.properties?.some(p => p.value === 'workspace')).length, 11);
  assert.equal(bom.components.filter(x => x.properties?.some(p => p.value === 'vendored-web-helper')).length, 6);
  const vendor = bom.components.find(x => x.name === 'playwright-core' &&
    x.properties?.some(p => p.value === 'vendored-web-helper'));
  assert.equal(vendor.version, '1.62.0');
  assert.equal(verifyTemplateAssetLedger(repo).rightsStatus, 'BLOCKED');
});

test('F6e emits the literal SHA-512 lock integrity digest and keeps rights blocked', t => {
  const { root } = fixture(t);
  const bom = createF6eInventory(root);
  const alpha = bom.components.find(x => x.name === 'alpha');
  assert.deepEqual(alpha.hashes, [{ alg: 'SHA-512', content:
    'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e' }]);
  writeF6eInventory(root);
  assert.equal(checkF6eInventory(root).status, 'COMPONENT_INVENTORY_PASS');
  assert.equal(checkF6eInventory(root).rightsStatus, 'BLOCKED');
});

test('F6e fails closed on mismatched or unlisted vendored runtime packages', t => {
  const { root, vendor } = fixture(t);
  write(root, `${vendor}node_modules/example/package.json`,
    { name: 'example', version: '0.9.0', license: 'Apache-2.0' });
  assert.throws(() => createF6eInventory(root), /F6E_VENDOR_PACKAGE_MISMATCH/);
  write(root, `${vendor}node_modules/example/package.json`,
    { name: 'example', version: '1.0.0', license: 'Apache-2.0' });
  write(root, `${vendor}node_modules/unknown/package.json`,
    { name: 'unknown', version: '2.0.0', license: 'MIT' });
  assert.throws(() => createF6eInventory(root), /F6E_VENDOR_UNDECLARED_PACKAGE/);
});

test('F6e rejects new executable bytes in the vendored runtime and modified helper artifact', t => {
  const { root, vendor } = fixture(t);
  write(root, `${vendor}node_modules/example/new-runtime.js`, 'module.exports = 1;\n');
  assert.throws(() => createF6eInventory(root), /F6E_VENDOR_RUNTIME_INTEGRITY/);
  fs.unlinkSync(path.join(root, vendor, 'node_modules/example/new-runtime.js'));
  write(root, `${vendor}browser-helper.cjs`, 'changed-prebuilt');
  assert.throws(() => createF6eInventory(root), /F6E_VENDOR_ARTIFACT_INTEGRITY/);
});

test('F6e rejects tampered or missing vendored license notices', t => {
  const { root, vendor } = fixture(t);
  write(root, `${vendor}THIRD_PARTY_NOTICES.txt`, 'tampered\n');
  assert.throws(() => createF6eInventory(root), /F6E_VENDOR_NOTICE_INTEGRITY/);
  fs.unlinkSync(path.join(root, vendor, 'THIRD_PARTY_NOTICES.txt'));
  assert.throws(() => createF6eInventory(root), /F6E_VENDOR_NOTICE_INTEGRITY/);
});

test('F6e refuses a symlinked vendor notice directory before reading notice bytes', t => {
  const { root, vendor } = fixture(t);
  const original = path.join(root, vendor, 'LICENSES');
  const external = path.join(root, 'outside-notices');
  fs.renameSync(original, external);
  fs.symlinkSync(external, original, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createF6eInventory(root), /F6E_VENDOR_NOTICE_INTEGRITY/);
});

test('F6e rejects a lockfile package that claims a different package name', t => {
  const { root } = fixture(t);
  const file = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  lock.packages['node_modules/alpha'].name = 'other';
  write(root, 'package-lock.json', lock);
  assert.throws(() => createF6eInventory(root), /F6E_LOCK_PACKAGE_INVALID/);
});

test('F6e rejects edited and newly added unlisted template media', t => {
  const { root, asset } = fixture(t);
  write(root, asset, '<svg><rect/></svg>');
  assert.throws(() => verifyTemplateAssetLedger(root), /F6E_ASSET_DIGEST_MISMATCH/);
  write(root, asset, '<svg/>\n');
  write(root, 'packages/studio/catalog/templates/other/assets/extra.svg', '<svg/>');
  assert.throws(() => verifyTemplateAssetLedger(root), /F6E_ASSET_NOT_IN_LEDGER/);
  fs.unlinkSync(path.join(root, 'packages/studio/catalog/templates/other/assets/extra.svg'));
  write(root, 'packages/studio/catalog/templates/other/assets/extra.gif', 'GIF89a');
  assert.throws(() => verifyTemplateAssetLedger(root), /F6E_ASSET_NOT_IN_LEDGER/);
  fs.unlinkSync(path.join(root, 'packages/studio/catalog/templates/other/assets/extra.gif'));
  write(root, 'packages/studio/catalog/templates/other/assets/texture.ktx2', 'image-data');
  assert.throws(() => verifyTemplateAssetLedger(root), /F6E_ASSET_NOT_IN_LEDGER/);
});

test('F6e rejects an invented rights approval and stale committed component inventory', t => {
  const { root } = fixture(t);
  const ledger = 'docs/evidence/f6e-template-asset-rights.json';
  const rights = JSON.parse(fs.readFileSync(path.join(root, ledger)));
  rights.assets[0].rightsStatus = 'PASS';
  write(root, ledger, rights);
  assert.throws(() => verifyTemplateAssetLedger(root), /F6E_RIGHTS_UNVERIFIED/);
  rights.assets[0].rightsStatus = 'BLOCKED';
  write(root, ledger, rights);
  writeF6eInventory(root);
  write(root, 'docs/evidence/f6e-components.cdx.json', '{}\n');
  assert.throws(() => checkF6eInventory(root), /F6E_COMPONENT_INVENTORY_STALE/);
});
