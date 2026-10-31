import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { inspectYandexArchive, readRegularBytes } from '../src/archive.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = () => ({
  'index.html': '<!doctype html><title>Game</title><script src="/sdk.js"></script>',
  'ludory.project.json': JSON.stringify({ schemaVersion: 1, id: 'zip-game', version: '0.1.0',
    title: { en: 'ZIP game' }, engine: 'web', targets: ['yandex-games'] }),
  'assets/ludory-yandex.js': '/* generated runtime */',
  'src/main.js': 'console.log("game")',
  'assets/icon.png': 'PNG bytes',
});

function archive(t, entries = fixture(), zipOptions = { level: 0 }) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-release-zip-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'candidate.zip');
  const bytes = Buffer.from(zipSync(Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [name, new Uint8Array(Buffer.from(value))])), zipOptions));
  fs.writeFileSync(filename, bytes);
  return { filename, bytes };
}

test('inspects real stored ZIP bytes and returns independently hashed entries', t => {
  const { filename, bytes } = archive(t);
  const result = inspectYandexArchive(filename);
  assert.equal(result.sha256, sha(bytes));
  assert.equal(result.projectId, 'zip-game');
  assert.equal(result.files.length, 5);
  assert.deepEqual(result.mediaFiles, [{ path: 'assets/icon.png', sha256: sha('PNG bytes'), size: 9 }]);
  assert.deepEqual(result.files.find(file => file.path === 'src/main.js'),
    { path: 'src/main.js', sha256: sha('console.log("game")'), size: 19 });
});

test('rejects truncated ZIP and disagreement between local and central headers', t => {
  const first = archive(t);
  fs.writeFileSync(first.filename, first.bytes.subarray(0, first.bytes.length - 7));
  assert.throws(() => inspectYandexArchive(first.filename), /ZIP|directory|truncated/i);

  const second = archive(t);
  const changed = Buffer.from(second.bytes);
  changed[30] ^= 1; // First local path byte; central path still original.
  fs.writeFileSync(second.filename, changed);
  assert.throws(() => inspectYandexArchive(second.filename), /ZIP|name|header/i);
});

test('rejects invalid entry paths and case-insensitive collisions', t => {
  for (const name of ['../outside.txt', 'assets/CON.txt', 'assets/space name.png', '/absolute.png']) {
    const { filename } = archive(t, { ...fixture(), [name]: 'invalid' });
    assert.throws(() => inspectYandexArchive(filename), /path|name|ZIP|unsafe/i, name);
  }
  const { filename } = archive(t, { ...fixture(), 'assets/ICON.png': 'other' });
  assert.throws(() => inspectYandexArchive(filename), /duplicate|ambiguous|collision/i);
});

test('rejects unsupported compression, zip64-style markers and copied sdk', t => {
  const { filename } = archive(t, { ...fixture(), 'assets/extra.txt': 'A'.repeat(50_000) }, { level: 6 });
  assert.throws(() => inspectYandexArchive(filename), /stored|compression|ZIP/i);

  const withSdk = archive(t, { ...fixture(), 'sdk.js': 'FAKE' });
  assert.throws(() => inspectYandexArchive(withSdk.filename), /sdk\.js|SDK/i);

  const changed = archive(t);
  const data = Buffer.from(changed.bytes);
  data.writeUInt16LE(0xffff, data.length - 22 + 10); // EOCD entry count (ZIP64 sentinel).
  fs.writeFileSync(changed.filename, data);
  assert.throws(() => inspectYandexArchive(changed.filename), /ZIP64|directory|ZIP/i);
});

test('rejects mixed-platform manifest and symbolic archive rather than following it', t => {
  const { filename } = archive(t, { ...fixture(), 'ludory.project.json': JSON.stringify({
    schemaVersion: 1, id: 'zip-game', version: '0.1.0', title: { en: 'Game' }, engine: 'web',
    targets: ['vk-games', 'yandex-games'],
  }) });
  assert.throws(() => inspectYandexArchive(filename), /Yandex|target|manifest/i);

  const linked = `${filename}.link`;
  try { fs.symlinkSync(filename, linked); } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic('Symlinks unavailable'); return; }
    throw error;
  }
  assert.throws(() => inspectYandexArchive(linked), /symbolic|regular|link/i);
});

