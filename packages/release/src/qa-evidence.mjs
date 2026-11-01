import fs from 'node:fs';
import path from 'node:path';
import { readRegularBytes, SHA_256, sha256 } from './archive.mjs';
import { ReleaseInputError } from './errors.mjs';

const allowedCases = ['desktop-1000x720', 'mobile-390x844', 'landscape-667x375'];
const allowedOutcomes = new Set(['STARTUP_OBSERVED', 'ISSUES_FOUND', 'BLOCKED']);
const blocked = reasonCode => Object.freeze({ kind: 'qa-capture-integrity', schemaVersion: 1,
  status: 'BLOCKED', reasonCode, browserAttested: false, actualModeration: 'NOT_RUN',
  releaseReady: false, publicationAllowed: false });
const failed = reasonCode => Object.freeze({ ...blocked(reasonCode), status: 'FAIL' });

/**
 * Verify transferred QA capture bytes, not their provenance.
 * A writable JSON file and hashed screenshots cannot authenticate a browser
 * or grant PASS to simulateModeration(). P3c must inspect the actual images.
 */
export function verifyQaCaptureIntegrity({
  evidenceDir, target, candidateSha256, reportSha256,
} = {}) {
  if (!['yandex-games', 'vk-games'].includes(target) ||
      typeof candidateSha256 !== 'string' || !SHA_256.test(candidateSha256)) {
    return blocked('QA_EVIDENCE_EXPECTATIONS_REQUIRED');
  }
  if (reportSha256 !== undefined && (typeof reportSha256 !== 'string' || !SHA_256.test(reportSha256))) {
    return blocked('QA_EVIDENCE_REPORT_DIGEST_INVALID');
  }
  if (typeof evidenceDir !== 'string' || !evidenceDir.trim()) return blocked('QA_EVIDENCE_DIRECTORY_REQUIRED');
  let raw;
  try {
    raw = readRegularBytes(path.join(path.resolve(evidenceDir), 'capture.json'), 1024 * 1024);
  } catch (error) {
    return blocked(error instanceof ReleaseInputError && error.code === 'INPUT_MISSING'
      ? 'QA_EVIDENCE_MANIFEST_MISSING' : 'QA_EVIDENCE_MANIFEST_UNREADABLE');
  }
  const actualReportSha256 = sha256(raw);
  if (reportSha256 && reportSha256 !== actualReportSha256) return failed('QA_EVIDENCE_REPORT_DIGEST_MISMATCH');
  let manifest;
  try { manifest = JSON.parse(raw.toString('utf8')); }
  catch { return failed('QA_EVIDENCE_MANIFEST_JSON_INVALID'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.schemaVersion !== 1 || manifest.kind !== 'qa-browser-capture' ||
      manifest.target !== target || manifest.candidateSha256 !== candidateSha256 ||
      !['chromium', 'firefox', 'webkit'].includes(manifest.engine) ||
      typeof manifest.browserVersion !== 'string' || !manifest.browserVersion ||
      manifest.releaseReady !== false || manifest.publicationAllowed !== false ||
      manifest.actualModeration !== 'NOT_RUN' || manifest.physicalDevices !== 'NOT_RUN' ||
      manifest.sdk !== 'LIVE_NOT_TESTED' ||
      !['STARTUP_ONLY', 'STARTUP_AND_DECLARED_FLOW'].includes(manifest.observedScope) ||
      (manifest.flowSha256 !== null && !SHA_256.test(manifest.flowSha256 ?? '')) ||
      (manifest.observedScope === 'STARTUP_ONLY' && manifest.flowSha256 !== null) ||
      (manifest.observedScope === 'STARTUP_AND_DECLARED_FLOW' && !SHA_256.test(manifest.flowSha256 ?? '')) ||
      !allowedOutcomes.has(manifest.status) ||
      !Array.isArray(manifest.cases) || manifest.cases.length !== allowedCases.length) {
    return failed('QA_EVIDENCE_MANIFEST_MISMATCH');
  }
  const screenshotDigests = [];
  let hasFailures = false, hasBlocked = false;
  for (let i = 0; i < allowedCases.length; i++) {
    const entry = manifest.cases[i];
    if (!entry || typeof entry !== 'object' || entry.id !== allowedCases[i] ||
        !allowedOutcomes.has(entry.status)) return failed('QA_EVIDENCE_CASE_INVALID');
    if (entry.status === 'BLOCKED') {
      if (entry.screenshot !== null) return failed('QA_EVIDENCE_CASE_INVALID');
      hasBlocked = true;
      continue;
    }
    if (entry.status === 'ISSUES_FOUND') hasFailures = true;
    // Consistency checks are not proof that a browser really produced the
    // report. They only prevent a self-contradictory saved manifest from being
    // treated as internally sound evidence.
    for (const key of ['observedIssues', 'pageErrors', 'consoleErrors',
      'httpFailures', 'blockedRequests']) {
      if (entry[key] !== undefined && !Array.isArray(entry[key])) {
        return failed('QA_EVIDENCE_CASE_CONTRADICTION');
      }
      if (entry.status === 'STARTUP_OBSERVED' && entry[key]?.length) {
        return failed('QA_EVIDENCE_CASE_CONTRADICTION');
      }
    }
    if (entry.interaction !== undefined) {
      const interaction = entry.interaction;
      if (!interaction || typeof interaction !== 'object' ||
          !Array.isArray(interaction.steps) ||
          (manifest.flowSha256 !== null &&
           (interaction.steps.length < 1 || interaction.steps.length > 30 ||
            interaction.steps.some((step, index) => !step || typeof step !== 'object' ||
              step.index !== index || !['click', 'fill', 'expect-text', 'reload', 'browser-back'].includes(step.kind) ||
              !['PASS', 'FAIL'].includes(step.status) ||
              (step.status === 'FAIL' && index !== interaction.steps.length - 1)) ||
            (interaction.status === 'PASS' && interaction.steps.some(step => step.status !== 'PASS')) ||
            (interaction.status === 'FAIL' && interaction.steps.at(-1)?.status !== 'FAIL'))) ||
          !['NOT_RUN', 'PASS', 'FAIL'].includes(interaction.status) ||
          (manifest.flowSha256 === null &&
           (interaction.status !== 'NOT_RUN' || interaction.steps.length !== 0)) ||
          (manifest.flowSha256 !== null &&
           (interaction.status === 'NOT_RUN' || interaction.evidenceSha256 !== manifest.flowSha256)) ||
          (entry.status === 'STARTUP_OBSERVED' && interaction.status === 'FAIL')) {
        return failed('QA_EVIDENCE_CASE_CONTRADICTION');
      }
    } else if (manifest.flowSha256 !== null) {
      return failed('QA_EVIDENCE_CASE_CONTRADICTION');
    }
    const image = entry.screenshot;
    if (!image || typeof image !== 'object' ||
        image.file !== entry.id + '.png' || !SHA_256.test(image.sha256 ?? '') ||
        !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
        image.width < 1 || image.height < 1 || image.width > 16384 || image.height > 16384) {
      return failed('QA_EVIDENCE_SCREENSHOT_METADATA_INVALID');
    }
    let png;
    try { png = readRegularBytes(path.join(path.resolve(evidenceDir), image.file), 16 * 1024 * 1024); }
    catch (error) {
      return blocked(error instanceof ReleaseInputError && error.code === 'INPUT_MISSING'
        ? 'QA_EVIDENCE_SCREENSHOT_MISSING' : 'QA_EVIDENCE_SCREENSHOT_UNREADABLE');
    }
    if (sha256(png) !== image.sha256 ||
        png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        png.toString('ascii', 12, 16) !== 'IHDR' ||
        png.readUInt32BE(16) !== image.width || png.readUInt32BE(20) !== image.height) {
      return failed('QA_EVIDENCE_SCREENSHOT_DIGEST_MISMATCH');
    }
    screenshotDigests.push({ id: entry.id, sha256: image.sha256, width: image.width, height: image.height });
  }
  const expectedStatus = hasFailures ? 'ISSUES_FOUND' : hasBlocked ? 'BLOCKED' : 'STARTUP_OBSERVED';
  if (manifest.status !== expectedStatus) return failed('QA_EVIDENCE_STATUS_CONTRADICTION');
  return Object.freeze({
    kind: 'qa-capture-integrity', schemaVersion: 1, status: 'INTEGRITY_VERIFIED',
    target, candidateSha256, reportSha256: actualReportSha256, observedCaptureStatus: manifest.status,
    screenshots: screenshotDigests, browserAttested: false, provenance: 'LOCAL_BYTES_ONLY',
    actualModeration: 'NOT_RUN', releaseReady: false, publicationAllowed: false,
  });
}
