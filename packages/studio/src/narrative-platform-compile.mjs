import fs from 'node:fs';
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

function originalHtml(root, target) {
  const html = regular(root, 'index.html').toString('utf8');
  if (/https?:\/\/|(?:<base\b)|(?:<iframe\b)/i.test(html)) throw new Error('F5B_REMOTE_OR_ACTIVE_HTML_FORBIDDEN');
  const errors = [];
  const document = parse(html, { onParseError: e => errors.push(e.code) });
  if (errors.length) throw new Error('F5B_INVALID_AUTHOR_HTML');
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

/** Compile exact pinned author JS into a single SDK entry, excluding other executable ZIP members. */
export function compileNarrativePlatformEntrypoint({ sourceRoot, target } = {}) {
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
  // Build with a canonical root so all resolved authored JS can be audited.
  const built = buildSync({
    stdin: { contents: bootstraps[target], resolveDir: path.join(root, 'src'), sourcefile: 'f5b2-platform-entry.js', loader: 'js' },
    bundle: true, platform: 'browser', target: 'es2022', format: 'esm', write: false,
    external: target === 'yandex-games' ? [SDK[target]] : [SDK[target], '../assets/vk-bridge.js'],
    absWorkingDir: root, metafile: true, minify: false, logLevel: 'silent',
  });
  if (built.warnings.length) throw new Error(`F5B_AUTHOR_ENTRY_EXPORT_REQUIRED: ${built.warnings[0].text}`);
  for (const name of Object.keys(built.metafile.inputs)) {
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
  const compiled = Buffer.from(built.outputFiles[0].contents);
  const imports = Object.values(built.metafile.outputs).flatMap(output => output.imports)
    .filter(item => item.external).map(item => item.path).sort();
  const allowed = (target === 'yandex-games' ? [SDK[target]] : [SDK[target], '../assets/vk-bridge.js']).sort();
  if (JSON.stringify(imports) !== JSON.stringify(allowed)) {
    throw new Error('F5B_FOREIGN_OR_DYNAMIC_AUTHOR_IMPORT');
  }
  return { entryBytes: compiled, htmlBytes: originalHtml(root, target),
    authorEntrySha256: digest(entry), authorStorySha256: digest(story) };
}
