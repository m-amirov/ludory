import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('source closure covers every pinned source blob exactly once with an owner', () => {
  const inventory = JSON.parse(fs.readFileSync(new URL('../../../docs/migration/source-closure.json', import.meta.url), 'utf8'));
  assert.equal(inventory.schemaVersion, 1);
  assert.deepEqual(inventory.generatedFrom.map(s => s.trackedBlobs), [219, 179]);
  assert.equal(inventory.files.length, 398);
  const keys = new Set();
  for (const file of inventory.files) {
    assert.match(file.blobSha, /^[a-f0-9]{40}$/);
    assert.ok(['ai', 'studio', 'release', 'connect', 'runtime', 'core'].includes(file.destination));
    assert.ok(file.family);
    assert.ok(file.kind);
    const key = `${file.repo}/${file.path}`;
    assert.equal(keys.has(key), false, `duplicate inventory entry ${key}`);
    keys.add(key);
  }
  for (const source of inventory.generatedFrom) {
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    assert.equal(inventory.files.filter(f => f.repo === source.repo).length, source.trackedBlobs);
  }
});
