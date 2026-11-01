import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/archive.mjs';
import { verifyQaCaptureIntegrity } from '../src/qa-evidence.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==', 'base64');
const ids = ['desktop-1000x720', 'mobile-390x844', 'landscape-667x375'];
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const expected = { target: 'vk-games', candidateSha256: 'a'.repeat(64), evidenceDir: dir };
  const manifest = {
    schemaVersion: 1, kind: 'qa-browser-capture', status: 'STARTUP_OBSERVED',
    target: expected.target, candidateSha256: expected.candidateSha256,
    engine: 'chromium', browserVersion: 'test-version', flowSha256: null,
    observedScope: 'STARTUP_ONLY', sdk: 'LIVE_NOT_TESTED',
    physicalDevices: 'NOT_RUN', actualModeration: 'NOT_RUN', releaseReady: false,
    publicationAllowed: false, cases: ids.map(id => ({
      id, status: 'STARTUP_OBSERVED', screenshot: {
        file: id + '.png', sha256: sha256(png), width: 1, height: 1 },
    })),
  };
  const write = () => {
    fs.writeFileSync(path.join(dir, 'capture.json'), JSON.stringify(manifest));
  };
  for (const id of ids) fs.writeFileSync(path.join(dir, id + '.png'), png);
  write();
  return { expected, manifest, write, dir };
}

test('P3b capture integrity verifies only the actual bytes, never moderator/browser attestation', t => {
  const data = fixture(t);
  const raw = fs.readFileSync(path.join(data.dir, 'capture.json'));
  const report = verifyQaCaptureIntegrity({ ...data.expected, reportSha256: sha256(raw) });
  assert.equal(report.status, 'INTEGRITY_VERIFIED');
  assert.equal(report.reportSha256, sha256(raw));
  assert.equal(report.screenshots.length, 3);
  assert.equal(report.provenance, 'LOCAL_BYTES_ONLY');
  assert.equal(report.browserAttested, false);
  assert.equal(report.releaseReady, false);
  assert.equal(report.publicationAllowed, false);
  assert.equal(report.actualModeration, 'NOT_RUN');
  assert.equal(verifyQaCaptureIntegrity({ ...data.expected, reportSha256: 'b'.repeat(64) }).reasonCode,
    'QA_EVIDENCE_REPORT_DIGEST_MISMATCH');
});

test('P3b capture integrity rejects wrong game, tampered PNG and fabricated release authority', t => {
  const data = fixture(t);
  assert.equal(verifyQaCaptureIntegrity({ ...data.expected, candidateSha256: 'f'.repeat(64) }).status, 'FAIL');
  fs.writeFileSync(path.join(data.dir, ids[0] + '.png'), Buffer.from('changed'));
  assert.equal(verifyQaCaptureIntegrity(data.expected).reasonCode, 'QA_EVIDENCE_SCREENSHOT_DIGEST_MISMATCH');
  fs.writeFileSync(path.join(data.dir, ids[0] + '.png'), png);
  data.manifest.publicationAllowed = true;
  data.write();
  assert.equal(verifyQaCaptureIntegrity(data.expected).reasonCode, 'QA_EVIDENCE_MANIFEST_MISMATCH');
});

test('P3b capture integrity enforces complete screenshot coverage or explicit BLOCKED case', t => {
  const data = fixture(t);
  fs.rmSync(path.join(data.dir, ids[1] + '.png'));
  assert.equal(verifyQaCaptureIntegrity(data.expected).reasonCode, 'QA_EVIDENCE_SCREENSHOT_MISSING');
  data.manifest.status = 'BLOCKED';
  data.manifest.cases[1] = { id: ids[1], status: 'BLOCKED', screenshot: null };
  data.write();
  const report = verifyQaCaptureIntegrity(data.expected);
  assert.equal(report.status, 'INTEGRITY_VERIFIED');
  assert.equal(report.observedCaptureStatus, 'BLOCKED');
  assert.equal(report.screenshots.length, 2);
  data.manifest.status = 'STARTUP_OBSERVED';
  data.write();
  assert.equal(verifyQaCaptureIntegrity(data.expected).reasonCode, 'QA_EVIDENCE_STATUS_CONTRADICTION');
});

test('P3b capture integrity prevents traversal from editable screenshot declarations', t => {
  const data = fixture(t);
  data.manifest.cases[0].screenshot.file = '../unrelated.png';
  data.write();
  assert.equal(verifyQaCaptureIntegrity(data.expected).reasonCode, 'QA_EVIDENCE_SCREENSHOT_METADATA_INVALID');
});

test('P3b capture integrity cannot promote capture with interaction failures', t => {
  const data = fixture(t);
  data.manifest.cases[2].status = 'ISSUES_FOUND';
  data.manifest.status = 'ISSUES_FOUND';
  data.write();
  const report = verifyQaCaptureIntegrity(data.expected);
  assert.equal(report.status, 'INTEGRITY_VERIFIED');
  assert.equal(report.observedCaptureStatus, 'ISSUES_FOUND');
  assert.equal(report.browserAttested, false);
});
