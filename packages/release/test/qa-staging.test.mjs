import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { stageQaCandidate } from '../src/qa-staging.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t, target, extra = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-stage-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const manifest = { schemaVersion: 1, id: 'qa-stage', version: '1.0.0',
    title: { en: 'QA staging' }, engine: 'web', targets: [target] };
  const members = {
    'index.html': '<!doctype html><html><body>QA candidate</body></html>',
    'ludory.project.json': JSON.stringify(manifest),
    'src/main.js': 'document.body.dataset.loaded = "true";',
    'assets/cover.png': 'sample bytes',
    ...(target === 'yandex-games'
      ? { 'assets/ludory-yandex.js': '/* local SDK adapter */' }
      : { 'assets/ludory-vk.js': '/* local VK adapter */',
        'assets/vk-bridge.js': '/* local bridge */',
        'licenses/swc-helpers.txt': 'license', 'licenses/vk-bridge.txt': 'license' }),
    ...extra,
  };
  const archivePath = path.join(folder, 'game.zip');
  const bytes = Buffer.from(zipSync(Object.fromEntries(Object.entries(members)
    .map(([name, text]) => [name, new Uint8Array(Buffer.from(text))])), { level: 0 }));
  fs.writeFileSync(archivePath, bytes);
  return { folder, members, archivePath, candidateSha256: hash(bytes), bytes };
}

for (const target of ['yandex-games', 'vk-games']) {
  test(`P3b stages every ${target} candidate member with matching SHA and safe cleanup`, t => {
    const data = fixture(t, target);
    const staged = stageQaCandidate({ ...data, target });
    try {
      assert.equal(staged.target, target);
      assert.equal(staged.candidateSha256, data.candidateSha256);
      assert.equal(staged.files.length, Object.keys(data.members).length);
      assert.equal(path.isAbsolute(staged.root), true);
      assert.equal(fs.statSync(staged.root).isDirectory(), true);
      for (const [name, content] of Object.entries(data.members)) {
        const filename = path.join(staged.root, ...name.split('/'));
        assert.deepEqual(fs.readFileSync(filename), Buffer.from(content));
        const file = staged.files.find(item => item.path === name);
        assert.equal(file.sha256, hash(Buffer.from(content)));
        assert.equal(file.size, Buffer.byteLength(content));
      }
      assert.deepEqual(fs.readFileSync(data.archivePath), data.bytes, 'original archive remains unchanged');
    } finally {
      staged.cleanup();
    }
    assert.equal(fs.existsSync(staged.root), false);
    staged.cleanup();
  });
}

test('P3b refuses mismatched, missing and corrupt candidates before staging', t => {
  const data = fixture(t, 'vk-games');
  assert.throws(() => stageQaCandidate({ ...data, target: 'vk-games', candidateSha256: 'f'.repeat(64) }),
    error => error.code === 'QA_CANDIDATE_SHA_MISMATCH');
  assert.throws(() => stageQaCandidate({ ...data, target: 'vk-games', candidateSha256: 'broken' }),
    error => error.code === 'QA_CANDIDATE_SHA_INVALID');
  assert.throws(() => stageQaCandidate({ ...data, target: 'wrong' }),
    error => error.code === 'QA_TARGET_INVALID');
  assert.throws(() => stageQaCandidate({ ...data, target: 'vk-games', archivePath: path.join(data.folder, 'missing.zip') }),
    error => error.code === 'INPUT_MISSING');
  fs.appendFileSync(data.archivePath, 'archive corruption');
  assert.throws(() => stageQaCandidate({ ...data, target: 'vk-games' }));
});

test('P3b never materializes unsafe archive paths', t => {
  const data = fixture(t, 'yandex-games', { '../escape.txt': 'bad' });
  assert.throws(() => stageQaCandidate({ ...data, target: 'yandex-games' }),
    error => error.code === 'ARCHIVE_UNSAFE_PATH');
  assert.equal(fs.existsSync(path.join(data.folder, 'escape.txt')), false);
});

test('P3b refuses deleting a substituted staging directory', t => {
  const data = fixture(t, 'yandex-games');
  const staged = stageQaCandidate({ ...data, target: 'yandex-games' });
  const oldRoot = staged.root + '-moved';
  try {
    fs.renameSync(staged.root, oldRoot);
    fs.mkdirSync(staged.root);
    fs.writeFileSync(path.join(staged.root, 'owner-file.txt'), 'keep');
    assert.throws(() => staged.cleanup(), error => error.code === 'QA_STAGING_OWNERSHIP_CHANGED');
    assert.equal(fs.readFileSync(path.join(staged.root, 'owner-file.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(staged.root, { recursive: true, force: true });
    fs.rmSync(oldRoot, { recursive: true, force: true });
  }
});
