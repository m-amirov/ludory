import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGeneratedImage, MAX_IMAGE_BYTES } from '../src/image-artifacts.mjs';
import { png, jpeg, webp } from './helpers/images.mjs';

test('actual 1×1 PNG, JPEG and WebP originals have bounded inspected dimensions and SHA', () => {
  for (const [bytes, mediaType] of [[png, 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp']]) {
    const found = inspectGeneratedImage(bytes, { mediaType });
    assert.equal(found.mediaType, mediaType);
    assert.equal(found.width, 1);
    assert.equal(found.height, 1);
    assert.match(found.sha256, /^[a-f0-9]{64}$/);
    assert.equal(found.size, bytes.length);
  }
});

test('structural truncation, fake MIME, zero length, overflow and trailers fail before staging', () => {
  for (const [bytes, mediaType] of [[Buffer.alloc(0), 'image/png'],
    [png.subarray(0, -1), 'image/png'], [jpeg.subarray(0, -2), 'image/jpeg'],
    [webp.subarray(0, -1), 'image/webp'], [png, 'image/webp'],
    [Buffer.concat([png, Buffer.from('trailer')]), 'image/png']]) {
    assert.throws(() => inspectGeneratedImage(bytes, { mediaType }), /IMAGE_ARTIFACT_/);
  }
  assert.throws(() => inspectGeneratedImage(png, { mediaType: 'image/png', maxBytes: 10 }), /IMAGE_ARTIFACT_TOO_LARGE/);
  const huge = Buffer.from(png);
  huge.writeUInt32BE(32768, 16); // Dimensions outside the allowed range (even if CRC is stale).
  assert.throws(() => inspectGeneratedImage(huge, { mediaType: 'image/png' }), /IMAGE_ARTIFACT_/);
});

test('indexed PNG without a palette is structurally incomplete even with valid remaining CRCs', () => {
  const indexed = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAADUExURf///6fEG8gAAAABYktHRACIBR1IAAAAB3RJTUUH6goaBxAfzJo0PwAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=', 'base64');
  assert.equal(inspectGeneratedImage(indexed, { mediaType: 'image/png' }).width, 1);
  const paletteAt = indexed.indexOf(Buffer.from('PLTE')) - 4;
  assert.ok(paletteAt > 0);
  const len = indexed.readUInt32BE(paletteAt);
  const withoutPalette = Buffer.concat([indexed.subarray(0, paletteAt), indexed.subarray(paletteAt + len + 12)]);
  assert.throws(() => inspectGeneratedImage(withoutPalette, { mediaType: 'image/png' }), /IMAGE_ARTIFACT_PNG/);
});

test('JPEG SOF dimensions use width and height in their actual byte order', () => {
  const rectangular = Buffer.from('/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAADAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64');
  assert.deepEqual(((x) => ({ width: x.width, height: x.height }))(inspectGeneratedImage(rectangular,
    { mediaType: 'image/jpeg' })), { width: 2, height: 3 });
});

test('header-only JPEG scan and VP8 frame are rejected without complete compressed payload', () => {
  const emptyEntropy = Buffer.concat([jpeg.subarray(0, -4), Buffer.from([0xff, 0xd9])]);
  assert.throws(() => inspectGeneratedImage(emptyEntropy, { mediaType: 'image/jpeg' }), /IMAGE_ARTIFACT_JPEG/);
  const emptyVp8 = Buffer.from(webp.subarray(0, 30));
  emptyVp8.writeUInt32LE(10, 16);
  emptyVp8.writeUInt32LE(22, 4);
  assert.throws(() => inspectGeneratedImage(emptyVp8, { mediaType: 'image/webp' }), /IMAGE_ARTIFACT_WEBP/);
});

test('oversized payload is rejected before Buffer.from attempts to copy it', () => {
  const large = Buffer.alloc(MAX_IMAGE_BYTES + 1);
  const original = Buffer.from;
  let copied = false;
  try {
    Buffer.from = function (input, ...args) {
      if (input === large) { copied = true; throw new Error('SHOULD_NOT_COPY'); }
      return original.call(Buffer, input, ...args);
    };
    assert.throws(() => inspectGeneratedImage(large, { mediaType: 'image/png' }), /IMAGE_ARTIFACT_TOO_LARGE/);
    assert.equal(copied, false);
  } finally { Buffer.from = original; }
});
