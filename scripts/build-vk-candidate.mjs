import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { parse as parseHtml } from 'parse5';
import { buildSync } from 'esbuild';
import { defineGame } from '@ludory/core';
import { verifyStudioOrigin } from '@ludory/studio-trust';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const required = [
  'assets/ludory-vk.js', 'assets/vk-bridge.js', 'index.html',
  'licenses/swc-helpers.txt', 'licenses/vk-bridge.txt', 'ludory.project.json', 'src/main.js',
];
const managed = [
  'assets/ludory-vk.js', 'assets/vk-bridge.js',
  'licenses/swc-helpers.txt', 'licenses/vk-bridge.txt',
];
const media = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ogg', '.mp3', '.wav', '.woff2', '.ttf', '.css']);
const maxFileBytes = 25 * 1024 * 1024;
const maxArchiveBytes = 100 * 1024 * 1024;
const maxArchiveFiles = 10_000;
const maxPrettyReceiptBytes = 1024 * 1024;
const safePart = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const windowsDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function validateVkCandidatePath(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/') || name.includes(':') ||
      name.split('/').some(part => !safePart.test(part) || part === '.' || part === '..' ||
        windowsDevice.test(part) || /[. ]$/.test(part))) {
    throw new Error(`Unsafe VK candidate path: ${name}`);
  }
  return name;
}

