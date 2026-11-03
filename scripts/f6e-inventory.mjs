import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyHelperArtifact } from '../packages/ai/src/helper-supply.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const vendorRelative = 'packages/ai/vendor/codex-chatgpt-web';
const ledgerRelative = 'docs/evidence/f6e-template-asset-rights.json';
const bomRelative = 'docs/evidence/f6e-components.cdx.json';
const templateRelative = 'packages/studio/catalog/templates';
const mediaExtensions = new Set([
  '.svg', '.png', '.apng', '.gif', '.jpg', '.jpeg', '.webp', '.avif', '.bmp', '.ico', '.heic', '.heif',
  '.ogg', '.mp3', '.wav', '.flac', '.m4a', '.aac',
  '.mp4', '.webm', '.mov', '.glb', '.gltf', '.obj', '.fbx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);
const bundledCodeExtensions = new Set(['.js', '.mjs', '.cjs']);
const packageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function assertRegular(file, reason) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { throw new Error(reason); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(reason);
}

function noticePaths(root, manifest) {
  const notices = manifest.licenses?.files;
  if (!Array.isArray(notices) || !notices.length) throw new Error('F6E_VENDOR_NOTICE_INTEGRITY');
  const names = new Set();
  const licenseRoot = path.join(root, vendorRelative);
  const directory = path.join(licenseRoot, 'LICENSES');
  let directoryStat;
  try { directoryStat = fs.lstatSync(directory); } catch { throw new Error('F6E_VENDOR_NOTICE_INTEGRITY'); }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('F6E_VENDOR_NOTICE_INTEGRITY');
  }
  for (const item of notices) {
    const name = item?.path;
    if (typeof name !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(name) ||
      name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.') ||
      names.has(name) || !Number.isSafeInteger(item.bytes) ||
      !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('F6E_VENDOR_NOTICE_INTEGRITY');
    names.add(name);
    const file = path.join(licenseRoot, ...name.split('/'));
    assertRegular(file, 'F6E_VENDOR_NOTICE_INTEGRITY');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) {
      throw new Error(`F6E_VENDOR_NOTICE_INTEGRITY: ${name}`);
    }
  }
  if (!names.has('LICENSE') || !names.has('THIRD_PARTY_NOTICES.txt') ||
    ![...names].some(name => name.startsWith('LICENSES/'))) {
    throw new Error('F6E_VENDOR_NOTICE_INTEGRITY');
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !names.has(`LICENSES/${entry.name}`)) {
      throw new Error(`F6E_VENDOR_NOTICE_INTEGRITY: unexpected LICENSES/${entry.name}`);
    }
  }
}

function component(name, version, license, source, id, hashes = undefined) {
  const scoped = name.startsWith('@');
  const parts = scoped ? name.split('/') : [name];
  const qualified = parts.map(encodeURIComponent).join('/');
  const result = { type: 'library', 'bom-ref': `${source}:${id}`, name, version,
    purl: `pkg:npm/${qualified}@${encodeURIComponent(version)}`,
    properties: [{ name: 'ludory:source', value: source }] };
  if (license) result.licenses = [{ license: { name: license } }];
  if (hashes) result.hashes = hashes;
  return result;
}

function nameFromLockPath(key) {
  const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (!packageNamePattern.test(name)) throw new Error(`F6E_LOCK_PACKAGE_INVALID: ${key}`);
  return name;
}

function sriHash(integrity, key) {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity ?? '');
  if (!match) throw new Error(`F6E_LOCK_INTEGRITY_INVALID: ${key}`);
  const raw = Buffer.from(match[1], 'base64');
  if (raw.length !== 64 || raw.toString('base64') !== match[1]) {
    throw new Error(`F6E_LOCK_INTEGRITY_INVALID: ${key}`);
  }
  return [{ alg: 'SHA-512', content: raw.toString('hex') }];
}

