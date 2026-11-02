import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureTrustedCandidate } from '@ludory/studio/qa-capture';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('P3b QA capture is a declared Studio package interface, not a test-only runtime', async () => {
  const studio = JSON.parse(fs.readFileSync(path.join(root, 'packages/studio/package.json'), 'utf8'));
  assert.equal(studio.exports['./qa-capture'], './src/qa-capture.mjs');
  assert.equal(studio.dependencies.playwright, '1.56.1');
  assert.equal(typeof captureTrustedCandidate, 'function');
  const blocked = await captureTrustedCandidate({ trusted: false });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.reasonCode, 'QA_TRUSTED_EXECUTION_NOT_AUTHORIZED');
  const cli = fs.readFileSync(path.join(root, 'packages/studio/src/cli.mjs'), 'utf8');
  assert.match(cli, /import\('\.\/qa-capture\.mjs'\)/);
  assert.doesNotMatch(cli, /runtime\/test\/browser\/qa-(?:capture|flow)/);
});
