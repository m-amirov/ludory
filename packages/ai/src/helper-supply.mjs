import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalPhysicalDirectory } from '@ludory/core';

const MAX_MANIFEST_BYTES = 128 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const VENDORED_ROOT = path.resolve(fileURLToPath(new URL('../vendor/codex-chatgpt-web/', import.meta.url)));
const VENDORED_HELPER = path.join(VENDORED_ROOT, 'browser-helper.cjs');
const VENDORED_MANIFEST = path.join(VENDORED_ROOT, 'manifest.json');
const VENDORED_RUNTIME_NODE_MODULES = path.join(VENDORED_ROOT, 'node_modules');
const HELPER_MANIFEST_NAME = 'browser-helper.manifest.json';

export const HELPER_INTEGRITY_CODES = new Set([
  'DEV_HELPER_MANIFEST_MISSING',
  'DEV_HELPER_MANIFEST_INVALID',
  'DEV_HELPER_HASH_MISMATCH',
  'DEV_HELPER_ARTIFACT_UNTRUSTED',
  'DEV_HELPER_RUNTIME_UNAVAILABLE',
  'DEV_HELPER_RUNTIME_INTEGRITY',
  'DEV_HELPER_PROTOCOL_UNSUPPORTED',
]);

const errorWithCode = code => Object.assign(new Error(code), { code });