test('rejects symbolic ZIP members even with matching receipt-ready content hashes', t => {
  const data = archive(t);
  const bytes = Buffer.from(data.bytes);
  const central = bytes.readUInt32LE(bytes.length - 22 + 16);
  bytes.writeUInt16LE(0x0314, central + 4); // UNIX archive creator.
  bytes.writeUInt32LE((0o120777 << 16) >>> 0, central + 38); // Symbolic link, not a file.
  fs.writeFileSync(data.filename, bytes);
  assert.throws(() => inspectYandexArchive(data.filename), /ZIP|attribute|type|symbolic/i);
});

test('checks ZIP CRC32 against actual file bytes even when both headers agree', t => {
  const data = archive(t);
  const bytes = Buffer.from(data.bytes);
  const central = bytes.readUInt32LE(bytes.length - 22 + 16);
  const local = bytes.readUInt32LE(central + 42);
  bytes.writeUInt32LE(0, central + 16);
  bytes.writeUInt32LE(0, local + 14);
  fs.writeFileSync(data.filename, bytes);
  assert.throws(() => inspectYandexArchive(data.filename), /CRC|checksum|corrupt/i);

  const alteredBody = archive(t);
  const changed = Buffer.from(alteredBody.bytes);
  const centralOffset = changed.readUInt32LE(changed.length - 22 + 16);
  const localOffset = changed.readUInt32LE(centralOffset + 42);
  const nameLength = changed.readUInt16LE(localOffset + 26);
  changed[localOffset + 30 + nameLength] ^= 1;
  fs.writeFileSync(alteredBody.filename, changed);
  assert.throws(() => inspectYandexArchive(alteredBody.filename), /CRC|checksum|corrupt/i);
});

test('rejects archive file paths that collide with implicit directories', t => {
  const data = archive(t, { ...fixture(), 'assets/icon.png/child.png': 'nested' });
  assert.throws(() => inspectYandexArchive(data.filename), /collid|ancestor|directory|path/i);
  const reversed = archive(t, { ...fixture(), 'assets/ICON.png/child.png': 'nested' });
  assert.throws(() => inspectYandexArchive(reversed.filename), /collid|ancestor|directory|path/i);
});

test('requires the complete independent Core-compatible manifest contract', t => {
  const valid = JSON.parse(fixture()['ludory.project.json']);
  const invalid = [
    { schemaVersion: 1, id: 'zip-game', targets: ['yandex-games'] },
    { ...valid, id: '-broken' },
    { ...valid, id: 123 },
    { ...valid, version: '1.0.0-01' },
    { ...valid, title: { en: ' ' } },
    { ...valid, engine: [] },
    { ...valid, unknown: true },
  ];
  for (const manifest of invalid) {
    const data = archive(t, { ...fixture(), 'ludory.project.json': JSON.stringify(manifest) });
    assert.throws(() => inspectYandexArchive(data.filename), /manifest|invalid/i, JSON.stringify(manifest));
  }
});

test('bounds opened file size before reading and notices growth during bounded reads', t => {
  const data = archive(t);
  const originalFstat = fs.fstatSync;
  let first = true;
  fs.fstatSync = function (...args) {
    const value = originalFstat.apply(this, args);
    if (first) { first = false; value.size += 1; }
    return value;
  };
  try { assert.throws(() => readRegularBytes(data.filename, data.bytes.length), /changed|size|input/i); }
  finally { fs.fstatSync = originalFstat; }

  const originalRead = fs.readSync;
  let grew = false;
  fs.readSync = function (...args) {
    const read = originalRead.apply(this, args);
    if (!grew) { grew = true; fs.appendFileSync(data.filename, 'extra'); }
    return read;
  };
  try { assert.throws(() => readRegularBytes(data.filename, data.bytes.length), /changed|size|input/i); }
  finally { fs.readSync = originalRead; }
  assert.equal(grew, true, 'Verifier must use bounded readSync rather than unbounded readFileSync');
});