function vendorPackageNames(nodeModules) {
  const names = [];
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(path.join(nodeModules, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) names.push(`${entry.name}/${scoped.name}`);
      }
    } else names.push(entry.name);
  }
  return names.sort();
}

/** Lock-declared packages (all platforms) plus separately vendored runtime components. */
export function createF6eInventory(rootDir) {
  const root = path.resolve(rootDir);
  const project = readJson(path.join(root, 'package.json'));
  const lock = readJson(path.join(root, 'package-lock.json'));
  const vendor = path.join(root, vendorRelative);
  const manifest = readJson(path.join(vendor, 'manifest.json'));
  noticePaths(root, manifest);
  const components = [];
  for (const [relative, entry] of Object.entries(lock.packages ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (relative.startsWith('node_modules/') && !entry.link) {
      const expectedName = nameFromLockPath(relative);
      const name = entry.name ?? expectedName;
      if (name !== expectedName || !packageNamePattern.test(name) || !entry.version) {
        throw new Error(`F6E_LOCK_PACKAGE_INVALID: ${relative}`);
      }
      components.push(component(name, entry.version, entry.license, 'npm-lockfile', relative,
        sriHash(entry.integrity, relative)));
    } else if (relative.startsWith('packages/')) {
      const file = path.join(root, relative, 'package.json');
      assertRegular(file, `F6E_WORKSPACE_INVALID: ${relative}`);
      const pkg = readJson(file);
      if (pkg.version !== entry.version || pkg.name !== entry.name || !packageNamePattern.test(pkg.name)) {
        throw new Error(`F6E_WORKSPACE_INVALID: ${relative}`);
      }
      components.push(component(pkg.name, pkg.version, pkg.license, 'workspace', relative));
    }
  }
  const required = manifest.runtime?.requiredPackages;
  if (!Array.isArray(required) || !required.length) throw new Error('F6E_VENDOR_MANIFEST_INVALID');
  const byName = new Map();
  for (const entry of required) {
    if (!packageNamePattern.test(entry?.name ?? '') || typeof entry.version !== 'string' || byName.has(entry.name)) {
      throw new Error('F6E_VENDOR_MANIFEST_INVALID');
    }
    byName.set(entry.name, entry.version);
  }
  const modules = path.join(vendor, 'node_modules');
  const actualNames = vendorPackageNames(modules);
  for (const name of actualNames) {
    if (!byName.has(name)) throw new Error(`F6E_VENDOR_UNDECLARED_PACKAGE: ${name}`);
  }
  for (const [name, version] of [...byName.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const file = path.join(modules, ...name.split('/'), 'package.json');
    assertRegular(file, `F6E_VENDOR_PACKAGE_MISMATCH: ${name}`);
    const pkg = readJson(file);
    if (pkg.name !== name || pkg.version !== version || !actualNames.includes(name)) {
      throw new Error(`F6E_VENDOR_PACKAGE_MISMATCH: ${name}`);
    }
    components.push(component(name, pkg.version, pkg.license, 'vendored-web-helper', name));
  }
  // Reuse the AI helper's canonical SHA-bound artifact and complete 2,217-file
  // runtime-tree verifier. Package names alone would miss changed executable JS.
  try {
    verifyHelperArtifact({ scriptFile: path.join(vendor, 'browser-helper.cjs'),
      manifestFile: path.join(vendor, 'manifest.json'), checkRuntime: true });
  } catch (error) {
    const code = error?.code;
    if (code === 'DEV_HELPER_RUNTIME_INTEGRITY' || code === 'DEV_HELPER_RUNTIME_UNAVAILABLE') {
      throw new Error(`F6E_VENDOR_RUNTIME_INTEGRITY: ${code}`);
    }
    if (code === 'DEV_HELPER_HASH_MISMATCH' || code === 'DEV_HELPER_ARTIFACT_UNTRUSTED') {
      throw new Error(`F6E_VENDOR_ARTIFACT_INTEGRITY: ${code}`);
    }
    if (code === 'DEV_HELPER_NOTICES_INTEGRITY') {
      throw new Error(`F6E_VENDOR_NOTICE_INTEGRITY: ${code}`);
    }
    if (code === 'DEV_HELPER_MANIFEST_INVALID' || code === 'DEV_HELPER_MANIFEST_MISSING') {
      throw new Error(`F6E_VENDOR_MANIFEST_INVALID: ${code}`);
    }
    throw error;
  }
  return { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: { component: { type: 'application', name: project.name, version: project.version } },
    components };
}

function discoverTemplateAssets(root) {
  const base = path.join(root, templateRelative);
  const files = [];
  function visit(directory, relative) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const extension = path.extname(entry.name).toLowerCase();
      const underAssets = relative.split('/').includes('assets');
      if (entry.isSymbolicLink()) throw new Error(`F6E_ASSET_SYMLINK: ${next}`);
      if (entry.isDirectory()) visit(absolute, next);
      else if (mediaExtensions.has(extension) || (underAssets && !bundledCodeExtensions.has(extension))) {
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`F6E_ASSET_NOT_REGULAR: ${next}`);
        files.push(`${templateRelative}/${next}`);
      }
    }
  }
  visit(base, '');
  return files.sort();
}

