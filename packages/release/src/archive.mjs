import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ReleaseInputError } from './errors.mjs';

export const SHA_256 = /^[a-f0-9]{64}$/;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 10_000;
const REQUIRED = ['assets/ludory-yandex.js', 'index.html', 'ludory.project.json', 'src/main.js'];
const MEDIA = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ogg', '.mp3', '.wav', '.woff2']);
const VALID_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});
const fail = (code, message) => { throw new ReleaseInputError(code, message); };

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function safeArchiveName(name) {
  if (!name || typeof name !== 'string' || name.includes('\\') || name.startsWith('/') || name.includes(':') ||
      name.split('/').some(part => !VALID_PART.test(part) || part === '.' || part === '..' ||
        DEVICE.test(part) || /[. ]$/.test(part))) {
    fail('ARCHIVE_UNSAFE_PATH', `Unsafe archive entry path: ${JSON.stringify(name)}`);
  }
  return name;
}

/** Rejects symbolic parents, symlinks, special files, and changed input while reading. */
export function readRegularBytes(filename, limit = 1024 * 1024) {
  if (typeof filename !== 'string' || !filename.trim()) fail('INPUT_MISSING', 'Missing input file path');
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    let st;
    try { st = fs.lstatSync(current); }
    catch (error) { fail(error.code === 'ENOENT' ? 'INPUT_MISSING' : 'INPUT_UNREADABLE', `Cannot inspect input: ${error.message}`); }
    if (st.isSymbolicLink()) fail('INPUT_SYMLINK', `Symbolic link forbidden in input path: ${current}`);
  }
  const before = fs.lstatSync(absolute);
  if (!before.isFile()) fail('INPUT_NOT_REGULAR', 'Input must be a regular file');
  if (before.size === 0 || before.size > limit) fail('INPUT_SIZE', `Input must be between 1 and ${limit} bytes`);
  let fd;
  try { fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); }
  catch (error) { fail('INPUT_UNREADABLE', `Cannot open input: ${error.message}`); }
  try {
    const open = fs.fstatSync(fd);
    if (!open.isFile() || open.dev !== before.dev || open.ino !== before.ino ||
        open.size !== before.size || open.mtimeMs !== before.mtimeMs || open.size > limit) {
      fail('INPUT_CHANGED', 'Input changed between stat and open or exceeded size limit');
    }
    // The opened descriptor can grow at any point; never read more than the preflight bound.
    const bytes = Buffer.allocUnsafe(before.size);
    let received = 0;
    while (received < bytes.length) {
      const count = fs.readSync(fd, bytes, received, Math.min(65536, bytes.length - received), received);
      if (count <= 0) fail('INPUT_CHANGED', 'Input shrank while reading');
      received += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) !== 0) {
      fail('INPUT_CHANGED', 'Input grew while reading');
    }
    const after = fs.fstatSync(fd);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      fail('INPUT_CHANGED', 'Input changed while reading');
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

function checkRange(bytes, offset, size, end = bytes.length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 ||
      offset > end || size > end - offset) fail('ARCHIVE_TRUNCATED', 'ZIP entry or directory exceeds file bounds');
}

