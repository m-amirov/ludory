import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { canonicalPhysicalDirectory } from '@ludory/core';
import { verifyStudioOrigin, assertComponentTrust, hostTrustDigest } from '@ludory/studio-trust';
import { readRegular } from './profile-state.mjs';
import { planPreviewBuild, buildPreview } from './preview-build.mjs';
import { planCreate, applyCreatePlan } from './scaffold.mjs';
import { compileNarrativePlatformEntrypoint } from './narrative-platform-compile.mjs';
import { buildYandexCandidate } from '../../../scripts/build-yandex-candidate.mjs';
import { buildVkCandidate } from '../../../scripts/build-vk-candidate.mjs';
import { inspectYandexArchive, inspectVkArchive } from '@ludory/release';
import { readRegularBytes } from '../../release/src/archive.mjs';

const mode = 'narrative-platform-export';
const targets = Object.freeze(['yandex-games', 'vk-games']);
const issuedPlans = new WeakMap();

function blocked(project, reasonCode) {
  return { mode, project, status: 'BLOCKED', reasonCode, writes: [] };
}

function sourceIdentity(project) {
  const origin = verifyStudioOrigin(project);
  if (!origin.ok || origin.project !== project) throw new Error(`F5B_STUDIO_ORIGIN_${origin.code}`);
  const receipt = readRegular(path.join(project, 'ludory.studio.json'), 'ludory.studio.json');
  const state = readRegular(path.join(project, 'ludory.components.json'), 'ludory.components.json');
  const sourceManifest = readRegular(path.join(project, 'ludory.project.json'), 'ludory.project.json');
  const rootStat = fs.lstatSync(project, { bigint: true });
  assertComponentTrust(project, { rootIdentity: `${rootStat.dev}:${rootStat.ino}`,
    receiptSha256: hostTrustDigest(receipt), stateSha256: hostTrustDigest(state),
    manifestSha256: hostTrustDigest(sourceManifest) });
  const studio = JSON.parse(receipt.toString('utf8'));
  const components = JSON.parse(state.toString('utf8'));
  const manifest = JSON.parse(sourceManifest.toString('utf8'));
  if (studio.profile?.id !== 'narrative-game' || studio.template?.id !== 'narrative-interactive' ||
      components.template?.id !== 'narrative-interactive' ||
      components.template?.profile !== 'narrative-game') {
    throw new Error('F5B_NARRATIVE_TEMPLATE_REQUIRED');
  }
  if (!Array.isArray(manifest.targets) || manifest.targets.length !== 2 ||
      !targets.every(target => manifest.targets.includes(target))) {
    throw new Error('F5B_DUAL_TARGET_DECLARATION_REQUIRED');
  }
  return manifest;
}

function shape(plan) {
  return JSON.stringify({ mode: plan.mode, status: plan.status, project: plan.project,
    sourceDigest: plan.sourceDigest, sourcePlanId: plan.sourcePlanId,
    files: plan.files, targets: plan.targets, writes: plan.writes });
}

/** Read-only permission to derive two platform builds from one original Studio narrative. */
export function planNarrativePlatformExport(projectDir) {
  if (typeof projectDir !== 'string' || !projectDir.trim()) {
    return blocked(null, 'F5B_PROJECT_PATH_REQUIRED');
  }
  const requested = path.resolve(projectDir);
  let project = requested;
  try {
    project = canonicalPhysicalDirectory(requested);
    const preview = planPreviewBuild(project);
    if (preview.status !== 'READY') throw new Error(preview.reasonCode);
    sourceIdentity(project);
    // Protect against a metadata/manifest race between the provenance read and the preview scan.
    const repeated = planPreviewBuild(project);
    if (repeated.status !== 'READY' || repeated.sourceDigest !== preview.sourceDigest ||
        repeated.rootIdentity !== preview.rootIdentity ||
        JSON.stringify(repeated.files) !== JSON.stringify(preview.files)) {
      throw new Error('F5B_SOURCE_CHANGED');
    }
    const result = { mode, status: 'READY_TO_DERIVE', project, sourceDigest: preview.sourceDigest,
      sourcePlanId: randomUUID(), files: preview.files.map(file => ({ ...file })),
      targets: [...targets], writes: [] };
    issuedPlans.set(result, { shape: shape(result), preview });
    return result;
  } catch (error) { return blocked(project, error.message || 'F5B_SOURCE_UNAVAILABLE'); }
}