/** Technical byte-identity PASS never authorizes rights clearance. */
export function verifyTemplateAssetLedger(rootDir) {
  const root = path.resolve(rootDir);
  const ledger = readJson(path.join(root, ledgerRelative));
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.assets)) throw new Error('F6E_ASSET_LEDGER_INVALID');
  const listed = new Map();
  for (const entry of ledger.assets) {
    if (entry.provenanceStatus !== 'UNVERIFIED' || entry.rightsStatus !== 'BLOCKED' || entry.evidence !== null) {
      throw new Error(`F6E_RIGHTS_UNVERIFIED: ${entry.path}`);
    }
    if (typeof entry.path !== 'string' || !entry.path.startsWith(`${templateRelative}/`) ||
      entry.path.split('/').includes('..') || listed.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('F6E_ASSET_LEDGER_INVALID');
    }
    listed.set(entry.path, entry.sha256);
  }
  const found = discoverTemplateAssets(root);
  for (const relative of found) {
    if (!listed.has(relative)) throw new Error(`F6E_ASSET_NOT_IN_LEDGER: ${relative}`);
    if (sha256(fs.readFileSync(path.join(root, relative))) !== listed.get(relative)) {
      throw new Error(`F6E_ASSET_DIGEST_MISMATCH: ${relative}`);
    }
  }
  for (const relative of listed.keys()) {
    if (!found.includes(relative)) throw new Error(`F6E_ASSET_MISSING: ${relative}`);
  }
  return { integrityStatus: 'PASS', rightsStatus: 'BLOCKED', assetCount: found.length };
}

const render = data => `${JSON.stringify(data, null, 2)}\n`;

export function writeF6eInventory(rootDir) {
  const root = path.resolve(rootDir);
  verifyTemplateAssetLedger(root);
  const bytes = render(createF6eInventory(root));
  fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, bomRelative), bytes);
  return { status: 'COMPONENT_INVENTORY_WRITTEN', rightsStatus: 'BLOCKED' };
}

export function checkF6eInventory(rootDir) {
  const root = path.resolve(rootDir);
  const assets = verifyTemplateAssetLedger(root);
  const actual = render(createF6eInventory(root));
  const file = path.join(root, bomRelative);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== actual) {
    throw new Error('F6E_COMPONENT_INVENTORY_STALE');
  }
  return { status: 'COMPONENT_INVENTORY_PASS', rightsStatus: assets.rightsStatus,
    advisories: 'NOT_RUN', componentCount: JSON.parse(actual).components.length,
    assetCount: assets.assetCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const result = command === '--check' ? checkF6eInventory(root)
      : command === '--write' ? writeF6eInventory(root) : null;
    if (!result) throw new Error('USAGE: node scripts/f6e-inventory.mjs --check|--write');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