function readSafe(root, name) {
  validateVkCandidatePath(name);
  let directory = root;
  for (const part of name.split('/').slice(0, -1)) {
    directory = path.join(directory, part);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`VK candidate source directory is not regular: ${name}`);
    }
  }
  const filename = path.join(root, name);
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`VK candidate source must be regular: ${name}`);
  if (!before.size || before.size > maxFileBytes) throw new Error(`VK candidate invalid file size: ${name}`);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const inside = fs.fstatSync(fd);
    if (!inside.isFile() || inside.dev !== before.dev || inside.ino !== before.ino ||
        inside.size !== before.size || inside.mtimeMs !== before.mtimeMs) {
      throw new Error(`VK candidate source changed before read: ${name}`);
    }
    // Never read beyond the admitted stat size if another process grows the source.
    const bytes = Buffer.allocUnsafe(before.size);
    let received = 0;
    while (received < bytes.length) {
      const count = fs.readSync(fd, bytes, received, Math.min(65_536, bytes.length - received), received);
      if (count <= 0) throw new Error(`VK candidate source shrank while reading: ${name}`);
      received += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) !== 0) {
      throw new Error(`VK candidate source grew while reading: ${name}`);
    }
    const after = fs.fstatSync(fd);
    if (after.size !== bytes.length || after.size !== inside.size || after.mtimeMs !== inside.mtimeMs) {
      throw new Error(`VK candidate source changed while reading: ${name}`);
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

function readJson(root, name, read = filename => readSafe(root, filename)) {
  let parsed;
  try { parsed = JSON.parse(read(name).toString('utf8')); }
  catch (error) { throw new Error(`Invalid VK ${name}: ${error.message}`, { cause: error }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid VK ${name}`);
  }
  return parsed;
}

function validateHtmlEntrypoint(html) {
  const errors = [];
  const document = parseHtml(html, { sourceCodeLocationInfo: true, onParseError: e => errors.push(e.code) });
  if (errors.length) throw new Error(`Malformed VK candidate HTML: ${errors.join(', ')}`);
  const htmlNode = document.childNodes.find(node => node.tagName === 'html');
  const body = htmlNode?.childNodes.find(node => node.tagName === 'body');
  const scripts = [];
  let bases = 0;
  const forbiddenTags = new Set(['iframe', 'frame', 'frameset', 'object', 'embed']);
  function visit(node) {
    if (node.tagName === 'script') scripts.push(node);
    if (node.tagName === 'base') bases++;
    if (forbiddenTags.has(node.tagName)) throw new Error(`VK candidate forbids active HTML ${node.tagName}`);
    if (node.tagName === 'meta' && node.attrs?.some(attr =>
      attr.name === 'http-equiv' && attr.value.toLowerCase() === 'refresh')) {
      throw new Error('VK candidate forbids active HTML refresh');
    }
    for (const attr of node.attrs ?? []) {
      if (/^on[a-z]/i.test(attr.name)) throw new Error(`VK candidate forbids HTML event handler: ${attr.name}`);
      if (['href', 'src', 'srcset', 'action', 'formaction', 'data', 'xlink:href'].includes(attr.name) &&
          /^(?:\s*https?:|\s*\/\/|\s*javascript:|\s*data:text\/html)/i.test(attr.value)) {
        throw new Error(`VK candidate forbids active or remote HTML URL in ${attr.name}`);
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(document);
  if (bases) throw new Error('VK candidate forbids HTML base elements');
  if (scripts.length !== 1) throw new Error('VK candidate requires exactly one executable module script');
  const script = scripts[0];
  const attributes = Object.fromEntries(script.attrs.map(attr => [attr.name, attr.value]));
  if (script.parentNode !== body || !script.sourceCodeLocation?.startTag ||
      !script.sourceCodeLocation?.endTag || script.attrs.length !== 2 ||
      attributes.type !== 'module' || attributes.src !== 'src/main.js' || script.childNodes?.length) {
    throw new Error('VK candidate requires one local src/main.js module in body');
  }
}

function validateImports(entry) {
  let imports;
  try {
    const parsed = buildSync({
      stdin: { contents: entry, sourcefile: 'src/main.js', loader: 'js' },
      bundle: true, external: ['*'], metafile: true, write: false, logLevel: 'silent',
    });
    imports = parsed.metafile.inputs['src/main.js'].imports;
  } catch (error) {
    throw new Error(`VK candidate entrypoint cannot be parsed: ${error.message}`, { cause: error });
  }
  const expected = ['../assets/ludory-vk.js', '../assets/vk-bridge.js'];
  const actual = imports.map(item => item.path).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error('VK candidate requires exactly the two executable local SDK/Runtime module imports');
  }
}

function validateGame(root) {
  const origin = verifyStudioOrigin(root);
  if (!origin.ok || origin.project !== root) {
    throw new Error(`VK candidate requires trusted Studio origin: ${origin.code}`);
  }
  const snapshot = new Map();
  const read = name => {
    if (!snapshot.has(name)) snapshot.set(name, readSafe(root, name));
    return snapshot.get(name);
  };
  const game = readJson(root, 'ludory.project.json', read);
  try { defineGame(game); }
  catch (error) { throw new Error(`Invalid VK candidate game manifest: ${error.message}`, { cause: error }); }
  if (!Array.isArray(game.targets) || game.targets.length !== 1 || game.targets[0] !== 'vk-games') {
    throw new Error('VK candidate requires a VK-only target manifest');
  }
  const studio = readJson(root, 'ludory.studio.json', read);
  const components = readJson(root, 'ludory.components.json', read);
  if (studio.template?.id !== 'vk-runtime' || studio.profile?.id !== 'web-game' ||
      components.template?.id !== 'vk-runtime' || components.template?.profile !== 'web-game') {
    throw new Error('VK candidate requires Studio vk-runtime template provenance');
  }
  if (studio.files?.['ludory.project.json'] !== sha256(read('ludory.project.json'))) {
    throw new Error('VK candidate manifest does not match Studio receipt');
  }
  for (const name of managed) {
    const hash = sha256(read(name));
    if (studio.files?.[name] !== hash || components.files?.[name] !== hash) {
      throw new Error(`VK candidate managed bundle/license hash mismatch: ${name}`);
    }
  }
  const html = read('index.html').toString('utf8');
  const entry = read('src/main.js').toString('utf8');
  validateHtmlEntrypoint(html);
  const foreign = /YaGames|sdk\.games\.s3\.yandex\.net|\/sdk\.js|https?:\/\/[^\s'"`]+vk-bridge/i;
  if (foreign.test(html) || foreign.test(entry)) {
    throw new Error('VK candidate contains a foreign or remote SDK reference');
  }
  validateImports(entry);
  return snapshot;
}

function collectMedia(root, directory, found) {
  for (const basename of fs.readdirSync(path.join(root, directory)).sort()) {
    const relative = `${directory}/${basename}`;
    validateVkCandidatePath(relative);
    const stat = fs.lstatSync(path.join(root, relative));
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link in VK candidate assets: ${relative}`);
    if (stat.isDirectory()) {
      collectMedia(root, relative, found);
    } else if (!stat.isFile()) {
      throw new Error(`Non-regular VK candidate asset: ${relative}`);
    } else if (!managed.includes(relative)) {
      if (!media.has(path.posix.extname(relative).toLowerCase())) {
        throw new Error(`Unsupported VK candidate asset: ${relative}`);
      }
      found.push(relative);
    }
  }
}

function rejectLinkedAncestors(filename) {
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`VK output path contains a symbolic ancestor: ${current}`);
    }
  }
}

function safeProjectAndOutput(projectDir, outputZip) {
  if (typeof projectDir !== 'string' || typeof outputZip !== 'string') {
    throw new TypeError('projectDir and outputZip must be paths');
  }
  const project = path.resolve(projectDir);
  const input = fs.lstatSync(project);
  if (!input.isDirectory() || input.isSymbolicLink()) throw new Error('VK game root must be a real directory');
  const root = fs.realpathSync.native(project);
  const output = path.resolve(outputZip);
  const parent = path.dirname(output);
  rejectLinkedAncestors(parent);
  const parentStat = fs.lstatSync(parent, { bigint: true });
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('VK output parent must be a real directory');
  const outputParent = fs.realpathSync.native(parent);
  const relative = path.relative(root, outputParent);
  if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error('VK candidate output must be outside the game project');
  }
  if (fs.existsSync(output)) throw new Error('VK candidate output already exists; refusing overwrite');
  return { root, output, parent, parentStat };
}

function writePinnedOutput({ output, parent, parentStat }, archive) {
  const previousCwd = process.cwd();
  // All source validation has completed. chdir anchors relative opens to the verified
  // directory inode even if its external path is renamed or replaced with a symlink.
  // This operation is wholly synchronous; no JS task can observe an interim cwd.
  try {
    process.chdir(parent);
    const anchored = fs.statSync('.', { bigint: true });
    if (!anchored.isDirectory() || anchored.dev !== parentStat.dev ||
        anchored.ino !== parentStat.ino) {
      throw new Error('VK output parent directory changed before anchored creation');
    }
    const basename = path.basename(output);
    const fd = fs.openSync(basename, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY |
      (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    const owned = fs.fstatSync(fd);
    try {
      fs.writeFileSync(fd, archive);
      fs.fsyncSync(fd);
      const parentNow = fs.lstatSync(parent, { bigint: true });
      if (!parentNow.isDirectory() || parentNow.isSymbolicLink() ||
          parentNow.dev !== anchored.dev || parentNow.ino !== anchored.ino) {
        throw new Error('VK output parent directory changed during archive write');
      }
    } catch (error) {
      try {
        const actual = fs.lstatSync(basename);
        if (actual.isFile() && !actual.isSymbolicLink() && actual.dev === owned.dev && actual.ino === owned.ino &&
            actual.size <= archive.length &&
            fs.readFileSync(basename).equals(archive.subarray(0, actual.size))) {
          fs.unlinkSync(basename);
        }
      } catch { /* Preserve uncertain output for the owner. */ }
      throw error;
    } finally { fs.closeSync(fd); }
  } finally { process.chdir(previousCwd); }
}

/** Local VK candidate only: never a live SDK, rights or Release PASS. */
export async function buildVkCandidate({ projectDir, outputZip } = {}) {
  const destination = safeProjectAndOutput(projectDir, outputZip);
  const { root, output } = destination;
  const snapshot = validateGame(root);
  const assets = [];
  collectMedia(root, 'assets', assets);
  const names = [...required, ...assets].sort();
  if (names.length > maxArchiveFiles) throw new Error('VK candidate exceeds the 10000-file archive limit');
  const folded = new Set(names.map(name => name.toLowerCase()));
  if (folded.size !== names.length) {
    throw new Error('Case-ambiguous duplicate VK candidate asset names');
  }
  for (const name of folded) {
    let prefix = name;
    while (prefix.includes('/')) {
      prefix = prefix.slice(0, prefix.lastIndexOf('/'));
      if (folded.has(prefix)) {
        throw new Error('Case-ambiguous VK candidate file and directory collision');
      }
    }
  }
  let total = 0;
  const entries = {};
  const files = [];
  for (const name of names) {
    const bytes = snapshot.get(name) ?? readSafe(root, name);
    total += bytes.length;
    if (total > maxArchiveBytes) throw new Error('VK candidate exceeds 100 MiB safety bound');
    entries[name] = new Uint8Array(bytes);
    files.push({ path: name, sha256: sha256(bytes), size: bytes.length });
  }
  const archive = Buffer.from(zipSync(entries, { level: 0, mtime: new Date(1980, 0, 1) }));
  if (archive.length > maxArchiveBytes) throw new Error('VK candidate archive exceeds 100 MiB limit');
  const receipt = { archivePath: output, sha256: sha256(archive), files };
  if (Buffer.byteLength(`${JSON.stringify(receipt, null, 2)}\n`) > maxPrettyReceiptBytes) {
    throw new Error('VK candidate receipt exceeds the verifier 1 MiB size limit');
  }
  writePinnedOutput(destination, archive);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--project' || args[2] !== '--output') {
    throw new TypeError('Usage: build-vk-candidate.mjs --project <game-dir> --output <new.zip>');
  }
  process.stdout.write(`${JSON.stringify(await buildVkCandidate({ projectDir: args[1], outputZip: args[3] }), null, 2)}\n`);
}
