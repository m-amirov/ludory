import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildSync, transformSync } from 'esbuild';
import { parse, parseFragment, serialize } from 'parse5';
import { loadCatalog } from './catalog.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const SDK = Object.freeze({
  'yandex-games': '../assets/ludory-yandex.js',
  'vk-games': '../assets/ludory-vk.js',
});

const bootstraps = {
  'yandex-games': `
import { createYandexConnector, createYandexLifecycle, createYandexPlayerStorage } from '../assets/ludory-yandex.js';
import { startNarrative } from './main.js';
const indicator = document.querySelector('#status');
const connector = createYandexConnector({ sdkLoader: async () => {
  if (typeof globalThis.YaGames?.init !== 'function') throw new Error('Yandex SDK is not loaded');
  return globalThis.YaGames;
} });
let lifecycle;
void startNarrative({ platform: { async prepare(game) {
  const { sdk } = await connector.initialize();
  return {
    storage: createYandexPlayerStorage({ getPlayer: () => sdk.getPlayer(), namespace: game.id }),
    attach(host) { lifecycle = createYandexLifecycle({ sdk, host }); lifecycle.attach(); },
    async ready() { if (await lifecycle.markReady() !== true) throw lifecycle.getLastError() ?? new Error('Yandex LoadingAPI.ready failed'); },
    async dispose() { lifecycle?.detach(); await connector.destroy(); },
  };
} } }).then(() => { indicator.dataset.sdkReady = 'true'; }).catch(error => {
  delete indicator.dataset.sdkReady;
  indicator.dataset.errorCode = error.code ?? 'ERROR';
  indicator.textContent = error.message;
});
`,
  'vk-games': `
import { createVkConnector, createVkLifecycle, createVkStorage } from '../assets/ludory-vk.js';
import bridge from '../assets/vk-bridge.js';
import { startNarrative } from './main.js';
const indicator = document.querySelector('#status');
const connector = createVkConnector({ bridgeLoader: async () => bridge });
let lifecycle;
void startNarrative({ platform: { async prepare(game) {
  const { bridge: connected } = await connector.initialize();
  return {
    storage: createVkStorage({ bridge: connected, namespace: game.id }),
    attach(host) { lifecycle = createVkLifecycle({ bridge: connected, host });
      if (!lifecycle.attach()) throw lifecycle.getLastError() ?? new Error('VK lifecycle attach failed'); },
    async ready() {},
    async dispose() { lifecycle?.detach(); await connector.destroy(); },
  };
} } }).then(() => { indicator.dataset.sdkReady = 'true'; }).catch(error => {
  delete indicator.dataset.sdkReady;
  indicator.dataset.errorCode = error.code ?? 'ERROR';
  indicator.textContent = error.message;
});
`,
};

function regular(root, relative) {
  const full = path.join(root, relative);
  const stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 25 * 1024 * 1024) {
    throw new Error(`F5B_UNSAFE_AUTHOR_FILE: ${relative}`);
  }
  return fs.readFileSync(full);
}

