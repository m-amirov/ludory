import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyStudioOrigin } from '@ludory/studio-trust';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const publicRoots = new Set(['src', 'assets', 'media', 'images', 'audio', 'sounds', 'fonts']);
const publicExt = new Set([
  '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif',
  '.gif', '.ico', '.ogg', '.mp3', '.wav', '.woff', '.woff2', '.webm', '.mp4',
]);
const maxFiles = 10_000;
const maxFileSize = 25 * 1024 * 1024;
const maxBytes = 150 * 1024 * 1024;
const privateName = name => !name || name.startsWith('.') || name.endsWith('~') ||
  /[\\:\0]/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

function blocked(project, target, reasonCode) {
  return { mode: 'preview-build', project, target, status: 'BLOCKED', reasonCode, writes: [] };
}

function safeFile(root, relative) {
  const parts = relative.split('/');
  if (parts.some(privateName)) throw new Error('PREVIEW_SOURCE_UNSAFE');
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory()) ||
      (index === parts.length - 1 && (!stat.isFile() || stat.nlink !== 1n))) {
      throw new Error('PREVIEW_SOURCE_UNSAFE');
    }
  }
  const filename = path.join(root, ...parts);
  const before = fs.lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.size > BigInt(maxFileSize) || before.size === 0n) {
    throw new Error('PREVIEW_SOURCE_UNSAFE');
  }
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size || opened.mtimeNs !== before.mtimeNs ||
        opened.nlink !== 1n) throw new Error('PREVIEW_SOURCE_CHANGED');
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(filename, { bigint: true });
    if (BigInt(bytes.length) !== before.size || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || named.dev !== before.dev || named.ino !== before.ino ||
        named.mtimeNs !== before.mtimeNs) throw new Error('PREVIEW_SOURCE_CHANGED');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function listedFiles(project) {
  const names = ['index.html', 'ludory.project.json'];
  if (fs.existsSync(path.join(project, 'narrative-assets.json'))) names.push('narrative-assets.json');
  // The opt-in economy template intentionally stores its author-editable
  // runtime configuration under config/. Only these two non-secret documents
  // are browser assets; never expose the entire private config directory.
  if (fs.existsSync(path.join(project, 'ludory.components.json'))) {
    const components = JSON.parse(safeFile(project, 'ludory.components.json').toString('utf8'));
    if (components?.template?.id === 'narrative-economy') {
      names.push('config/economy.json', 'config/premium.json');
    }
  }
  let total = 0;
  function descend(directory, prefix, depth) {
    if (depth > 24) throw new Error('PREVIEW_SOURCE_UNSAFE');
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (privateName(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('PREVIEW_SOURCE_UNSAFE');
      if (entry.isDirectory() && entry.name !== '__tests__') {
        descend(path.join(directory, entry.name), relative, depth + 1);
      } else if (entry.isFile() && !/(?:\.test|\.spec)\.m?js$/i.test(entry.name) &&
                 publicExt.has(path.extname(entry.name).toLowerCase())) {
        names.push(relative);
        if (++total > maxFiles) throw new Error('PREVIEW_SOURCE_TOO_LARGE');
      }
    }
  }
  for (const root of publicRoots) {
    const directory = path.join(project, root);
    if (!fs.existsSync(directory)) continue;
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PREVIEW_SOURCE_UNSAFE');
    descend(directory, root, 1);
  }
  return names.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

function localDependency(specifier, owner, known) {
  if (!specifier || specifier.startsWith('#') || /^(?:https?:|data:|blob:|mailto:|tel:|\/\/)/i.test(specifier)) {
    return;
  }
  if (/^[a-z][\w+.-]*:/i.test(specifier)) throw new Error('PREVIEW_ASSET_UNSAFE');
  const clean = specifier.split(/[?#]/, 1)[0];
  let decoded;
  try { decoded = decodeURIComponent(clean); }
  catch { throw new Error('PREVIEW_ASSET_UNSAFE'); }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.startsWith('//')) {
    throw new Error('PREVIEW_ASSET_UNSAFE');
  }
  const resolved = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) :
    path.posix.join(path.posix.dirname(owner), decoded));
  if (resolved.split('/').some(privateName) || !known.has(resolved)) {
    throw new Error('PREVIEW_ASSET_MISSING');
  }
}

function validateDependencies(files, read, { requireNarrativeProof = false } = {}) {
  const known = new Set(files);
  if (requireNarrativeProof && !known.has('narrative-assets.json')) {
    throw new Error('PREVIEW_ASSET_PROOF_MISSING');
  }
  for (const name of files) {
    const ext = path.extname(name).toLowerCase();
    if (name === 'narrative-assets.json') {
      let data;
      try { data = JSON.parse(read(name).toString('utf8')); }
      catch { throw new Error('PREVIEW_ASSET_MANIFEST_INVALID'); }
      if (data?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(data.storySha256) ||
          !known.has('src/story.js') || sha256(read('src/story.js')) !== data.storySha256 ||
          !data.assets || typeof data.assets !== 'object' || Array.isArray(data.assets)) {
        throw new Error('PREVIEW_ASSET_MANIFEST_INVALID');
      }
      const provedPaths = new Set();
      for (const [id, asset] of Object.entries(data.assets)) {
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id) || typeof asset?.path !== 'string' ||
            !/^assets\/[a-z0-9_-]+\.(?:svg|png|webp|jpg|jpeg)$/.test(asset.path) ||
            !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('PREVIEW_ASSET_MANIFEST_INVALID');
        localDependency(asset.path, 'index.html', known);
        if (sha256(read(asset.path)) !== asset.sha256) throw new Error('PREVIEW_ASSET_PROOF_MISMATCH');
        provedPaths.add(asset.path);
      }
      if (requireNarrativeProof) {
        // The presentation contract only accepts local raster paths under assets/.
        // Require every shipped raster to be attested, even when authored story.js
        // contains dynamic data that must never be executed during preview planning.
        for (const candidate of files) {
          if (/^assets\/.*\.(?:png|webp|jpg|jpeg)$/i.test(candidate) && !provedPaths.has(candidate)) {
            throw new Error('PREVIEW_ASSET_PROOF_MISSING');
          }
        }
      }
      continue;
    }
    if (!['.html', '.js', '.mjs', '.css'].includes(ext)) continue;
    const source = read(name).toString('utf8');
    if (ext === '.html') {
      for (const match of source.matchAll(/\b(?:src|href|poster)\s*=\s*['"]([^'"]+)['"]/gi)) {
        localDependency(match[1], name, known);
      }
      for (const match of source.matchAll(/\bsrcset\s*=\s*['"]([^'"]+)['"]/gi)) {
        for (const candidate of match[1].split(',')) {
          localDependency(candidate.trim().split(/\s+/)[0], name, known);
        }
      }
    }
    if (ext === '.js' || ext === '.mjs' || ext === '.html') {
      for (const match of source.matchAll(/(?:^|[;\n])\s*(?:import|export)\s+(?:[\s\S]{0,8192}?\bfrom\s*)?['"]([^'"\n]+)['"]/g)) {
        localDependency(match[1], name, known);
      }
      for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        localDependency(match[1], name, known);
      }
      for (const match of source.matchAll(/\bfetch\s*\(\s*['"]([^'"]+)['"]/g)) {
        localDependency(match[1], 'index.html', known);
      }
      const moduleRelativeLiterals = new Set();
      for (const match of source.matchAll(/\bnew\s+URL\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url/g)) {
        localDependency(match[2], name, known);
        moduleRelativeLiterals.add(match.index + match[0].indexOf(match[1]));
      }
      // Game artwork paths are resolved relative to document URL by img.src,
      // even when the literal appears in a JS module under src/.
      if (name.startsWith('src/')) {
        for (const match of source.matchAll(/['"]((?:\.\/)?(?:assets|media|images|audio|sounds|fonts)\/[^'"\s]+\.(?:json|svg|png|jpg|jpeg|webp|avif|gif|ogg|mp3|wav|webm|mp4|woff2?))['"]/gi)) {
          if (!moduleRelativeLiterals.has(match.index)) localDependency(match[1], 'index.html', known);
        }
      }
    }
    if (ext === '.css' || ext === '.html') {
      for (const match of source.matchAll(/\burl\s*\(\s*['"]?([^\s)'"]+)/gi)) {
        localDependency(match[1], name, known);
      }
      for (const match of source.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'"\s;)]+)/gi)) {
        localDependency(match[1], name, known);
      }
    }
  }
}

function snapshot(project, target) {
  const origin = verifyStudioOrigin(project);
  if (!origin.ok) throw new Error(origin.code);
  const rootStat = fs.lstatSync(project, { bigint: true });
  const rootIdentity = `${rootStat.dev}:${rootStat.ino}`;
  const names = listedFiles(project);
  let total = 0;
  const data = new Map();
  for (const name of names) {
    const bytes = safeFile(project, name);
    total += bytes.length;
    if (total > maxBytes) throw new Error('PREVIEW_SOURCE_TOO_LARGE');
    data.set(name, bytes);
  }
  const manifest = JSON.parse(data.get('ludory.project.json').toString('utf8'));
  if (target !== 'web' && !manifest.targets?.includes(target === 'vk' ? 'vk-games' : 'yandex-games')) {
    throw new Error('PREVIEW_TARGET_NOT_DECLARED');
  }
  const components = JSON.parse(safeFile(project, 'ludory.components.json').toString('utf8'));
  validateDependencies(names, name => data.get(name), {
    requireNarrativeProof: components?.template?.id === 'narrative-interactive',
  });
  // Each file's fd check alone cannot catch a preceding file changing while
  // a later one is read. Recheck the whole captured inventory and content.
  if (JSON.stringify(listedFiles(project)) !== JSON.stringify(names)) {
    throw new Error('PREVIEW_SOURCE_CHANGED');
  }
  for (const name of names) {
    let fresh;
    try { fresh = safeFile(project, name); }
    catch { throw new Error('PREVIEW_SOURCE_CHANGED'); }
    if (!fresh.equals(data.get(name))) throw new Error('PREVIEW_SOURCE_CHANGED');
  }
  const after = fs.lstatSync(project, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink() || `${after.dev}:${after.ino}` !== rootIdentity ||
      !verifyStudioOrigin(project).ok) throw new Error('PREVIEW_SOURCE_CHANGED');
  const files = names.map(name => ({ path: name, sha256: sha256(data.get(name)), size: data.get(name).length }));
  const sourceDigest = sha256(Buffer.from(JSON.stringify(files)));
  return { rootIdentity, sourceDigest, files, data };
}

export function planPreviewBuild(projectDir, { target = 'web' } = {}) {
  const project = path.resolve(projectDir);
  if (!['web', 'yandex', 'vk'].includes(target)) return blocked(project, target, 'PREVIEW_TARGET_INVALID');
  try {
    const { rootIdentity, sourceDigest, files } = snapshot(project, target);
    return { mode: 'preview-build', status: 'READY', project, target, rootIdentity,
      sourceDigest, files, writes: [] };
  } catch (error) {
    return blocked(project, target, error.code === 'ENOENT' ? 'PREVIEW_ASSET_MISSING' : error.message);
  }
}

export function buildPreview(plan, { tempRoot = os.tmpdir() } = {}) {
  if (plan?.mode !== 'preview-build' || plan.status !== 'READY') {
    return blocked(plan?.project ?? null, plan?.target ?? null, 'PREVIEW_PLAN_INVALID');
  }
  let directory;
  try {
    const fresh = snapshot(plan.project, plan.target);
    if (fresh.sourceDigest !== plan.sourceDigest || fresh.rootIdentity !== plan.rootIdentity ||
        JSON.stringify(fresh.files) !== JSON.stringify(plan.files)) {
      throw new Error('PREVIEW_SOURCE_CHANGED');
    }
    directory = fs.mkdtempSync(path.join(tempRoot, 'ludory-preview-'));
    const ownership = fs.lstatSync(directory, { bigint: true });
    for (const { path: name } of fresh.files) {
      const filename = path.join(directory, ...name.split('/'));
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, fresh.data.get(name), { flag: 'wx', mode: 0o600 });
    }
    const cleanup = () => {
      let now;
      try { now = fs.lstatSync(directory, { bigint: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== ownership.dev || now.ino !== ownership.ino) {
        throw new Error('PREVIEW_TEMP_OWNERSHIP_CHANGED');
      }
      fs.rmSync(directory, { recursive: true });
    };
    return { mode: 'preview-build', status: 'BUILT', root: directory, files: fresh.files,
      sourceDigest: fresh.sourceDigest, buildSha256: fresh.sourceDigest, cleanup };
  } catch (error) {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    return blocked(plan.project, plan.target, error.code === 'ENOENT' ? 'PREVIEW_SOURCE_CHANGED' : error.message);
  }
}
