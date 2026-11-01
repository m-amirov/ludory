import path from 'node:path';
import zlib from 'node:zlib';

// Structural media validation only. Pixel appearance, copyright, and platform sizing are NOT reviewed.
const invalid = () => { throw new Error('QA_PROMO_IMAGE_INVALID'); };
const dimensions = (width, height) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > 16384 || height > 16384 || width * height > 16 * 1024 * 1024) invalid();
  return { width, height };
};
const crcTable = Uint32Array.from({ length: 256 }, (_, number) => {
  let crc = number;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function png(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) invalid();
  let at = 8, header = null, ended = false, palette = false, sawData = false;
  const imageData = [];
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    if (length > 10 * 1024 * 1024 || at + 12 + length > bytes.length) invalid();
    const type = bytes.toString('ascii', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(at + 8 + length)) invalid();
    if (at === 8 && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (header || length !== 13) invalid();
      const size = dimensions(data.readUInt32BE(0), data.readUInt32BE(4));
      const depth = data[8], color = data[9];
      const allowed = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8],
        4: [8, 16], 6: [8, 16] };
      if (!allowed[color]?.includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) invalid();
      header = { ...size, depth, color };
    } else if (type === 'PLTE') {
      if (!header || sawData || palette || !length || length % 3 !== 0 || length > 768) invalid();
      palette = true;
    } else if (type === 'IDAT') {
      if (!header || ended) invalid();
      sawData = true;
      imageData.push(data);
    } else if (type === 'IEND') {
      if (!header || !sawData || (header.color === 3 && !palette) || length !== 0 ||
          at + 12 !== bytes.length) invalid();
      ended = true;
      break;
    } else if (type[0] === type[0]?.toUpperCase()) invalid();
    at += 12 + length;
  }
  if (!ended) invalid();
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color];
  const rowBytes = Math.ceil(header.width * channels * header.depth / 8);
  const expected = (rowBytes + 1) * header.height;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(imageData), { maxOutputLength: expected + 1 }); }
  catch { invalid(); }
  if (raw.length !== expected) invalid();
  for (let row = 0; row < header.height; row++) if (raw[row * (rowBytes + 1)] > 4) invalid();
  return dimensions(header.width, header.height);
}

function jpeg(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  let at = 2, size = null, sawScan = false, entropy = 0;
  while (at < bytes.length) {
    if (bytes[at++] !== 0xff) invalid();
    while (bytes[at] === 0xff) at++;
    if (at >= bytes.length) invalid();
    const marker = bytes[at++];
    if (marker === 0xd9) {
      if (!size || !sawScan || !entropy || at !== bytes.length) invalid();
      return size;
    }
    if (marker === 0xd8 || marker === 0 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (at + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(at), start = at + 2;
    if (length < 2 || at + length > bytes.length) invalid();
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || size) invalid();
      size = dimensions(bytes.readUInt16BE(start + 3), bytes.readUInt16BE(start + 1));
    }
    at += length;
    if (marker === 0xda) {
      if (!size || length < 6) invalid();
      sawScan = true;
      while (at < bytes.length) {
        if (bytes[at++] !== 0xff) { entropy++; continue; }
        if (at >= bytes.length) invalid();
        const next = bytes[at];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { if (next === 0) entropy++; at++; continue; }
        at--;
        break;
      }
    }
  }
  invalid();
}

function webp(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) invalid();
  let at = 12, size = null, image = false;
  while (at + 8 <= bytes.length) {
    const type = bytes.toString('ascii', at, at + 4), length = bytes.readUInt32LE(at + 4);
    const end = at + 8 + length;
    if (length > 10 * 1024 * 1024 || end + (length & 1) > bytes.length) invalid();
    const data = bytes.subarray(at + 8, end);
    if (type === 'VP8 ') {
      if (image || data.length < 11 || (data[0] & 1) || !data.subarray(3, 6).equals(Buffer.from('9d012a', 'hex'))) invalid();
      const partition = ((data[0] | (data[1] << 8) | (data[2] << 16)) >>> 5);
      if (!partition || partition > data.length - 10) invalid();
      size = dimensions(data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff);
      image = true;
    } else if (type === 'VP8L') {
      if (image || data.length < 6 || data[0] !== 0x2f) invalid();
      size = dimensions(1 + (data[1] | ((data[2] & 0x3f) << 8)),
        1 + ((data[2] >> 6) | (data[3] << 2) | ((data[4] & 0x0f) << 10)));
      image = true;
    } else if (type === 'VP8X') {
      if (size || data.length !== 10) invalid();
      size = dimensions(1 + data.readUIntLE(4, 3), 1 + data.readUIntLE(7, 3));
    }
    at = end + (length & 1);
  }
  if (at !== bytes.length || !image || !size) invalid();
  return size;
}

export function inspectPromoImage(bytes, filename) {
  switch (path.extname(filename).toLowerCase()) {
    case '.png': return png(bytes);
    case '.jpg':
    case '.jpeg': return jpeg(bytes);
    case '.webp': return webp(bytes);
    default: return invalid();
  }
}