/** Narrow ZIP reader: C5 emits stored, single-volume ZIPs without extensions or comments. */
export function inspectYandexArchive(archivePath) {
  const bytes = readRegularBytes(archivePath, MAX_ARCHIVE_BYTES);
  if (bytes.length < 22 || bytes.readUInt32LE(bytes.length - 22) !== 0x06054b50) {
    fail('ARCHIVE_EOCD', 'ZIP end-of-central-directory is missing or has an unsupported comment');
  }
  const end = bytes.length - 22;
  const count = bytes.readUInt16LE(end + 10);
  const centralLength = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) ||
      bytes.readUInt16LE(end + 8) !== count || bytes.readUInt16LE(end + 20) ||
      count === 0 || count === 0xffff || count > MAX_FILES ||
      centralLength === 0xffffffff || centralOffset === 0xffffffff) {
    fail('ARCHIVE_UNSUPPORTED', 'Multipart ZIP, ZIP64, empty ZIP or ZIP comments are unsupported');
  }
  checkRange(bytes, centralOffset, centralLength, end);
  if (centralOffset + centralLength !== end) fail('ARCHIVE_LAYOUT', 'Unexpected bytes after central directory');

  const records = [];
  const unique = new Set();
  let offset = centralOffset;
  let totalSize = 0;
  for (let i = 0; i < count; i++) {
    checkRange(bytes, offset, 46, end);
    if (bytes.readUInt32LE(offset) !== 0x02014b50) fail('ARCHIVE_CENTRAL', 'Invalid central-directory record');
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const external = bytes.readUInt32LE(offset + 38);
    const unixType = (external >>> 16) & 0xf000;
    const crc32 = bytes.readUInt32LE(offset + 16);
    const compressed = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLen = bytes.readUInt16LE(offset + 28);
    const extraLen = bytes.readUInt16LE(offset + 30);
    const commentLen = bytes.readUInt16LE(offset + 32);
    const disk = bytes.readUInt16LE(offset + 34);
    const localOffset = bytes.readUInt32LE(offset + 42);
    checkRange(bytes, offset + 46, nameLen + extraLen + commentLen, end);
    if (flags || method || disk || extraLen || commentLen || compressed !== size ||
        size === 0xffffffff || localOffset === 0xffffffff) {
      fail('ARCHIVE_UNSUPPORTED', 'Only plain stored C5 ZIP entries without ZIP64 or extensions are accepted');
    }
    if ((external & 0x10) !== 0 || (unixType !== 0 && unixType !== 0x8000)) {
      fail('ARCHIVE_ATTRIBUTES', 'ZIP directory, symbolic link and special-file entries are forbidden');
    }
    const name = safeArchiveName(bytes.toString('utf8', offset + 46, offset + 46 + nameLen));
    if (Buffer.byteLength(name, 'utf8') !== nameLen || !/^[\x20-\x7e]+$/.test(name)) {
      fail('ARCHIVE_UNSAFE_PATH', 'ZIP entry path is not canonical ASCII');
    }
    const key = name.toLowerCase();
    if (unique.has(key)) fail('ARCHIVE_DUPLICATE', `Duplicate or case-ambiguous entry: ${name}`);
    unique.add(key);
    totalSize += size;
    if (totalSize > MAX_ARCHIVE_BYTES) fail('ARCHIVE_SIZE', 'Expanded archive exceeds 100 MiB');
    records.push({ name, size, crc32, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  if (offset !== end) fail('ARCHIVE_LAYOUT', 'ZIP central-directory count or length mismatch');
  for (const name of unique) {
    const parts = name.split('/');
    for (let count = 1; count < parts.length; count++) {
      if (unique.has(parts.slice(0, count).join('/'))) {
        fail('ARCHIVE_PATH_COLLISION', `ZIP file collides with a directory ancestor: ${name}`);
      }
    }
  }

  let localEnd = 0;
  const files = [];
  const fileContents = new Map();
  for (const record of records.sort((a, b) => a.localOffset - b.localOffset)) {
    const at = record.localOffset;
    if (at !== localEnd) fail('ARCHIVE_LAYOUT', 'ZIP local entries overlap or have untracked bytes');
    checkRange(bytes, at, 30, centralOffset);
    if (bytes.readUInt32LE(at) !== 0x04034b50 ||
        bytes.readUInt16LE(at + 6) || bytes.readUInt16LE(at + 8) ||
        bytes.readUInt32LE(at + 14) !== record.crc32 ||
        bytes.readUInt32LE(at + 18) !== record.size ||
        bytes.readUInt32LE(at + 22) !== record.size ||
        bytes.readUInt16LE(at + 28)) {
      fail('ARCHIVE_LOCAL', 'ZIP local header differs from its central record');
    }
    const nameLen = bytes.readUInt16LE(at + 26);
    checkRange(bytes, at + 30, nameLen + record.size, centralOffset);
    if (bytes.toString('utf8', at + 30, at + 30 + nameLen) !== record.name) {
      fail('ARCHIVE_LOCAL', 'ZIP local and central entry names disagree');
    }
    const start = at + 30 + nameLen;
    const content = bytes.subarray(start, start + record.size);
    if (crc32(content) !== record.crc32) fail('ARCHIVE_CRC', `ZIP CRC mismatch: ${record.name}`);
    files.push({ path: record.name, sha256: sha256(content), size: record.size });
    fileContents.set(record.name, content);
    localEnd = start + record.size;
  }
  if (localEnd !== centralOffset) fail('ARCHIVE_LAYOUT', 'ZIP local data does not end at central directory');
  for (const required of REQUIRED) {
    if (!fileContents.has(required)) fail('ARCHIVE_REQUIRED', `Missing required Yandex candidate file: ${required}`);
  }
  for (const name of fileContents.keys()) {
    if (name.toLowerCase().split('/').at(-1) === 'sdk.js') {
      fail('ARCHIVE_COPIED_SDK', `Copied platform SDK forbidden: ${name}`);
    }
    if (!REQUIRED.includes(name) &&
        (!name.startsWith('assets/') || !MEDIA.has(path.posix.extname(name).toLowerCase()))) {
      fail('ARCHIVE_UNEXPECTED', `Unexpected file outside C5 candidate contract: ${name}`);
    }
  }
  let manifest;
  try { manifest = JSON.parse(fileContents.get('ludory.project.json').toString('utf8')); }
  catch { fail('ARCHIVE_MANIFEST', 'Yandex project manifest is not JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      Object.keys(manifest).some(key => !['schemaVersion', 'id', 'version', 'title', 'engine', 'targets'].includes(key)) ||
      manifest.schemaVersion !== 1 || typeof manifest.id !== 'string' || !SLUG.test(manifest.id) ||
      typeof manifest.version !== 'string' || !SEMVER.test(manifest.version) ||
      manifest.version.match(/^\d+\.\d+\.\d+-([^+]+)/)?.[1].split('.').some(part => /^0\d+$/.test(part)) ||
      typeof manifest.engine !== 'string' || !SLUG.test(manifest.engine) ||
      !manifest.title || typeof manifest.title !== 'object' || Array.isArray(manifest.title) ||
      !Object.keys(manifest.title).length || Object.entries(manifest.title).some(([lang, value]) =>
        !/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(lang) || typeof value !== 'string' || !value.trim()) ||
      !Array.isArray(manifest.targets) || manifest.targets.length !== 1 ||
      manifest.targets[0] !== 'yandex-games') {
    fail('ARCHIVE_MANIFEST', 'ZIP must contain a complete valid Yandex-only game manifest');
  }
  files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  return { sha256: sha256(bytes), projectId: manifest.id, files,
    mediaFiles: files.filter(file => file.path.startsWith('assets/') && MEDIA.has(path.posix.extname(file.path).toLowerCase())) };
}
