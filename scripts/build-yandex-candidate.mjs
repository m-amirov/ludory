import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { parse as parseHtml } from 'parse5';
import { defineGame } from '@ludory/core';
import { verifyStudioOrigin } from '@ludory/studio-trust';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const required = ['assets/ludory-yandex.js', 'index.html', 'ludory.project.json', 'src/main.js'];
const mediaExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ogg', '.mp3', '.wav', '.woff2']);
const maxFileBytes = 25 * 1024 * 1024;
const maxArchiveBytes = 100 * 1024 * 1024;
const safePart = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const windowsDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function safeName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/') || name.includes(':') ||
      name.split('/').some(part => !safePart.test(part) || part === '.' || part === '..' ||
        windowsDevice.test(part) || /[. ]$/.test(part))) {
    throw new Error(`Unsafe Yandex candidate path: ${name}`);
  }
  return name;
}

// Export the same path policy used by filesystem admission for OS-independent tests.
export { safeName as validateYandexCandidatePath };

function validateHtmlSdk(html) {
  const parseErrors = [];
  const document = parseHtml(html, { sourceCodeLocationInfo: true,
    onParseError: issue => parseErrors.push(issue.code) });
  if (parseErrors.length) throw new Error(`Malformed Yandex script HTML: ${parseErrors.join(', ')}`);
  const htmlElement = document.childNodes.find(node => node.tagName === 'html');
  const head = htmlElement?.childNodes.find(node => node.tagName === 'head');
  const body = htmlElement?.childNodes.find(node => node.tagName === 'body');
  const scripts = [];
  function visit(node) {
    if (node.tagName === 'script') scripts.push(node);
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content); // A template script is inert, but must still be counted/rejected.
  }
  visit(document);
  if (scripts.length !== 2) throw new Error('Yandex candidate requires exactly two executable script elements');
  const [sdk, game] = scripts;
  const sdkAttrs = Object.fromEntries(sdk.attrs.map(attr => [attr.name, attr.value]));
  const gameAttrs = Object.fromEntries(game.attrs.map(attr => [attr.name, attr.value]));
  if (sdk.parentNode !== head || game.parentNode !== body ||
      !sdk.sourceCodeLocation?.startTag || !sdk.sourceCodeLocation?.endTag ||
      !game.sourceCodeLocation?.startTag || !game.sourceCodeLocation?.endTag ||
      sdk.attrs.length !== 1 || sdkAttrs.src !== '/sdk.js' ||
      game.attrs.length !== 2 || gameAttrs.src !== 'src/main.js' || gameAttrs.type !== 'module' ||
      sdk.childNodes?.length || game.childNodes?.length) {
    throw new Error('Yandex candidate requires executable /sdk.js in head before the game module');
  }
}