// F5b2 copies only supported assets/ media, not arbitrary authored HTML
// dependencies. Reject unsupported references before producing either ZIP.
const htmlMediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ogg', '.mp3', '.wav', '.woff2', '.ttf', '.css']);
const htmlUrlAttributes = new Set([
  'href', 'src', 'srcset', 'poster', 'action', 'formaction', 'data', 'xlink:href',
  'ping', 'background', 'cite', 'manifest',
]);
const forbiddenHtmlElements = new Set(['base', 'link', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form']);

function safeHtmlMedia(value) {
  if (!/^(?:\.\/)?assets\/[a-z0-9][a-z0-9._/-]*$/i.test(value)) return false;
  const segments = value.replace(/^\.\//, '').split('/');
  return segments.every(segment => /^[a-z0-9][a-z0-9._-]*$/i.test(segment) &&
    segment !== '.' && segment !== '..' && !/[. ]$/.test(segment)) &&
    htmlMediaExtensions.has(path.posix.extname(value).toLowerCase());
}

function checkHtmlCss(css) {
  // CSS escapes can disguise resource-loading functions, so until a CSS
  // dependency packager exists only self-contained declarations are allowed.
  if (/\\|@import\b|\burl\s*\(|(?:-webkit-)?image-set\s*\(/i.test(css)) {
    throw new Error('F5B_REMOTE_OR_ACTIVE_HTML_FORBIDDEN');
  }
}

function checkAuthorHtmlResources(document) {
  function walk(node) {
    const tag = node.tagName;
    if (forbiddenHtmlElements.has(tag) ||
        (tag === 'meta' && node.attrs?.some(attr =>
          attr.name === 'http-equiv' && attr.value.trim().toLowerCase() === 'refresh'))) {
      throw new Error('F5B_UNSUPPORTED_AUTHOR_HTML_RESOURCE');
    }
    if (tag === 'style') {
      for (const child of node.childNodes ?? []) checkHtmlCss(child.value ?? '');
    }
    for (const attr of node.attrs ?? []) {
      if (/^on[a-z]/i.test(attr.name)) throw new Error('F5B_REMOTE_OR_ACTIVE_HTML_FORBIDDEN');
      if (attr.name === 'style') checkHtmlCss(attr.value);
      if (!htmlUrlAttributes.has(attr.name)) continue;
      if (tag === 'script' && attr.name === 'src' && attr.value === 'src/entry.js') continue;
      if (tag === 'a' && attr.name === 'href' && /^#[a-z0-9_-]+$/i.test(attr.value)) continue;
      if (['src', 'poster'].includes(attr.name) &&
          ['img', 'audio', 'video', 'source'].includes(tag) && safeHtmlMedia(attr.value)) continue;
      throw new Error('F5B_UNSUPPORTED_AUTHOR_HTML_RESOURCE');
    }
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  }
  walk(document);
}

function originalHtml(root, target) {
  const html = regular(root, 'index.html').toString('utf8');
  if (/https?:\/\/|(?:<base\b)|(?:<iframe\b)/i.test(html)) throw new Error('F5B_REMOTE_OR_ACTIVE_HTML_FORBIDDEN');
  const errors = [];
  const document = parse(html, { onParseError: e => errors.push(e.code) });
  if (errors.length) throw new Error('F5B_INVALID_AUTHOR_HTML');
  checkAuthorHtmlResources(document);
  const rootNode = document.childNodes.find(node => node.tagName === 'html');
  const head = rootNode?.childNodes.find(node => node.tagName === 'head');
  const body = rootNode?.childNodes.find(node => node.tagName === 'body');
  if (!head || !body) throw new Error('F5B_INVALID_AUTHOR_HTML');
  const scripts = [];
  function walk(node) {
    if (node.tagName === 'script') scripts.push(node);
    for (const child of node.childNodes ?? []) walk(child);
  }
  walk(document);
  const source = scripts[0];
  const attributes = source ? Object.fromEntries(source.attrs.map(attr => [attr.name, attr.value])) : {};
  if (scripts.length !== 1 || source.parentNode !== body || source.attrs.length !== 2 ||
      attributes.type !== 'module' || attributes.src !== 'src/entry.js' || source.childNodes?.length) {
    throw new Error('F5B_NARRATIVE_HTML_ENTRY_REQUIRED');
  }
  source.attrs.find(attr => attr.name === 'src').value = 'src/main.js';
  if (target === 'yandex-games') {
    const sdk = parseFragment('<script src="/sdk.js"></script>').childNodes[0];
    sdk.parentNode = head;
    head.childNodes.push(sdk);
  }
  return Buffer.from(serialize(document));
}

function normalizedSourcePath(value) {
  return value.replaceAll('\\', '/');
}

function resolveSourceDependency(owner, specifier) {
  const split = specifier.match(/^([^?#]*)([?#].*)?$/);
  const rawPath = split?.[1] ?? specifier;
  const suffix = split?.[2] ?? '';
  if (!rawPath || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(rawPath)) return null;
  let decoded;
  try { decoded = decodeURIComponent(rawPath); }
  catch { return null; }
  if (/%2f|%5c/i.test(rawPath) || decoded.includes('\\') || decoded.includes('\0') ||
      /[\x00-\x1f\x7f]/.test(decoded) || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(decoded)) return null;
  const resolved = path.posix.normalize(decoded.startsWith('/')
    ? decoded.slice(1) : path.posix.join(path.posix.dirname(owner), decoded));
  if (resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) return null;
  return { path: resolved, suffix };
}

function outputAssetSpecifier(target) {
  const relative = path.posix.relative('src', target);
  if (!relative || relative.startsWith('/') || relative === '..' || relative.startsWith('../')) {
    return relative || path.posix.basename(target);
  }
  return relative;
}

function rewriteSourceModuleAssetUrls(source, owner, assetPathMap) {
  const mappings = assetPathMap instanceof Map ? assetPathMap : new Map();
  const rewriteSpecifier = (full, specifier) => {
    const resolved = resolveSourceDependency(owner, specifier);
    const target = mappings.get(resolved?.path);
    return target ? full.replace(specifier, `${outputAssetSpecifier(target)}${resolved.suffix}`) : full;
  };
  let output = source.replace(/new\s+URL\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*,?\s*\)/g,
    (full, _quote, specifier) => rewriteSpecifier(full, specifier));
  output = output.replace(/new\s+URL\s*\(\s*`([^`$]*)`\s*,\s*import\.meta\.url\s*,?\s*\)/g,
    (full, specifier) => rewriteSpecifier(full, specifier));
  output = output.replace(/new\s+URL\s*\(\s*`([^`$]*)\$\{([^}]*)\}`\s*,\s*import\.meta\.url\s*,?\s*\)/g,
    (full, prefix, expression) => {
      const resolved = resolveSourceDependency(owner, prefix);
      const sourceDirectory = resolved?.path?.replace(/\/+$/, '');
      if (!sourceDirectory) return full;
      const mapping = [...mappings.entries()].find(([from]) => from.startsWith(`${sourceDirectory}/`));
      if (!mapping) return full;
      const sourceParts = sourceDirectory.split('/');
      const mappedSourceParts = mapping[0].split('/');
      const sourceSuffixLength = mappedSourceParts.length - sourceParts.length;
      const targetParts = mapping[1].split('/');
      if (sourceSuffixLength < 1 || targetParts.length <= sourceSuffixLength) return full;
      const targetDirectory = targetParts.slice(0, -sourceSuffixLength).join('/');
      return full.replace(prefix, `${outputAssetSpecifier(targetDirectory)}/`);
    });
  return output;
}

function stagedCompileRoot(root, inputs, assetPathMap) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f5b2-compile-'));
  try {
    for (const name of inputs) {
      if (name === '<stdin>' || name === 'src/f5b2-platform-entry.js') continue;
      const relative = normalizedSourcePath(name);
      const destination = path.join(staging, ...relative.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const bytes = regular(root, relative);
      const transformed = /\.(?:js|mjs)$/i.test(relative)
        ? Buffer.from(rewriteSourceModuleAssetUrls(bytes.toString('utf8'), relative, assetPathMap))
        : bytes;
      fs.writeFileSync(destination, transformed);
    }
    return staging;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Compile exact pinned author JS into a single SDK entry, excluding other executable ZIP members. */
export function compileNarrativePlatformEntrypoint({ sourceRoot, target, assetPathMap } = {}) {
  if (!Object.hasOwn(SDK, target)) throw new Error('F5B_INVALID_TARGET');
  const root = fs.realpathSync.native(sourceRoot);
  if (!fs.lstatSync(root).isDirectory()) throw new Error('F5B_SOURCE_NOT_DIRECTORY');
  const entry = regular(root, 'src/main.js');
  const story = regular(root, 'src/story.js');
  // Until browser-level contract attestation exists, only the canonical,
  // adapter-aware launcher can be safely admitted. Author story modules remain
  // editable; an altered launcher is blocked rather than silently rebuilt.
  const templateEntry = loadCatalog().templates.get('narrative-interactive').assets.get('src/main.js').bytes;
  if (!entry.equals(templateEntry)) throw new Error('F5B_AUTHOR_ENTRY_CONTRACT_UNVERIFIED');
  const build = buildRoot => buildSync({
    stdin: { contents: bootstraps[target], resolveDir: path.join(buildRoot, 'src'), sourcefile: 'f5b2-platform-entry.js', loader: 'js' },
    bundle: true, platform: 'browser', target: 'es2022', format: 'esm', write: false,
    external: target === 'yandex-games' ? [SDK[target]] : [SDK[target], '../assets/vk-bridge.js'],
    absWorkingDir: buildRoot, metafile: true, minify: false, logLevel: 'silent',
  });
  let built = build(root);
  if (built.warnings.length) throw new Error(`F5B_AUTHOR_ENTRY_EXPORT_REQUIRED: ${built.warnings[0].text}`);
  const originalInputs = Object.keys(built.metafile.inputs);
  for (const name of originalInputs) {
    // esbuild records its virtual stdin as the declared sourcefile under resolveDir.
    if (name === '<stdin>' || name === 'src/f5b2-platform-entry.js') continue;
    const full = path.resolve(root, name);
    const relative = path.relative(root, full);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
        !fs.realpathSync.native(full).startsWith(`${root}${path.sep}`)) {
      throw new Error(`F5B_FOREIGN_AUTHOR_IMPORT: ${name}`);
    }
    const bytes = regular(root, relative);
    if ((relative.endsWith('.js') || relative.endsWith('.mjs')) &&
        relative !== 'assets/ludory-narrative.js') {
      // esbuild's import metadata excludes computed import(variable) expressions.
      // Normalize syntax first so comments cannot hide the import keyword.
      const normalized = transformSync(bytes.toString('utf8'), { loader: 'js',
        format: 'esm', minifyWhitespace: true, legalComments: 'none' }).code;
      if (/\bimport\s*\(/.test(normalized)) throw new Error(`F5B_DYNAMIC_AUTHOR_IMPORT_FORBIDDEN: ${relative}`);
    }
  }
  if (built.outputFiles.length !== 1) throw new Error('F5B_UNEXPECTED_BUNDLE_OUTPUT');
  let staging;
  try {
    if (assetPathMap instanceof Map && assetPathMap.size) {
      staging = stagedCompileRoot(root, originalInputs, assetPathMap);
      built = build(staging);
      if (built.warnings.length) throw new Error(`F5B_AUTHOR_ENTRY_EXPORT_REQUIRED: ${built.warnings[0].text}`);
      if (JSON.stringify(Object.keys(built.metafile.inputs).sort()) !== JSON.stringify([...originalInputs].sort())) {
        throw new Error('F5B_AUTHOR_ENTRY_EXPORT_GRAPH_CHANGED');
      }
    }
    const compiled = Buffer.from(built.outputFiles[0].contents);
    const imports = Object.values(built.metafile.outputs).flatMap(output => output.imports)
      .filter(item => item.external).map(item => item.path).sort();
    const allowed = (target === 'yandex-games' ? [SDK[target]] : [SDK[target], '../assets/vk-bridge.js']).sort();
    if (JSON.stringify(imports) !== JSON.stringify(allowed)) {
      throw new Error('F5B_FOREIGN_OR_DYNAMIC_AUTHOR_IMPORT');
    }
    return { entryBytes: compiled, htmlBytes: originalHtml(root, target),
      authorEntrySha256: digest(entry), authorStorySha256: digest(story) };
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
  }
}
