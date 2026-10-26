import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(`IMAGE_ARTIFACT_${code}`); };
const safeDimensions = (width, height) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width > 16384 || height > 16384 ||
      width * height > 64 * 1024 * 1024) fail('DIMENSIONS_INVALID');
  return { width, height };
};

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngDimensions(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail('PNG_SIGNATURE');
  let pos = 8, ihdr = null, idat = [], ended = false, seenIdat = false, palette = false;
  while (pos + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    if (length > MAX_IMAGE_BYTES || pos + 12 + length > bytes.length) fail('PNG_TRUNCATED');
    const chunk = bytes.subarray(pos + 4, pos + 8).toString('ascii');
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (crc32(bytes.subarray(pos + 4, pos + 8 + length)) !== bytes.readUInt32BE(pos + 8 + length)) fail('PNG_CRC');
    if (pos === 8 && chunk !== 'IHDR') fail('PNG_IHDR');
    if (chunk === 'IHDR') {
      if (ihdr || length !== 13) fail('PNG_IHDR');
      const width = data.readUInt32BE(0), height = data.readUInt32BE(4);
      safeDimensions(width, height);
      const bitDepth = data[8], color = data[9], compression = data[10], filter = data[11], interlace = data[12];
      const allowed = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!allowed[color]?.includes(bitDepth) || compression !== 0 || filter !== 0 || interlace !== 0) fail('PNG_UNSUPPORTED');
      ihdr = { width, height, bitDepth, color };
    } else if (chunk === 'PLTE') {
      if (!ihdr || seenIdat || palette || !length || length > 768 || length % 3 !== 0 ||
          ![2, 3, 6].includes(ihdr.color)) fail('PNG_PLTE');
      palette = true;
    } else if (chunk === 'IDAT') {
      if (!ihdr || ended) fail('PNG_CHUNK_ORDER');
      seenIdat = true;
      idat.push(data);
    } else if (chunk === 'IEND') {
      if (!seenIdat || (ihdr.color === 3 && !palette) || length !== 0 ||
          pos + 12 !== bytes.length) fail('PNG_IEND');
      ended = true;
      break;
    } else if (chunk[0] === chunk[0]?.toUpperCase()) {
      // Unknown critical chunks cannot be safely interpreted.
      fail('PNG_CRITICAL_CHUNK');
    }
    pos += 12 + length;
  }
  if (!ihdr || !ended) fail('PNG_TRUNCATED');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
  const rowBytes = Math.ceil(ihdr.width * channels * ihdr.bitDepth / 8);
  const expected = (rowBytes + 1) * ihdr.height;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 }); }
  catch { fail('PNG_DEFLATE'); }
  if (raw.length !== expected) fail('PNG_SCANLINE_SIZE');
  for (let row = 0; row < ihdr.height; row++) if (raw[row * (rowBytes + 1)] > 4) fail('PNG_FILTER');
  return safeDimensions(ihdr.width, ihdr.height);
}

function jpegDimensions(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('JPEG_SIGNATURE');
  let pos = 2, dimensions = null, hasScan = false, entropyBytes = 0;
  while (pos < bytes.length) {
    if (bytes[pos++] !== 0xff) fail('JPEG_MARKER');
    while (pos < bytes.length && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.length) fail('JPEG_TRUNCATED');
    const marker = bytes[pos++];
    if (marker === 0xd9) {
      if (!dimensions || !hasScan || entropyBytes === 0 || pos !== bytes.length) fail('JPEG_EOI');
      return dimensions;
    }
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) fail('JPEG_MARKER');
    if (pos + 2 > bytes.length) fail('JPEG_TRUNCATED');
    const length = bytes.readUInt16BE(pos);
    if (length < 2 || pos + length > bytes.length) fail('JPEG_TRUNCATED');
    const dataStart = pos + 2;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || dimensions) fail('JPEG_SOF');
      dimensions = safeDimensions(bytes.readUInt16BE(dataStart + 3), bytes.readUInt16BE(dataStart + 1));
    }
    pos += length;
    if (marker === 0xda) {
      if (!dimensions || length < 6) fail('JPEG_SCAN');
      hasScan = true;
      // Entropy-coded scan: 0xff00 escapes data, 0xffd0..d7 are restart markers.
      while (pos < bytes.length) {
        if (bytes[pos++] !== 0xff) { entropyBytes++; continue; }
        if (pos >= bytes.length) fail('JPEG_TRUNCATED');
        const next = bytes[pos];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          if (next === 0x00) entropyBytes++;
          pos++; continue;
        }
        pos--; // Next marker is the following JPEG segment or EOI.
        break;
      }
    }
  }
  fail('JPEG_TRUNCATED');
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) fail('WEBP_RIFF');
  let pos = 12, dimensions = null, imageChunk = false;
  while (pos + 8 <= bytes.length) {
    const tag = bytes.toString('ascii', pos, pos + 4), size = bytes.readUInt32LE(pos + 4);
    const start = pos + 8, end = start + size;
    if (size > MAX_IMAGE_BYTES || end > bytes.length || end + (size & 1) > bytes.length) fail('WEBP_TRUNCATED');
    const data = bytes.subarray(start, end);
    if (tag === 'VP8 ') {
      if (imageChunk || data.length < 11 || (data[0] & 1) !== 0 ||
          !data.subarray(3, 6).equals(Buffer.from('9d012a', 'hex'))) fail('WEBP_VP8');
      const partitionSize = ((data[0] | data[1] << 8 | data[2] << 16) >>> 5);
      if (partitionSize < 1 || partitionSize > data.length - 10) fail('WEBP_VP8_PARTITION');
      dimensions = safeDimensions(data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff);
      imageChunk = true;
    } else if (tag === 'VP8L') {
      if (imageChunk || data.length < 6 || data[0] !== 0x2f) fail('WEBP_VP8L');
      dimensions = safeDimensions(1 + (((data[1]) | ((data[2] & 0x3f) << 8))),
        1 + (((data[2] >> 6) | (data[3] << 2) | ((data[4] & 0x0f) << 10))));
      imageChunk = true;
    } else if (tag === 'VP8X') {
      if (dimensions || data.length !== 10) fail('WEBP_VP8X');
      dimensions = safeDimensions(1 + data.readUIntLE(4, 3), 1 + data.readUIntLE(7, 3));
    }
    pos = end + (size & 1);
  }
  if (pos !== bytes.length || !imageChunk || !dimensions) fail('WEBP_IMAGE_MISSING');
  return dimensions;
}