function pathExists(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function regularFile(file, missingCode = 'DEV_HELPER_ARTIFACT_UNTRUSTED') {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') throw errorWithCode(missingCode);
    throw errorWithCode('DEV_HELPER_ARTIFACT_UNTRUSTED');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw errorWithCode('DEV_HELPER_ARTIFACT_UNTRUSTED');
  return fs.realpathSync.native(file);
}

function readJson(file, missingCode) {
  const real = regularFile(file, missingCode);
  if (fs.statSync(real).size > MAX_MANIFEST_BYTES) throw errorWithCode('DEV_HELPER_MANIFEST_INVALID');
  try {
    const value = JSON.parse(fs.readFileSync(real, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not-object');
    return value;
  } catch { throw errorWithCode('DEV_HELPER_MANIFEST_INVALID'); }
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
  }
  return value;
}

function digestJson(value) {
  return createHash('sha256').update(JSON.stringify(stableJson(value))).digest('hex');
}

function validateManifest(manifest, artifactFile) {
  const artifact = manifest.artifact;
  const protocol = manifest.protocol;
  const requiredPackages = manifest.runtime?.requiredPackages;
  const runtimeTree = manifest.runtime?.tree;
  if (manifest.schemaVersion !== 1 || typeof manifest.distribution !== 'string' ||
      !artifact || typeof artifact !== 'object' || Array.isArray(artifact) ||
      artifact.file !== path.basename(artifactFile) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 ||
      typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256) ||
      !protocol || typeof protocol !== 'object' || Array.isArray(protocol) ||
      !['compatibility-v1', 'browser-observation-v2'].includes(protocol.kind) ||
      !Array.isArray(protocol.features) || protocol.features.some(feature => typeof feature !== 'string') ||
       (manifest.distribution === 'ludory-vendored-prebuilt' &&
        (!manifest.runtime || manifest.runtime.nodeModulesDir !== 'node_modules' ||
         !runtimeTree || !Number.isSafeInteger(runtimeTree.files) || runtimeTree.files < 1 ||
         !Number.isSafeInteger(runtimeTree.bytes) || runtimeTree.bytes < 1 ||
         typeof runtimeTree.sha256 !== 'string' || !SHA256.test(runtimeTree.sha256) ||
         !Array.isArray(requiredPackages) || requiredPackages.some(packageInfo =>
           !packageInfo || typeof packageInfo !== 'object' ||
          !/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(packageInfo.name) ||
          typeof packageInfo.version !== 'string' || !packageInfo.version.trim())))) {
    throw errorWithCode('DEV_HELPER_MANIFEST_INVALID');
  }
  const hasV2 = protocol.features.includes('browser_observation_v2');
  if ((protocol.kind === 'browser-observation-v2') !== hasV2) {
    throw errorWithCode('DEV_HELPER_MANIFEST_INVALID');
  }
  return { artifact, protocol };
}

function runtimeTreeSummary(nodeModules) {
  let rootStat;
  try { rootStat = fs.lstatSync(nodeModules); }
  catch { throw errorWithCode('DEV_HELPER_RUNTIME_UNAVAILABLE'); }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
  }
  const entries = [];
  const visit = (directory, relativeDirectory) => {
    let children;
    try { children = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY'); }
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.join(relativeDirectory, child.name);
      let stat;
      try { stat = fs.lstatSync(absolute); }
      catch { throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY'); }
      if (stat.isSymbolicLink()) throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
      if (stat.isDirectory()) visit(absolute, relative);
      else if (stat.isFile()) {
        const bytes = fs.readFileSync(absolute);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        entries.push({ path: relative.split(path.sep).join('/'), bytes: bytes.length, sha256 });
      } else throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
    }
  };
  visit(nodeModules, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const digest = createHash('sha256');
  let bytes = 0;
  for (const entry of entries) {
    bytes += entry.bytes;
    digest.update(`${entry.path}\0${entry.bytes}\0${entry.sha256}\n`);
  }
  return { files: entries.length, bytes, sha256: digest.digest('hex') };
}

function verifyRuntimeDependencies(root, manifest) {
  const nodeModules = path.join(root, manifest.runtime?.nodeModulesDir ?? 'node_modules');
  const expectedTree = manifest.runtime?.tree;
  if (expectedTree) {
    const actualTree = runtimeTreeSummary(nodeModules);
    if (actualTree.files !== expectedTree.files || actualTree.bytes !== expectedTree.bytes ||
        actualTree.sha256 !== expectedTree.sha256) {
      throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
    }
  }
  for (const packageInfo of manifest.runtime?.requiredPackages ?? []) {
    const packageJson = path.join(nodeModules, ...packageInfo.name.split('/'), 'package.json');
    let packageDirectory;
    try { packageDirectory = canonicalPhysicalDirectory(path.dirname(packageJson)); }
    catch { throw errorWithCode('DEV_HELPER_RUNTIME_UNAVAILABLE'); }
    const relative = path.relative(root, packageDirectory);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw errorWithCode('DEV_HELPER_RUNTIME_UNAVAILABLE');
    }
    const packageFile = regularFile(packageJson, 'DEV_HELPER_RUNTIME_UNAVAILABLE');
    let installed;
    try { installed = JSON.parse(fs.readFileSync(packageFile, 'utf8')); }
    catch { throw errorWithCode('DEV_HELPER_RUNTIME_UNAVAILABLE'); }
    if (!installed || installed.name !== packageInfo.name || installed.version !== packageInfo.version) {
      throw errorWithCode('DEV_HELPER_RUNTIME_UNAVAILABLE');
    }
  }
}

export function verifyHelperArtifact({ scriptFile, manifestFile, checkRuntime = false,
  requireTrustedV2 = false }) {
  const script = regularFile(scriptFile);
  const manifestPath = regularFile(manifestFile, 'DEV_HELPER_MANIFEST_MISSING');
  const manifest = readJson(manifestPath, 'DEV_HELPER_MANIFEST_MISSING');
  const { artifact, protocol } = validateManifest(manifest, script);
  if (requireTrustedV2 && protocol.kind === 'browser-observation-v2') {
    const trusted = readVendoredHelperManifest();
    if (digestJson(manifest) !== digestJson(trusted) || artifact.sha256 !== trusted.artifact.sha256 ||
        artifact.bytes !== trusted.artifact.bytes) {
      throw errorWithCode('DEV_HELPER_ARTIFACT_UNTRUSTED');
    }
  }
  const bytes = fs.readFileSync(script);
  if (bytes.length !== artifact.bytes) throw errorWithCode('DEV_HELPER_HASH_MISMATCH');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== artifact.sha256) throw errorWithCode('DEV_HELPER_HASH_MISMATCH');
  if (checkRuntime) verifyRuntimeDependencies(path.dirname(script), manifest);
  return { scriptFile: script, manifestFile: manifestPath, bytes: bytes.length, sha256, manifest, protocol };
}

export function readVendoredHelperManifest() {
  const manifest = readJson(VENDORED_MANIFEST, 'DEV_HELPER_MANIFEST_MISSING');
  validateManifest(manifest, VENDORED_HELPER);
  return manifest;
}

