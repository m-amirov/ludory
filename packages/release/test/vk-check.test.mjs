import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { inspectVkArchive, checkVkCandidate } from '../src/index.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function content() {
  return {
    'index.html': '<!doctype html><script type="module" src="src/main.js"></script>',
    'ludory.project.json': JSON.stringify({ schemaVersion: 1, id: 'vk-candidate', version: '1.0.0',
      title: { en: 'VK candidate' }, engine: 'web', targets: ['vk-games'] }),
    'src/main.js': 'import "../assets/ludory-vk.js"; import("../assets/vk-bridge.js");',
    'assets/ludory-vk.js': '// Runtime + VK',
    'assets/vk-bridge.js': '// pinned official VK Bridge',
    'licenses/swc-helpers.txt': 'Apache-2.0',
    'licenses/vk-bridge.txt': 'MIT',
    'assets/icon.png': 'icon bytes',
  };
}

function sample(t, entries = content(), options = { level: 0 }) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-vk-v5-release-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const zip = path.join(folder, 'candidate.zip');
  const bytes = Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) =>
    [name, new Uint8Array(Buffer.from(value))])), options));
  fs.writeFileSync(zip, bytes);
  const receipt = path.join(folder, 'receipt.json');
  const files = Object.entries(entries).map(([name, value]) =>
    ({ path: name, sha256: sha(value), size: Buffer.byteLength(value) })).sort((a, b) => a.path.localeCompare(b.path));
  fs.writeFileSync(receipt, `${JSON.stringify({ archivePath: zip, sha256: sha(bytes), files })}\n`);
  return { folder, zip, receipt, bytes };
}

test('independent VK inspector admits only complete stored VK-only archives and hashes exact members', t => {
  const { zip, bytes } = sample(t);
  const found = inspectVkArchive(zip);
  assert.equal(found.sha256, sha(bytes));
  assert.equal(found.projectId, 'vk-candidate');
  assert.equal(found.files.length, 8);
  assert.deepEqual(found.mediaFiles, [{ path: 'assets/icon.png', sha256: sha('icon bytes'), size: 10 }]);
  assert.ok(found.files.some(file => file.path === 'assets/vk-bridge.js'));
  assert.ok(found.files.some(file => file.path === 'licenses/vk-bridge.txt'));
});

test('VK inspector rejects missing managed Bridge/license, wrong target and unexpected files', t => {
  const invalid = [
    Object.fromEntries(Object.entries(content()).filter(([name]) => name !== 'assets/vk-bridge.js')),
    Object.fromEntries(Object.entries(content()).filter(([name]) => name !== 'licenses/swc-helpers.txt')),
    { ...content(), 'ludory.project.json': JSON.stringify({ schemaVersion: 1, id: 'vk-candidate',
      version: '1.0.0', title: { en: 'VK' }, engine: 'web', targets: ['yandex-games'] }) },
    { ...content(), 'src/extra.js': 'unexpected JS' },
    { ...content(), 'sdk.js': 'copied SDK' },
  ];
  for (const entries of invalid) {
    const { zip } = sample(t, entries);
    assert.throws(() => inspectVkArchive(zip), /required|manifest|vk|sdk|unexpected|archive/i);
  }
});

test('VK inspector rejects tampered ZIP and unsupported compressed entries', t => {
  const original = sample(t);
  const changed = Buffer.from(original.bytes);
  const central = changed.readUInt32LE(changed.length - 22 + 16);
  const local = changed.readUInt32LE(central + 42);
  const nameLen = changed.readUInt16LE(local + 26);
  changed[local + 30 + nameLen] ^= 1;
  fs.writeFileSync(original.zip, changed);
  assert.throws(() => inspectVkArchive(original.zip), /CRC|ZIP|checksum|corrupt/i);
  const compressed = sample(t, { ...content(), 'assets/big.png': 'x'.repeat(4000) }, { level: 6 });
  assert.throws(() => inspectVkArchive(compressed.zip), /ZIP|stored|compression/i);
});

test('VK candidate check returns PASS_LOCAL with live/device/rights/publication still NOT_RUN', t => {
  const { folder, zip, receipt } = sample(t);
  const before = fs.readdirSync(folder).sort();
  const result = checkVkCandidate({ archivePath: zip, receiptPath: receipt });
  assert.equal(result.status, 'PASS_LOCAL');
  assert.equal(result.candidateSha256, sha(fs.readFileSync(zip)));
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
  assert.deepEqual(result.gates.slice(0, 2).map(x => x.status), ['PASS', 'PASS']);
  assert.ok(result.gates.slice(2).every(x => x.status === 'NOT_RUN'));
  assert.deepEqual(fs.readdirSync(folder).sort(), before);
});

test('VK candidate check rejects altered, incomplete and self-asserted receipts, and blocks missing receipts', t => {
  const { zip, receipt } = sample(t);
  const original = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  for (const altered of [
    { ...original, sha256: '0'.repeat(64) },
    { ...original, files: original.files.slice(1) },
    { ...original, files: original.files.map((file, i) => i === 0 ? { ...file, sha256: '0'.repeat(64) } : file) },
    { ...original, releaseReady: true },
  ]) {
    fs.writeFileSync(receipt, JSON.stringify(altered));
    const result = checkVkCandidate({ archivePath: zip, receiptPath: receipt });
    assert.equal(result.status, 'FAIL');
    assert.equal(result.releaseReady, false);
    assert.equal(result.publicationAllowed, false);
  }
  fs.unlinkSync(receipt);
  assert.equal(checkVkCandidate({ archivePath: zip, receiptPath: receipt }).status, 'BLOCKED');
  assert.equal(checkVkCandidate({ archivePath: zip, receiptPath: receipt }).releaseReady, false);
});