/** Structural and bounded validation; artwork/rights remain independently unapproved. */
export function inspectGeneratedImage(input, { mediaType, maxBytes = MAX_IMAGE_BYTES } = {}) {
  if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) fail('BYTES_INVALID');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_IMAGE_BYTES) fail('LIMIT_INVALID');
  if (!input.length) fail('EMPTY');
  if (input.length > maxBytes) fail('TOO_LARGE');
  const bytes = Buffer.from(input);
  const dimensions = mediaType === 'image/png' ? pngDimensions(bytes)
    : mediaType === 'image/jpeg' ? jpegDimensions(bytes)
      : mediaType === 'image/webp' ? webpDimensions(bytes) : fail('MIME_UNSUPPORTED');
  return { mediaType, ...dimensions, size: bytes.length, sha256: hash(bytes) };
}

/** Pin each input directory before reading. Never follow symlinks, junctions or hardlinks. */
export function readProjectImageInput(project, relative) {
  if (typeof relative !== 'string' || relative.length > 200 || !relative ||
      /[\\:\0]/.test(relative) || relative.startsWith('/') || relative.startsWith('.ludory/') ||
      relative.split('/').some(part => !part || part === '.' || part === '..')) fail('PATH_UNSAFE');
  const extension = path.extname(relative).toLowerCase();
  const mediaType = extension === '.png' ? 'image/png' : ['.jpg', '.jpeg'].includes(extension)
    ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : null;
  if (!mediaType) fail('EXTENSION_UNSUPPORTED');
  const before = process.cwd();
  let fd;
  try {
    const original = fs.lstatSync(project, { bigint: true });
    if (!original.isDirectory() || original.isSymbolicLink()) fail('PATH_UNSAFE');
    process.chdir(project);
    let now = fs.statSync('.', { bigint: true });
    if (`${now.dev}:${now.ino}` !== `${original.dev}:${original.ino}`) fail('PATH_CHANGED');
    const parts = relative.split('/');
    for (const part of parts.slice(0, -1)) {
      const target = fs.lstatSync(part, { bigint: true });
      if (!target.isDirectory() || target.isSymbolicLink()) fail('PATH_UNSAFE');
      process.chdir(part);
      now = fs.statSync('.', { bigint: true });
      if (`${now.dev}:${now.ino}` !== `${target.dev}:${target.ino}`) fail('PATH_CHANGED');
    }
    const file = parts.at(-1);
    const fileStat = fs.lstatSync(file, { bigint: true });
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1n ||
        fileStat.size < 1n || fileStat.size > BigInt(MAX_IMAGE_BYTES)) fail('PATH_UNSAFE');
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== fileStat.dev ||
        opened.ino !== fileStat.ino || opened.size !== fileStat.size) fail('PATH_CHANGED');
    const bytes = fs.readFileSync(fd);
    if (bytes.length !== Number(opened.size)) fail('PATH_CHANGED');
    const info = inspectGeneratedImage(bytes, { mediaType });
    const after = fs.lstatSync(file, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1n ||
        after.size !== opened.size) fail('PATH_CHANGED');
    return { bytes, source: { path: relative, sha256: info.sha256, size: info.size }, info };
  } catch (error) {
    if (error.message.startsWith('IMAGE_ARTIFACT_')) throw error;
    fail('PATH_UNSAFE');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    process.chdir(before);
  }
}
