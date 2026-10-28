import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { qualityGame } from './helpers/quality-game.mjs';
import { planQualityEnable, applyQualityEnable } from '../src/quality-policy.mjs';
import { persistQualityReceipt, qualityStatus, planQualityEvidence } from '../src/quality-store.mjs';

test('public receipt writer cannot manufacture PASS without a complete observed tier', t => {
  const project = qualityGame(t);
  applyQualityEnable(planQualityEnable(project));
  assert.throws(() => persistQualityReceipt(project, {
    tier: 'quick', status: 'PASS', checks: [
      { name: 'tests', status: 'PASS', observed: true, exitCode: 0 },
    ], report: {},
  }), /QUALITY_PASS_UNATTESTED|QUALITY_RECEIPT_INVALID/);
  assert.equal(qualityStatus(project).status, 'NOT_RUN');
});

const example = {
  tier: 'quick', status: 'BLOCKED', reasonCode: 'QUALITY_TOOL_MISSING',
  checks: [{ name: 'crapper', status: 'BLOCKED', reasonCode: 'QUALITY_TOOL_MISSING' }],
  report: { schemaVersion: 1, checks: [{ name: 'crapper', status: 'BLOCKED' }] },
};

function enabled(t) {
  const project = qualityGame(t);
  assert.equal(applyQualityEnable(planQualityEnable(project)).status, 'ENABLED');
  return project;
}

test('quality receipts form a verified append-only chain and report exact blockers', t => {
  const project = enabled(t);
  assert.equal(qualityStatus(project).status, 'NOT_RUN');
  const a = persistQualityReceipt(project, example);
  assert.equal(a.status, 'BLOCKED');
  assert.match(a.receiptDigest, /^[a-f0-9]{64}$/);
  assert.equal(qualityStatus(project).status, 'BLOCKED');
  const b = persistQualityReceipt(project, { ...example, reasonCode: 'QUALITY_COVERAGE_MISSING' });
  assert.equal(b.previousReceiptDigest, a.receiptDigest);
  const loaded = planQualityEvidence(project, { run: a.qualityRunId });
  assert.equal(loaded.status, 'BLOCKED');
  assert.equal(loaded.receipt.reasonCode, 'QUALITY_TOOL_MISSING');
  assert.equal(planQualityEvidence(project, { run: 'latest' }).receipt.reasonCode, 'QUALITY_COVERAGE_MISSING');
});

test('tampered report, receipt, or broken chain never returns a passing verdict', t => {
  const project = enabled(t);
  const a = persistQualityReceipt(project, example);
  const report = path.join(project, '.ludory', 'quality', 'runs', a.qualityRunId, 'report.json');
  fs.writeFileSync(report, '{}');
  assert.equal(qualityStatus(project).status, 'BLOCKED');
  assert.equal(qualityStatus(project).reasonCode, 'QUALITY_EVIDENCE_INTEGRITY');
  assert.equal(planQualityEvidence(project, { run: a.qualityRunId }).status, 'BLOCKED');
});

test('source changes after check report STALE without rewriting historical receipts', t => {
  const project = enabled(t);
  const evidence = persistQualityReceipt(project, example);
  const historical = path.join(project, '.ludory', 'quality', 'runs', evidence.qualityRunId, 'receipt.json');
  const original = fs.readFileSync(historical);
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'export const repaired = true;\n');
  assert.equal(qualityStatus(project).status, 'STALE');
  assert.deepEqual(fs.readFileSync(historical), original);
});

test('symlink replacement and pending/incomplete receipt fail closed without off-project writes', t => {
  const project = enabled(t);
  const first = persistQualityReceipt(project, example);
  const report = path.join(project, '.ludory', 'quality', 'runs', first.qualityRunId, 'report.json');
  fs.unlinkSync(report);
  fs.symlinkSync(path.join(project, 'src', 'main.js'), report);
  assert.equal(qualityStatus(project).status, 'BLOCKED');
  assert.equal(qualityStatus(project).reasonCode, 'QUALITY_EVIDENCE_INTEGRITY');
});

test('an unfinished executor attempt without a committed receipt is inspectably blocked', t => {
  const project = enabled(t);
  persistQualityReceipt(project, example);
  const orphan = path.join(project, '.ludory', 'quality', 'attempts', '1793000000000-abcdef123456');
  fs.mkdirSync(orphan, { recursive: true });
  const status = qualityStatus(project);
  assert.equal(status.status, 'BLOCKED');
  assert.equal(status.reasonCode, 'QUALITY_EXECUTION_INTERRUPTED');
  const evidence = planQualityEvidence(project);
  assert.equal(evidence.status, 'BLOCKED');
  assert.equal(evidence.reasonCode, 'QUALITY_EXECUTION_INTERRUPTED');
});
