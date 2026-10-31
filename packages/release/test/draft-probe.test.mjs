import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraftUrl, validateGameBase, verifyServedCandidate,
  finalizeDraftObservation, prepareDraftProbe } from '../src/draft-probe.mjs';

const hex = 'a'.repeat(64);
const prepared = {
  report: { schemaVersion: 1, status: 'BLOCKED', reasonCode: 'AWAIT_OWNER_AUTHORIZED_BROWSER',
    candidateSha256: hex, releaseReady: false, publicationAllowed: false },
  files: [{ path: 'index.html', size: 12, sha256: hex }],
};

test('R3 only accepts strict Yandex draft URL, never local game_url or ordinary game URLs', () => {
  const valid = validateDraftUrl('https://yandex.ru/games/app/123456?draft=true');
  assert.equal(valid.hostname, 'yandex.ru');
  for (const url of [
    'http://yandex.ru/games/app/123?draft=true',
    'https://yandex.ru.evil.com/games/app/123?draft=true',
    'https://user@yandex.ru/games/app/123?draft=true',
    'https://yandex.ru/games/app/123',
    'https://yandex.ru/games/app/123?draft=false',
    'https://yandex.ru/games/app/123?draft=true&game_url=https://localhost:8080',
    'https://yandex.ru/games/app/123?draft=true&debug-mode=16',
    'https://yandex.ru/games/app/123?draft=true&draft=false',
    'https://yandex.ru/games/app/123?draft=true#foo',
  ]) assert.throws(() => validateDraftUrl(url));
});

test('R3 only accepts candidate assets on Yandex-owned HTTPS host and rooted path', () => {
  assert.equal(validateGameBase('https://storage.yandex.net/game/abc/').hostname, 'storage.yandex.net');
  for (const url of ['http://storage.yandex.net/game/', 'https://localhost/game/',
    'https://storage.yandex.net.evil.com/game/', 'https://storage.yandex.net/game?foo=bar',
    'https://storage.yandex.net:444/game/']) {
    assert.throws(() => validateGameBase(url));
  }
  assert.throws(() => validateGameBase('https://storage.yandex.net/%2e%2e/game/'));
});

test('independent transport verifies every file by size and SHA without accepting a declaration', async () => {
  const files = [{ path: 'index.html', size: 7, sha256: hex },
    { path: 'src/main.js', size: 8, sha256: 'b'.repeat(64) }];
  const asked = [];
  const ok = await verifyServedCandidate(files, 'https://storage.yandex.net/game/', async (url, size) => {
    asked.push(url.href);
    return { size, sha256: asked.length === 1 ? hex : 'b'.repeat(64) };
  });
  assert.equal(ok, 2);
  assert.deepEqual(asked, ['https://storage.yandex.net/game/index.html',
    'https://storage.yandex.net/game/src/main.js']);
  await assert.rejects(verifyServedCandidate(files, 'https://storage.yandex.net/game/',
    async () => ({ size: 7, sha256: hex })), /R3_SERVED_BYTES_MISMATCH/);
  await assert.rejects(verifyServedCandidate([...files, files[0]], 'https://storage.yandex.net/game/',
    async () => { throw new Error('Transport must not run for duplicate set'); }), /R3_FILE_SET_INVALID/);
});

test('R3 browser observations never produce Release PASS, even with all bytes and READY', () => {
  const observed = finalizeDraftObservation(prepared, { frameLinked: true, ready: true,
    filesVerified: 1, browser: 'chromium' });
  assert.equal(observed.status, 'CAPTURED_UNVERIFIED');
  assert.equal(observed.releaseReady, false);
  assert.equal(observed.publicationAllowed, false);
  assert.ok(observed.browserChecks.every(check => check.status === 'OBSERVED'));
  assert.notEqual(observed.browserChecks[0].status, 'PASS');
  for (const evidence of [null, { frameLinked: false, ready: true, filesVerified: 1, browser: 'chromium' },
    { frameLinked: true, ready: true, filesVerified: 0, browser: 'chromium' },
    { frameLinked: true, ready: true, filesVerified: 1, browser: 'firefox' }]) {
    const result = finalizeDraftObservation(prepared, evidence);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.releaseReady, false);
  }
});

test('invalid URL is rejected before any local Release or network dependency', () => {
  assert.throws(() => prepareDraftProbe({ draftUrl: 'https://example.com/games/app/1?draft=true' }),
    /DRAFT_URL_NOT_STRICT/);
});