function statRegular(filename, label) {
  const stats = fs.lstatSync(filename);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Yandex candidate ${label} is not a regular file`);
  if (stats.size < 1 || stats.size > maxFileBytes) throw new Error(`Yandex candidate ${label} has an invalid size`);
  return stats;
}

function readSafe(root, name) {
  safeName(name);
  const segments = name.split('/');
  let parent = root;
  for (const part of segments.slice(0, -1)) {
    parent = path.join(parent, part);
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Yandex candidate source directory is not regular: ${name}`);
    }
  }
  const filename = path.join(root, name);
  const before = statRegular(filename, name);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const inside = fs.fstatSync(fd);
    if (!inside.isFile() || inside.dev !== before.dev || inside.ino !== before.ino) {
      throw new Error(`Yandex candidate source changed while reading: ${name}`);
    }
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (after.size !== bytes.length || inside.size !== after.size || inside.mtimeMs !== after.mtimeMs) {
      throw new Error(`Yandex candidate source changed while reading: ${name}`);
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

function readJson(root, name) {
  let data;
  try { data = JSON.parse(readSafe(root, name).toString('utf8')); }
  catch (error) { throw new Error(`Invalid Yandex ${name}: ${error.message}`, { cause: error }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid Yandex ${name}`);
  return data;
}

function collectAssets(root, subdir, found) {
  for (const name of fs.readdirSync(path.join(root, subdir)).sort()) {
    const relative = `${subdir}/${name}`;
    safeName(relative);
    const stat = fs.lstatSync(path.join(root, relative));
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link in Yandex candidate assets: ${relative}`);
    if (stat.isDirectory()) {
      collectAssets(root, relative, found);
      continue;
    }
    if (!stat.isFile()) throw new Error(`Non-regular Yandex candidate asset: ${relative}`);
    if (relative === 'assets/ludory-yandex.js') continue;
    if (name.toLowerCase() === 'sdk.js' || !mediaExtensions.has(path.extname(name).toLowerCase())) {
      throw new Error(`Unsupported or copied sdk.js asset in Yandex candidate: ${relative}`);
    }
    found.push(relative);
  }
}

function validateProject(root) {
  const origin = verifyStudioOrigin(root);
  if (!origin.ok || origin.project !== root) {
    throw new Error(`Yandex candidate requires trusted Studio origin: ${origin.code}`);
  }
  const manifest = readJson(root, 'ludory.project.json');
  try { defineGame(manifest); }
  catch (error) { throw new Error(`Invalid Yandex game manifest: ${error.message}`, { cause: error }); }
  if (!Array.isArray(manifest.targets) || manifest.targets.length !== 1 || manifest.targets[0] !== 'yandex-games') {
    throw new Error('Yandex candidate requires a Yandex-only target manifest');
  }
  const studio = readJson(root, 'ludory.studio.json');
  const components = readJson(root, 'ludory.components.json');
  if (studio.template?.id !== 'yandex-runtime' || studio.profile?.id !== 'web-game' ||
      components.template?.id !== 'yandex-runtime' || components.template?.profile !== 'web-game') {
    throw new Error('Yandex candidate requires Studio yandex-runtime template provenance');
  }
  const originalManifestHash = studio.files?.['ludory.project.json'];
  if (!originalManifestHash || originalManifestHash !== sha256(readSafe(root, 'ludory.project.json'))) {
    throw new Error('Yandex candidate manifest does not match Studio receipt');
  }
  const bundle = readSafe(root, 'assets/ludory-yandex.js');
  if (components.files?.['assets/ludory-yandex.js'] !== sha256(bundle) ||
      studio.files?.['assets/ludory-yandex.js'] !== sha256(bundle)) {
    throw new Error('Yandex candidate managed bundle hash mismatch');
  }
  const html = readSafe(root, 'index.html').toString('utf8');
  const js = readSafe(root, 'src/main.js').toString('utf8');
  validateHtmlSdk(html);
  const foreign = /VKWebAppInit|vk-bridge|vkBridge|vk\.com\/js\/api|sdk\.games\.s3\.yandex\.net/i;
  if (foreign.test(html) || foreign.test(js) || foreign.test(bundle.toString('utf8'))) {
    throw new Error('Yandex candidate contains a foreign/absolute platform SDK reference');
  }
  if (!js.includes("'../assets/ludory-yandex.js'") && !js.includes('"../assets/ludory-yandex.js"')) {
    throw new Error('Yandex game entrypoint does not use its local managed bundle');
  }
  if (fs.existsSync(path.join(root, 'sdk.js'))) throw new Error('Copied sdk.js must never ship in a Yandex candidate');
}

function outsideProject(project, output) {
  const inputStat = fs.lstatSync(project);
  if (!inputStat.isDirectory() || inputStat.isSymbolicLink()) {
    throw new Error('Yandex game root must not be a symbolic link');
  }
  // Match Studio host trust's native physical path representation on Windows.
  const root = fs.realpathSync.native(project);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Yandex game root must be a real directory');
  const parent = path.dirname(output);
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('Yandex output parent must be a real directory');
  const outputParent = fs.realpathSync.native(parent);
  const relative = path.relative(root, outputParent);
  if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))) {
    throw new Error('Yandex output archive must be outside the game project');
  }
  if (fs.existsSync(output)) throw new Error('Yandex candidate output already exists; refusing overwrite');
  return root;
}

/** Local SDK-contract candidate; never a certified Release bundle. */
export async function buildYandexCandidate({ projectDir, outputZip } = {}) {
  if (typeof projectDir !== 'string' || typeof outputZip !== 'string') {
    throw new TypeError('projectDir and outputZip must be paths');
  }
  const output = path.resolve(outputZip);
  const root = outsideProject(path.resolve(projectDir), output);
  validateProject(root);
  const assets = [];
  collectAssets(root, 'assets', assets);
  const names = [...required, ...assets].sort();
  const casefold = names.map(name => name.toLowerCase());
  if (new Set(casefold).size !== names.length) throw new Error('Case-ambiguous duplicate Yandex candidate asset names');
  let total = 0;
  const entries = {};
  const files = [];
  for (const name of names) {
    const bytes = readSafe(root, name);
    total += bytes.length;
    if (total > maxArchiveBytes) throw new Error('Yandex candidate source exceeds 100 MiB safety bound');
    entries[name] = new Uint8Array(bytes);
    files.push({ path: name, sha256: sha256(bytes), size: bytes.length });
  }
  const archive = Buffer.from(zipSync(entries, { level: 0, mtime: new Date(1980, 0, 1) }));
  const hash = sha256(archive);
  // Reading every source and building the ZIP is non-mutating. Only now open an exclusive destination.
  const fd = fs.openSync(output, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY |
    (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  const own = fs.fstatSync(fd);
  try {
    fs.writeFileSync(fd, archive);
    fs.fsyncSync(fd);
  } catch (error) {
    // Only remove bytes that are demonstrably still ours; preserve concurrent user replacements.
    try {
      const found = fs.lstatSync(output);
      if (found.isFile() && !found.isSymbolicLink() && found.dev === own.dev && found.ino === own.ino) {
        const observed = fs.readFileSync(output);
        if (observed.equals(archive.subarray(0, observed.length))) fs.unlinkSync(output);
      }
    } catch { /* retain uncertain output for owner recovery */ }
    throw error;
  } finally { fs.closeSync(fd); }
  return { archivePath: output, sha256: hash, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--project' || args[2] !== '--output') {
    throw new TypeError('Usage: build-yandex-candidate.mjs --project <game-dir> --output <new.zip>');
  }
  process.stdout.write(`${JSON.stringify(await buildYandexCandidate({ projectDir: args[1], outputZip: args[3] }), null, 2)}\n`);
}