function profileFile(file, home) {
  const parent = canonicalPhysicalDirectory(path.dirname(file));
  const candidate = path.join(parent, path.basename(file));
  const relative = path.relative(home, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
  }
  if (fs.existsSync(candidate)) regularFile(candidate);
  return candidate;
}

function profileJson(file, home) {
  const safe = profileFile(file, home);
  if (!fs.existsSync(safe) || fs.statSync(safe).size > MAX_MANIFEST_BYTES) {
    throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
  }
  try {
    const value = JSON.parse(fs.readFileSync(safe, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not-object');
    return { safe, value };
  } catch { throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED'); }
}

function samePhysical(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function trustedLauncherCandidates() {
  const candidates = [];
  if (process.platform === 'win32') {
    for (const root of [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (typeof root === 'string' && root.trim()) {
        candidates.push(path.join(root, 'Programs', 'Codex Web GPT', 'Codex Web GPT.exe'));
      }
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Codex Web GPT.app/Contents/MacOS/Codex Web GPT');
  } else {
    candidates.push(path.join(os.homedir(), '.local', 'bin', 'codex-web-gpt'));
  }
  if (typeof process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE === 'string' &&
      process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE.trim()) {
    candidates.push(process.env.CODEX_WEB_GPT_LAUNCHER_EXECUTABLE.trim());
  }
  return candidates;
}

function trustedLauncher(existing) {
  const configured = [existing, ...trustedLauncherCandidates()];
  const expectedName = process.platform === 'win32' ? 'codex web gpt.exe' : 'codex-web-gpt';
  for (const candidate of configured) {
    if (typeof candidate !== 'string' || path.basename(candidate).toLowerCase() !== expectedName) continue;
    try {
      const real = fs.realpathSync.native(candidate);
      if (fs.statSync(real).isFile() && trustedLauncherCandidates().some(known => {
        try { return samePhysical(real, fs.realpathSync.native(known)); } catch { return false; }
      })) return real;
    } catch { /* Try the next registered launcher candidate. */ }
  }
  throw errorWithCode('DEV_LAUNCHER_UNAVAILABLE');
}

function isolatedProfile(devHome, stableHome) {
  const requested = path.resolve(devHome ?? process.env.CODEX_WEB_GPT_DEV_HOME ??
    path.join(os.homedir(), '.codex-chatgpt-web-dev'));
  const stableRequested = path.resolve(stableHome ?? process.env.CODEX_CHATGPT_WEB_HOME ??
    path.join(os.homedir(), '.codex-chatgpt-web'));
  if (!fs.existsSync(requested) || !fs.existsSync(stableRequested)) throw errorWithCode('DEV_PROFILE_UNAVAILABLE');
  const home = canonicalPhysicalDirectory(requested);
  const stable = fs.realpathSync.native(stableRequested);
  if (samePhysical(home, stable)) throw errorWithCode('DEV_PROFILE_NOT_ISOLATED');
  return home;
}

function writeAtomic(file, contents) {
  const temporary = `${file}.ludory-${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* Preserve the publish error. */ }
    throw error;
  }
}

function copyAtomic(source, destination) {
  const temporary = `${destination}.ludory-${randomUUID()}.tmp`;
  try {
    fs.copyFileSync(source, temporary);
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* Preserve the publish error. */ }
    throw error;
  }
}

function copyDirectoryContents(source, destination) {
  let stat;
  try { stat = fs.lstatSync(source); }
  catch { throw errorWithCode('DEV_HELPER_RUNTIME_UNAVAILABLE'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const sourceStat = fs.lstatSync(sourcePath);
    if (sourceStat.isSymbolicLink()) throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
    if (sourceStat.isDirectory()) copyDirectoryContents(sourcePath, destinationPath);
    else if (sourceStat.isFile()) fs.copyFileSync(sourcePath, destinationPath);
    else throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
  }
}

function materializeRuntime(source, destination, expectedTree) {
  if (pathExists(destination)) {
    const actual = runtimeTreeSummary(destination);
    if (actual.files !== expectedTree.files || actual.bytes !== expectedTree.bytes ||
        actual.sha256 !== expectedTree.sha256) throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
    return false;
  }
  const temporary = `${destination}.ludory-${randomUUID()}.tmp`;
  try {
    copyDirectoryContents(source, temporary);
    const actual = runtimeTreeSummary(temporary);
    if (actual.files !== expectedTree.files || actual.bytes !== expectedTree.bytes ||
        actual.sha256 !== expectedTree.sha256) throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
    fs.renameSync(temporary, destination);
    return true;
  } catch (error) {
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* Preserve the publish error. */ }
    throw error;
  }
}

/** Preview/apply the pinned helper into the isolated DEV profile only. */
export function installVendoredDevHelper({ devHome, stableHome, apply = false } = {}) {
  const artifact = verifyHelperArtifact({ scriptFile: VENDORED_HELPER, manifestFile: VENDORED_MANIFEST,
    checkRuntime: true, requireTrustedV2: true });
  const home = isolatedProfile(devHome, stableHome);
  const configResult = profileJson(path.join(home, 'config.json'), home);
  const config = configResult.value;
  if (config.version !== 3 || config.mode !== 'browser-only') throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
  const descriptorPath = config.browserHostDescriptorPath || path.join(home, 'runtime', 'launcher-browser.json');
  const descriptorResult = profileJson(descriptorPath, home);
  const descriptor = descriptorResult.value;
  if (descriptor.profile !== 'development' || descriptor.kind !== 'codex-web-gpt-launcher' ||
      !descriptor.helper || typeof descriptor.helper !== 'object' ||
      typeof descriptor.helper.executable !== 'string' || !path.isAbsolute(descriptor.helper.executable)) {
    throw errorWithCode('DEV_DESCRIPTOR_UNTRUSTED');
  }
  const descriptorExecutable = regularFile(descriptor.helper.executable);
  const executable = trustedLauncher(descriptorExecutable);
  if (!samePhysical(descriptorExecutable, executable)) throw errorWithCode('DEV_LAUNCHER_UNAVAILABLE');
  const runtime = path.join(home, 'runtime');
  const helperFile = profileFile(path.join(runtime, 'browser-helper.cjs'), home);
  const manifestFile = profileFile(path.join(runtime, HELPER_MANIFEST_NAME), home);
  const runtimeNodeModules = path.join(runtime, artifact.manifest.runtime.nodeModulesDir);
  if (pathExists(runtimeNodeModules)) {
    const existing = runtimeTreeSummary(runtimeNodeModules);
    const expected = artifact.manifest.runtime.tree;
    if (existing.files !== expected.files || existing.bytes !== expected.bytes || existing.sha256 !== expected.sha256) {
      throw errorWithCode('DEV_HELPER_RUNTIME_INTEGRITY');
    }
  }
  const nextConfig = { ...config, browserHelperScriptPath: helperFile };
  const writes = [helperFile, manifestFile, runtimeNodeModules, configResult.safe];
  const result = { status: 'READY', mode: apply ? 'apply' : 'preview', profileHome: home,
    artifact: { file: path.basename(helperFile), bytes: artifact.bytes, sha256: artifact.sha256,
      distribution: artifact.manifest.distribution, protocol: artifact.protocol },
    launcher: executable, writes,
    warning: 'The vendored helper is a pinned prebuilt; source rebuilds are not byte-reproducible.' };
  if (!apply) return result;
  materializeRuntime(VENDORED_RUNTIME_NODE_MODULES, runtimeNodeModules, artifact.manifest.runtime.tree);
  copyAtomic(VENDORED_HELPER, helperFile);
  copyAtomic(VENDORED_MANIFEST, manifestFile);
  const installed = verifyHelperArtifact({ scriptFile: helperFile, manifestFile, checkRuntime: true,
    requireTrustedV2: true });
  if (installed.sha256 !== artifact.sha256 || installed.bytes !== artifact.bytes) {
    throw errorWithCode('DEV_HELPER_HASH_MISMATCH');
  }
  writeAtomic(configResult.safe, `${JSON.stringify(nextConfig, null, 2)}\n`);
  return { ...result, status: 'APPLIED', mode: 'apply', installed: { bytes: installed.bytes, sha256: installed.sha256 } };
}