/** Pins real source bytes only; the future SDK packaging step must build and verify its own outputs. */
export function materializeNarrativePlatformSource(plan) {
  const issued = plan && typeof plan === 'object' ? issuedPlans.get(plan) : null;
  if (!issued || shape(plan) !== issued.shape) {
    return blocked(plan?.project ?? null, 'F5B_EXPORT_PLAN_UNTRUSTED');
  }
  const built = buildPreview(issued.preview);
  if (built.status !== 'BUILT') return blocked(issued.preview.project, built.reasonCode);
  if (built.sourceDigest !== plan.sourceDigest ||
      JSON.stringify(built.files) !== JSON.stringify(plan.files)) {
    built.cleanup();
    return blocked(plan.project, 'F5B_SOURCE_CHANGED');
  }
  return { mode, status: 'SOURCE_PINNED', root: built.root, sourceDigest: built.sourceDigest,
    files: built.files, targets: [...targets], cleanup: built.cleanup,
    releaseReady: false, publicationAllowed: false };
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const platformWebpQuality = 95;
const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ogg', '.mp3', '.wav', '.woff2', '.ttf', '.css']);
const targetSpecs = Object.freeze({
  yandex: { target: 'yandex-games', template: 'yandex-runtime' },
  vk: { target: 'vk-games', template: 'vk-runtime' },
});

const safeExportPart = /^[a-z0-9][a-z0-9._-]*$/i;

function validateExportPath(filename) {
  const parts = filename.split('/');
  if (!parts.length || parts.some(part => !safeExportPart.test(part) || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new Error(`F5B_UNSUPPORTED_AUTHOR_MEDIA: ${filename}`);
  }
  return filename;
}

function exportAssetPath(sourcePath) {
  const fontRenames = new Map([
    ['assets/fonts/CormorantGaramond[wght].ttf', 'assets/fonts/CormorantGaramond-wght.ttf'],
    ['assets/fonts/Manrope[wght].ttf', 'assets/fonts/Manrope-wght.ttf'],
  ]);
  if (fontRenames.has(sourcePath)) return fontRenames.get(sourcePath);
  if (sourcePath.startsWith('src/ui/') && path.posix.extname(sourcePath).toLowerCase() === '.css') {
    return `assets/ui/${sourcePath.slice('src/ui/'.length)}`;
  }
  return sourcePath;
}

function rewriteCssDependencies(bytes, sourcePath, targetPath, assetPathMap) {
  const source = bytes.toString('utf8');
  const rewrite = (full, quote, specifier) => {
    if (!specifier || specifier.startsWith('#') || /^(?:https?:|data:|blob:|\/\/)/i.test(specifier)) return full;
    const split = specifier.match(/^([^?#]*)([?#].*)?$/);
    const clean = split?.[1] ?? specifier;
    const suffix = split?.[2] ?? '';
    let decoded;
    try { decoded = decodeURIComponent(clean); }
    catch { throw new Error(`F5B_CSS_DEPENDENCY_UNSAFE: ${sourcePath} -> ${specifier}`); }
    if (/%2f|%5c|(?:^|\/)%2e(?:%2e)?(?=\/|$)/i.test(clean) || decoded.includes('\\') || decoded.includes('\0') ||
        /[\x00-\x1f\x7f]/.test(decoded) || decoded.startsWith('//')) {
      throw new Error(`F5B_CSS_DEPENDENCY_UNSAFE: ${sourcePath} -> ${specifier}`);
    }
    const resolved = path.posix.normalize(decoded.startsWith('/')
      ? decoded.slice(1) : path.posix.join(path.posix.dirname(sourcePath), decoded));
    const exported = assetPathMap.get(resolved);
    if (!exported) throw new Error(`F5B_CSS_DEPENDENCY_UNPACKAGED: ${sourcePath} -> ${resolved}`);
    const relative = path.posix.relative(path.posix.dirname(targetPath), exported);
    if (!relative || relative.startsWith('/') || relative === '..' || relative.startsWith('../')) {
      return full.replace(specifier, `${relative || path.posix.basename(exported)}${suffix}`);
    }
    return full.replace(specifier, `${relative}${suffix}`);
  };
  const rewritten = source
    .replace(/\burl\s*\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, rewrite)
    .replace(/@import\s+(['"])([^'"\r\n]+)\1/gi, rewrite);
  return Buffer.from(rewritten);
}

function scanDerivedFiles(root, relative = '') {
  const found = [];
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const local = relative ? `${relative}/${name}` : name;
    const file = path.join(root, local);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`F5B_DERIVED_SYMLINK: ${local}`);
    if (stat.isDirectory()) found.push(...scanDerivedFiles(root, local));
    else if (stat.isFile()) {
      const bytes = fs.readFileSync(file);
      found.push({ path: local, sha256: sha(bytes), size: bytes.length });
    } else throw new Error(`F5B_DERIVED_SPECIAL_FILE: ${local}`);
  }
  return found;
}

const textResourceExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.svg']);

function isTextResource(filename) {
  return textResourceExtensions.has(path.posix.extname(filename).toLowerCase());
}

function assertPlatformWebpSource(file, root) {
  const filename = path.join(root, file.path);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`F5B_PLATFORM_IMAGE_UNSAFE: ${file.path}`);
  const bytes = fs.readFileSync(filename);
  if (bytes.length !== file.size || sha(bytes) !== file.sha256) {
    throw new Error(`F5B_PLATFORM_IMAGE_SOURCE_CHANGED: ${file.path}`);
  }
  return bytes;
}

function rewriteCssImageReferences(text, filePath, imagePathMap) {
  return text.replace(/\burl\s*\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi,
    (full, quote, specifier) => {
      const split = specifier.match(/^([^?#]*)([?#].*)?$/);
      const clean = split?.[1] ?? specifier;
      const suffix = split?.[2] ?? '';
      let decoded;
      try { decoded = decodeURIComponent(clean); }
      catch { throw new Error(`F5B_CSS_DEPENDENCY_UNSAFE: ${filePath} -> ${specifier}`); }
      if (!decoded || decoded.startsWith('#') || /^(?:https?:|data:|blob:|\/\/)/i.test(decoded) ||
          decoded.includes('\\') || decoded.includes('\0') || /[\x00-\x1f\x7f]/.test(decoded)) return full;
      const resolved = path.posix.normalize(decoded.startsWith('/')
        ? decoded.slice(1) : path.posix.join(path.posix.dirname(filePath), decoded));
      const replacement = imagePathMap.get(resolved);
      if (!replacement) return full;
      const relative = path.posix.relative(path.posix.dirname(filePath), replacement) ||
        path.posix.basename(replacement);
      return full.replace(specifier, `${relative}${suffix}`);
    });
}

function rewritePlatformImageReferences(root, replacements, imagePathMap) {
  for (const file of scanDerivedFiles(root)) {
    if (!isTextResource(file.path)) continue;
    const filename = path.join(root, file.path);
    let text = fs.readFileSync(filename, 'utf8');
    const original = text;
    if (path.posix.extname(file.path).toLowerCase() === '.css') {
      text = rewriteCssImageReferences(text, file.path, imagePathMap);
    }
    for (const [from, to] of replacements) text = text.replaceAll(from, to);
    if (text !== original) fs.writeFileSync(filename, text);
  }
}

async function materializePlatformWebp(project) {
  const pngs = project.files.filter(file => file.path.startsWith('assets/') &&
    path.posix.extname(file.path).toLowerCase() === '.png');
  const targetPaths = new Set(project.files.map(file => file.path));
  const basenameCounts = new Map();
  for (const file of pngs) {
    const basename = path.posix.basename(file.path);
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }
  const derivations = [];
  const replacements = [];
  const imagePathMap = new Map();
  for (const source of pngs) {
    const derivedPath = source.path.replace(/\.png$/i, '.webp');
    if (targetPaths.has(derivedPath)) throw new Error(`F5B_PLATFORM_WEBP_COLLISION: ${derivedPath}`);
    const sourceBytes = assertPlatformWebpSource(source, project.root);
    const metadata = await sharp(sourceBytes, { failOn: 'error', limitInputPixels: 64 * 1024 * 1024 }).metadata();
    const derivedBytes = await sharp(sourceBytes, { failOn: 'error', limitInputPixels: 64 * 1024 * 1024 })
      .webp({ quality: platformWebpQuality, effort: 6 }).toBuffer();
    const output = path.join(project.root, derivedPath);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, derivedBytes, { flag: 'wx' });
    derivations.push({ sourcePath: source.path, derivedPath, sourceSha256: source.sha256,
      sourceSize: source.size, derivedSha256: sha(derivedBytes), derivedSize: derivedBytes.length,
      width: metadata.width, height: metadata.height, quality: platformWebpQuality });
    imagePathMap.set(source.path, derivedPath);
    replacements.push([source.path, derivedPath]);
    const basename = path.posix.basename(source.path);
    if (basenameCounts.get(basename) === 1) {
      replacements.push([basename, path.posix.basename(derivedPath)]);
    }
  }
  rewritePlatformImageReferences(project.root, replacements, imagePathMap);
  for (const source of pngs) fs.unlinkSync(path.join(project.root, source.path));
  const files = scanDerivedFiles(project.root);
  if (files.some(file => file.path.startsWith('assets/') &&
      path.posix.extname(file.path).toLowerCase() === '.png')) {
    throw new Error('F5B_PLATFORM_PNG_RETAINED');
  }
  for (const source of pngs) {
    const basename = path.posix.basename(source.path);
    if (files.some(file => file.path.endsWith(`/${basename}`) || file.path === basename) ||
        files.filter(file => isTextResource(file.path)).some(file =>
          fs.readFileSync(path.join(project.root, file.path), 'utf8').includes(basename))) {
      throw new Error(`F5B_PLATFORM_PNG_REFERENCE_RETAINED: ${basename}`);
    }
  }
  return { files, sha256: sha(Buffer.from(JSON.stringify(files))), assetDerivations: derivations };
}

async function materializeNarrativePlatformPlatformExport(plan) {
  const derived = materializeNarrativePlatformProjects(plan);
  if (derived.status !== 'DERIVED_LOCAL') return derived;
  try {
    await optimizeNarrativePlatformProjects(derived);
    return derived;
  } catch (error) {
    derived.cleanup();
    return { ...blocked(plan?.project ?? null, error.message || 'F5B_PLATFORM_WEBP_FAILED'),
      releaseReady: false, publicationAllowed: false };
  }
}

async function optimizeNarrativePlatformProjects(derived) {
  for (const project of Object.values(derived.projects)) {
    const optimized = await materializePlatformWebp(project);
    project.files = optimized.files;
    project.sha256 = optimized.sha256;
    project.assetDerivations = optimized.assetDerivations;
  }
  return derived;
}

function ownedCleanup(directory) {
  const ownership = fs.lstatSync(directory, { bigint: true });
  let called = false;
  return () => {
    if (called) return;
    called = true;
    let now;
    try { now = fs.lstatSync(directory, { bigint: true }); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (!now.isDirectory() || now.isSymbolicLink() ||
        now.dev !== ownership.dev || now.ino !== ownership.ino) {
      throw new Error('F5B_DERIVED_DIRECTORY_IDENTITY_CHANGED');
    }
    fs.rmSync(directory, { recursive: true });
  };
}

/** Materializes a fresh F5b1 pin into two short-lived native target projects. */
export function materializeNarrativePlatformProjects(plan) {
  const pin = materializeNarrativePlatformSource(plan);
  if (pin.status !== 'SOURCE_PINNED') return { ...pin, releaseReady: false, publicationAllowed: false };
  let derived;
  let cleanup;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(pin.root, 'ludory.project.json')));
    const titles = Object.entries(manifest.title);
    if (!titles.length) throw new Error('F5B_TITLE_REQUIRED');
    derived = fs.mkdtempSync(path.join(path.dirname(pin.root), 'ludory-f5b2-targets-'));
    cleanup = ownedCleanup(derived);
    const projects = {};
    const seenMedia = new Set();
    const media = [];
    const assetPathMap = new Map();
    for (const file of pin.files) {
      if (/^(?:images|media|audio|sounds|fonts)\//.test(file.path)) {
        throw new Error(`F5B_UNSUPPORTED_AUTHOR_MEDIA_ROOT: ${file.path}`);
      }
      const extension = path.posix.extname(file.path).toLowerCase();
      if (file.path.startsWith('src/ui/') && extension === '.css') {
        const targetPath = validateExportPath(exportAssetPath(file.path));
        const folded = targetPath.toLowerCase();
        if (seenMedia.has(folded)) throw new Error(`F5B_CASE_COLLIDING_AUTHOR_MEDIA: ${file.path}`);
        seenMedia.add(folded);
        assetPathMap.set(file.path, targetPath);
        media.push({ sourcePath: file.path, targetPath });
        continue;
      }
      if (!file.path.startsWith('assets/') || file.path === 'assets/ludory-narrative.js') continue;
      const targetPath = validateExportPath(exportAssetPath(file.path));
      if (!mediaExtensions.has(extension)) {
        throw new Error(`F5B_UNSUPPORTED_AUTHOR_MEDIA: ${file.path}`);
      }
      const folded = targetPath.toLowerCase();
      if (seenMedia.has(folded)) throw new Error(`F5B_CASE_COLLIDING_AUTHOR_MEDIA: ${file.path}`);
      seenMedia.add(folded);
      assetPathMap.set(file.path, targetPath);
      media.push({ sourcePath: file.path, targetPath });
    }
    for (const [key, spec] of Object.entries(targetSpecs)) {
      const root = path.join(derived, key);
      fs.mkdirSync(root);
      const create = planCreate(root, { id: manifest.id, version: manifest.version,
        title: manifest.title, lang: titles[0][0], profile: 'web-game',
        template: spec.template, targets: [spec.target] });
      if (create.status !== 'READY') throw new Error(`F5B_TARGET_SCAFFOLD_${create.conflicts.join(';')}`);
      if (applyCreatePlan(create).status !== 'APPLIED') throw new Error('F5B_TARGET_SCAFFOLD_FAILED');
      const compiled = compileNarrativePlatformEntrypoint({ sourceRoot: pin.root, target: spec.target, assetPathMap });
      fs.writeFileSync(path.join(root, 'index.html'), compiled.htmlBytes);
      fs.writeFileSync(path.join(root, 'src/main.js'), compiled.entryBytes);
      for (const { sourcePath, targetPath } of media) {
        const target = path.join(root, targetPath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const bytes = fs.readFileSync(path.join(pin.root, sourcePath));
        const output = path.posix.extname(sourcePath).toLowerCase() === '.css'
          ? rewriteCssDependencies(bytes, sourcePath, targetPath, assetPathMap) : bytes;
        fs.writeFileSync(target, output, { flag: 'wx' });
      }
      const origin = verifyStudioOrigin(root);
      if (!origin.ok || origin.project !== canonicalPhysicalDirectory(root)) {
        throw new Error(`F5B_TARGET_ORIGIN_${origin.code}`);
      }
      const files = scanDerivedFiles(root);
      projects[key] = { root, target: spec.target, files, sha256: sha(Buffer.from(JSON.stringify(files))),
        assetDerivations: [] };
    }
    return { mode, status: 'DERIVED_LOCAL', sourceDigest: pin.sourceDigest, projects,
      cleanup, releaseReady: false, publicationAllowed: false };
  } catch (error) {
    if (cleanup) cleanup();
    return { ...blocked(plan?.project ?? null, error.message || 'F5B_DERIVATION_FAILED'),
      releaseReady: false, publicationAllowed: false };
  } finally { pin.cleanup(); }
}

const outputNames = Object.freeze(['yandexZip', 'vkZip', 'yandexBuildReceipt', 'vkBuildReceipt', 'exportReceipt']);
const outputFileName = /^[a-z0-9][a-z0-9._-]*$/i;

function outputAdmission(paths, sourceRoot, projects) {
  if (!paths || typeof paths !== 'object') throw new Error('F5B_OUTPUT_PATHS_REQUIRED');
  const admitted = {};
  const pins = {};
  const unique = new Set();
  const protectedRoots = [sourceRoot, ...Object.values(projects).map(item => item.root)]
    .map(item => canonicalPhysicalDirectory(item));
  for (const [index, name] of outputNames.entries()) {
    const requested = paths[name];
    if (typeof requested !== 'string' || !requested.trim()) throw new Error(`F5B_OUTPUT_REQUIRED_${name}`);
    const output = path.resolve(requested);
    const basename = path.basename(output);
    if (!outputFileName.test(basename) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename) ||
        !basename.endsWith(index < 2 ? '.zip' : '.json')) throw new Error(`F5B_OUTPUT_NAME_UNSAFE_${name}`);
    let ancestor = path.parse(output).root;
    for (const segment of path.dirname(output).slice(ancestor.length).split(path.sep)) {
      if (!segment) continue;
      ancestor = path.join(ancestor, segment);
      const stat = fs.lstatSync(ancestor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('F5B_OUTPUT_PARENT_UNSAFE');
    }
    const physicalParent = canonicalPhysicalDirectory(path.dirname(output));
    if (protectedRoots.some(root => {
      const relative = path.relative(root, physicalParent);
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    })) throw new Error('F5B_OUTPUT_OVERLAPS_SOURCE');
    try { fs.lstatSync(output); throw new Error(`F5B_OUTPUT_EXISTS_${name}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const identity = `${physicalParent.toLowerCase()}|${basename.toLowerCase()}`;
    if (unique.has(identity)) throw new Error('F5B_OUTPUT_COLLISION');
    unique.add(identity);
    admitted[name] = output;
    const parentStat = fs.lstatSync(physicalParent, { bigint: true });
    pins[name] = { parent: physicalParent, dev: parentStat.dev, ino: parentStat.ino };
  }
  Object.defineProperty(admitted, '_parentPins', { value: pins });
  return admitted;
}

function writeExclusiveJson(filename, value, partialOutputs, pin) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (bytes.length > 1024 * 1024) throw new Error('F5B_RECEIPT_TOO_LARGE');
  const previousCwd = process.cwd();
  try {
    process.chdir(pin.parent);
    const anchored = fs.statSync('.', { bigint: true });
    if (!anchored.isDirectory() || anchored.dev !== pin.dev || anchored.ino !== pin.ino) {
      throw new Error('F5B_OUTPUT_PARENT_CHANGED');
    }
    const fd = fs.openSync(path.basename(filename), fs.constants.O_CREAT | fs.constants.O_EXCL |
      fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    partialOutputs.push(filename);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      const current = fs.lstatSync(pin.parent, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() ||
          current.dev !== pin.dev || current.ino !== pin.ino) {
        throw new Error('F5B_OUTPUT_PARENT_CHANGED');
      }
    } finally { fs.closeSync(fd); }
  } finally { process.chdir(previousCwd); }
}

function exact(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function assertFileArray(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('F5B_RECEIPT_FILE_LIST_INVALID');
  const seen = new Set();
  for (const file of files) {
    if (!exact(file, ['path', 'sha256', 'size']) || typeof file.path !== 'string' ||
        !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 ||
        seen.has(file.path) || file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\')) {
      throw new Error('F5B_RECEIPT_FILE_LIST_INVALID');
    }
    seen.add(file.path);
  }
}

function sameFiles(left, right) {
  assertFileArray(left);
  assertFileArray(right);
  const ordered = files => [...files].sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(ordered(left)) !== JSON.stringify(ordered(right))) {
    throw new Error('F5B_CANDIDATE_MEMBER_MISMATCH');
  }
}

function readReceipt(filename) {
  return JSON.parse(readRegularBytes(filename, 1024 * 1024).toString('utf8'));
}

function assertPlatformWebpDerivations(sourcePlan, assetDerivations, derivedFiles, archiveFiles) {
  const sourcePngs = sourcePlan.files.filter(file => file.path.startsWith('assets/') &&
    path.posix.extname(file.path).toLowerCase() === '.png');
  if (!Array.isArray(assetDerivations) || assetDerivations.length !== sourcePngs.length) {
    throw new Error('F5B_PLATFORM_WEBP_DERIVATION_LIST_INVALID');
  }
  const sources = new Map(sourcePngs.map(file => [file.path, file]));
  const derived = new Map(derivedFiles.map(file => [file.path, file]));
  const seenSources = new Set();
  const seenDerived = new Set();
  for (const item of assetDerivations) {
    if (!exact(item, ['sourcePath', 'derivedPath', 'sourceSha256', 'sourceSize',
      'derivedSha256', 'derivedSize', 'width', 'height', 'quality']) ||
        typeof item.sourcePath !== 'string' || typeof item.derivedPath !== 'string' ||
        !/^[a-f0-9]{64}$/.test(item.sourceSha256) || !Number.isSafeInteger(item.sourceSize) ||
        !/^[a-f0-9]{64}$/.test(item.derivedSha256) || !Number.isSafeInteger(item.derivedSize) ||
        !Number.isSafeInteger(item.width) || item.width < 1 || !Number.isSafeInteger(item.height) || item.height < 1 ||
        item.quality !== platformWebpQuality || seenSources.has(item.sourcePath) || seenDerived.has(item.derivedPath)) {
      throw new Error('F5B_PLATFORM_WEBP_DERIVATION_INVALID');
    }
    const source = sources.get(item.sourcePath);
    const outputPath = item.sourcePath.replace(/\.png$/i, '.webp');
    const output = derived.get(item.derivedPath);
    const archived = new Map(archiveFiles.map(file => [file.path, file])).get(item.derivedPath);
    if (!source || item.derivedPath !== outputPath || !output || !archived ||
        item.sourceSha256 !== source.sha256 || item.sourceSize !== source.size ||
        item.derivedSha256 !== output.sha256 || item.derivedSize !== output.size ||
        archived.sha256 !== output.sha256 || archived.size !== output.size ||
        path.posix.extname(item.derivedPath).toLowerCase() !== '.webp') {
      throw new Error('F5B_PLATFORM_WEBP_DERIVATION_MISMATCH');
    }
    seenSources.add(item.sourcePath);
    seenDerived.add(item.derivedPath);
  }
  if (seenSources.size !== sources.size || seenDerived.size !== assetDerivations.length ||
      derivedFiles.some(file => file.path.startsWith('assets/') &&
        path.posix.extname(file.path).toLowerCase() === '.png')) {
      throw new Error('F5B_PLATFORM_WEBP_SOURCE_RETAINED');
  }
}

/** Re-check stored ZIP/member bytes against a live host-trusted F5b1 plan. */
export async function verifyNarrativePlatformCandidates(paths = {}, sourcePlan) {
  let rederived;
  let result;
  try {
    const issued = sourcePlan && typeof sourcePlan === 'object' ? issuedPlans.get(sourcePlan) : null;
    if (!issued || shape(sourcePlan) !== issued.shape) throw new Error('F5B_TRUSTED_SOURCE_PLAN_REQUIRED');
    const linked = readReceipt(paths.exportReceipt);
    if (!exact(linked, ['schemaVersion', 'sourceDigest', 'sourceFiles', 'candidates']) ||
        linked.schemaVersion !== 1 || !Array.isArray(linked.candidates) || linked.candidates.length !== 2) {
      throw new Error('F5B_EXPORT_RECEIPT_INVALID');
    }
    assertFileArray(linked.sourceFiles);
    if (sha(Buffer.from(JSON.stringify(linked.sourceFiles))) !== linked.sourceDigest) {
      throw new Error('F5B_SOURCE_DIGEST_MISMATCH');
    }
    if (linked.sourceDigest !== sourcePlan.sourceDigest ||
        JSON.stringify(linked.sourceFiles) !== JSON.stringify(sourcePlan.files)) {
      throw new Error('F5B_SOURCE_BINDING_MISMATCH');
    }
    const optimized = linked.candidates.some(candidate => Array.isArray(candidate.assetDerivations) &&
      candidate.assetDerivations.length > 0);
    if (sourcePlan.files.some(file => file.path.startsWith('assets/') &&
        path.posix.extname(file.path).toLowerCase() === '.png') && !optimized) {
      throw new Error('F5B_PLATFORM_WEBP_REQUIRED');
    }
    if (!optimized) {
      rederived = materializeNarrativePlatformProjects(sourcePlan);
      if (rederived.status !== 'DERIVED_LOCAL') throw new Error(rederived.reasonCode || 'F5B_SOURCE_REDERIVATION_FAILED');
    } else {
      rederived = materializeNarrativePlatformProjects(sourcePlan);
      if (rederived.status !== 'DERIVED_LOCAL') throw new Error(rederived.reasonCode || 'F5B_SOURCE_REDERIVATION_FAILED');
      await optimizeNarrativePlatformProjects(rederived);
    }
    for (const [index, key] of ['yandex', 'vk'].entries()) {
      const candidate = linked.candidates[index];
      const target = targetSpecs[key].target;
      const archivePath = path.resolve(paths[`${key}Zip`]);
      const receipt = readReceipt(paths[`${key}BuildReceipt`]);
      const archived = key === 'yandex' ? inspectYandexArchive(archivePath) : inspectVkArchive(archivePath);
      if (!exact(candidate, ['target', 'derivedProjectSha256', 'derivedFiles', 'assetDerivations',
        'archivePath', 'archiveSha256', 'files']) ||
          !exact(receipt, ['archivePath', 'sha256', 'files']) ||
          candidate.target !== target || candidate.archivePath !== archivePath ||
          receipt.archivePath !== archivePath || candidate.archiveSha256 !== archived.sha256 ||
          receipt.sha256 !== archived.sha256) throw new Error('F5B_ARCHIVE_RECEIPT_MISMATCH');
      sameFiles(candidate.files, archived.files);
      sameFiles(receipt.files, archived.files);
      assertFileArray(candidate.derivedFiles);
      if (sha(Buffer.from(JSON.stringify(candidate.derivedFiles))) !== candidate.derivedProjectSha256) {
        throw new Error('F5B_DERIVED_HASH_MISMATCH');
      }
      if (!optimized && candidate.derivedProjectSha256 !== rederived.projects[key].sha256) {
        throw new Error('F5B_DERIVED_SOURCE_BINDING_MISMATCH');
      }
      if (optimized) {
        assertPlatformWebpDerivations(sourcePlan, candidate.assetDerivations,
          candidate.derivedFiles, archived.files);
        if (candidate.derivedProjectSha256 !== rederived.projects[key].sha256) {
          throw new Error('F5B_DERIVED_SOURCE_BINDING_MISMATCH');
        }
        sameFiles(candidate.derivedFiles, rederived.projects[key].files);
      } else {
        sameFiles(candidate.derivedFiles, rederived.projects[key].files);
      }
      const derived = new Map(candidate.derivedFiles.map(file => [file.path, file]));
      for (const file of archived.files) {
        const original = derived.get(file.path);
        if (!original || original.sha256 !== file.sha256 || original.size !== file.size) {
          throw new Error('F5B_DERIVED_ARCHIVE_MISMATCH');
        }
      }
    }
    result = { mode, status: 'LOCAL_ARCHIVES_VERIFIED', sourceDigest: linked.sourceDigest,
      releaseReady: false, publicationAllowed: false };
  } catch (error) {
    result = { mode, status: 'BLOCKED', reasonCode: error.message || 'F5B_ARCHIVE_VERIFICATION_FAILED',
      releaseReady: false, publicationAllowed: false };
  } finally {
    try { rederived?.cleanup?.(); }
    catch (error) { result = { mode, status: 'BLOCKED', reasonCode: error.message,
      releaseReady: false, publicationAllowed: false }; }
  }
  return result;
}

/** Create two exclusive target ZIPs and external receipts from one authenticated F5b1 plan. */
export async function buildNarrativePlatformCandidates(plan, paths = {}) {
  const derived = await materializeNarrativePlatformPlatformExport(plan);
  if (derived.status !== 'DERIVED_LOCAL') return { ...derived, partialOutputs: [],
    releaseReady: false, publicationAllowed: false };
  const partialOutputs = [];
  let outputs;
  try {
    outputs = outputAdmission(paths, plan.project, derived.projects);
    const yandex = await buildYandexCandidate({ projectDir: derived.projects.yandex.root,
      outputZip: outputs.yandexZip });
    partialOutputs.push(outputs.yandexZip);
    const vk = await buildVkCandidate({ projectDir: derived.projects.vk.root,
      outputZip: outputs.vkZip });
    partialOutputs.push(outputs.vkZip);
    // Each candidate already passed its own strict packager contract. Inspect
    // the stored ZIP again before linking it to the trusted source digest.
    const yArchive = inspectYandexArchive(outputs.yandexZip);
    const vArchive = inspectVkArchive(outputs.vkZip);
    sameFiles(yandex.files, yArchive.files);
    sameFiles(vk.files, vArchive.files);
    if (yandex.sha256 !== yArchive.sha256 || vk.sha256 !== vArchive.sha256) {
      throw new Error('F5B_ARCHIVE_CHANGED_AFTER_BUILD');
    }
    writeExclusiveJson(outputs.yandexBuildReceipt, yandex, partialOutputs, outputs._parentPins.yandexBuildReceipt);
    writeExclusiveJson(outputs.vkBuildReceipt, vk, partialOutputs, outputs._parentPins.vkBuildReceipt);
    writeExclusiveJson(outputs.exportReceipt, { schemaVersion: 1,
      sourceDigest: derived.sourceDigest, sourceFiles: plan.files,
      candidates: [
        { target: 'yandex-games', derivedProjectSha256: derived.projects.yandex.sha256,
          derivedFiles: derived.projects.yandex.files, assetDerivations: derived.projects.yandex.assetDerivations,
          archivePath: outputs.yandexZip,
          archiveSha256: yandex.sha256, files: yandex.files },
        { target: 'vk-games', derivedProjectSha256: derived.projects.vk.sha256,
          derivedFiles: derived.projects.vk.files, assetDerivations: derived.projects.vk.assetDerivations,
          archivePath: outputs.vkZip,
          archiveSha256: vk.sha256, files: vk.files },
      ],
    }, partialOutputs, outputs._parentPins.exportReceipt);
    const verified = await verifyNarrativePlatformCandidates(outputs, plan);
    if (verified.status !== 'LOCAL_ARCHIVES_VERIFIED' || verified.sourceDigest !== derived.sourceDigest) {
      throw new Error(verified.reasonCode ?? 'F5B_PAIR_VERIFICATION_FAILED');
    }
    return { mode, status: 'CANDIDATES_BUILT_LOCAL', sourceDigest: derived.sourceDigest,
      candidates: { yandex: yandex, vk }, exportReceipt: outputs.exportReceipt,
      releaseReady: false, publicationAllowed: false };
  } catch (error) {
    // Builders try ownership-scoped rollback, but disk errors or concurrent
    // replacement can leave a file they intentionally retain. Report every
    // unexpected residual path; this is not a claim that we own those bytes.
    if (outputs) for (const name of outputNames) {
      const filename = outputs[name];
      if (partialOutputs.includes(filename)) continue;
      try { fs.lstatSync(filename); partialOutputs.push(filename); }
      catch { /* absent or uncertain: never remove it */ }
    }
    return { ...blocked(plan?.project ?? null, error.message || 'F5B_BUILD_FAILED'), partialOutputs,
      releaseReady: false, publicationAllowed: false };
  } finally { derived.cleanup(); }
}
