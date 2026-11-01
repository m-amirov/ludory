import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { buildYandexCandidate } from '../../../scripts/build-yandex-candidate.mjs';
import { buildVkCandidate } from '../../../scripts/build-vk-candidate.mjs';
import { createYandexC5Evidence } from '../../../scripts/yandex-c5-evidence.mjs';

function cli(...args) {
  let stdout = '', stderr = '';
  const exit = runCli(args, { out: text => { stdout += text; }, err: text => { stderr += text; } });
  return { exit, stdout, stderr, report: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null };
}

const variants = [
  ['Chromium desktop', 'chromium', false], ['Firefox desktop', 'firefox', false],
  ['WebKit desktop', 'webkit', false], ['Android Chromium', 'chromium', true],
  ['iPhone WebKit', 'webkit', true],
];

async function fixture(t, target) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-cli-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const project = path.join(folder, 'game');
  fs.mkdirSync(project);
  const plan = planCreate(project, { id: 'qa-game', title: 'QA test game', lang: 'en',
    version: '1.0.0', profile: 'web-game',
    template: target === 'yandex-games' ? 'yandex-runtime' : 'vk-runtime', targets: [target] });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  fs.writeFileSync(path.join(project, 'assets', 'cover.png'), 'original owner media');
  const archivePath = path.join(folder, 'candidate.zip');
  const receiptPath = path.join(folder, 'receipt.json');
  const sdkEvidencePath = path.join(folder, 'sdk.json');
  const rightsPath = path.join(folder, 'rights.json');
  const receipt = target === 'yandex-games'
    ? await buildYandexCandidate({ projectDir: project, outputZip: archivePath })
    : await buildVkCandidate({ projectDir: project, outputZip: archivePath });
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const media = receipt.files.find(file => file.path === 'assets/cover.png');
  fs.writeFileSync(rightsPath, JSON.stringify({ schemaVersion: 1, target,
    candidateSha256: receipt.sha256, assets: [{ path: media.path, sha256: media.sha256,
      provenance: 'owned', evidence: 'Original image author ledger' }] }));
  if (target === 'yandex-games') {
    fs.writeFileSync(sdkEvidencePath, JSON.stringify(createYandexC5Evidence({ candidateSha256: receipt.sha256,
      results: variants.map(([browser, engine, emulated]) => ({ browser, engine, emulated,
        phase: 'complete', status: 'SDK_CONTRACT_PASS' })) })));
  }
  const args = ['qa', 'simulate', '--target', target, '--archive', archivePath,
    '--receipt', receiptPath, '--rights', rightsPath,
    ...(target === 'yandex-games' ? ['--sdk-evidence', sdkEvidencePath] : [])];
  return { folder, project, archivePath, receiptPath, sdkEvidencePath, rightsPath, receipt, args };
}

test('Studio QA CLI inspects actual Yandex candidate read-only and never returns moderation approval', async t => {
  const data = await fixture(t, 'yandex-games');
  const before = fs.readdirSync(data.folder).sort();
  const result = cli(...data.args, '--json');
  assert.equal(result.exit, 2, result.stderr);
  assert.equal(result.report.kind, 'moderation-simulation');
  assert.equal(result.report.candidateSha256, data.receipt.sha256);
  assert.equal(result.report.status, 'BLOCKED');
  assert.equal(result.report.checks.find(row => row.id === 'sdk-contract').status, 'PASS');
  assert.equal(result.report.checks.find(row => row.id === 'visual-ux').status, 'BLOCKED');
  assert.equal(result.report.releaseReady, false);
  assert.equal(result.report.publicationAllowed, false);
  assert.equal(result.report.actualModeration, 'NOT_RUN');
  assert.deepEqual(fs.readdirSync(data.folder).sort(), before);
  assert.match(cli('help').stdout, /ludory qa simulate/);
  const human = cli(...data.args);
  assert.equal(human.exit, 2);
  assert.match(human.stdout, /NOT_AUTHORIZED/);
  assert.match(human.stdout, /BROWSER_NOT_RUN/);
});

test('Studio QA CLI validates VK V5 candidate separately from Yandex without writing to the project', async t => {
  const data = await fixture(t, 'vk-games');
  const before = fs.readdirSync(data.folder).sort();
  const result = cli(...data.args, '--json');
  assert.equal(result.exit, 2, result.stderr);
  assert.equal(result.report.status, 'BLOCKED');
  assert.equal(result.report.checks.find(row => row.id === 'bridge-contract').status, 'PASS');
  assert.equal(result.report.checks.find(row => row.id === 'media-declarations').status, 'PASS');
  assert.equal(result.report.checks.find(row => row.id === 'platform-policy').reasonCode, 'POLICY_SOURCE_UNVERIFIED');
  assert.deepEqual(fs.readdirSync(data.folder).sort(), before);
});

test('Studio QA CLI returns nonzero issues for changed receipt and rejects write-like options', async t => {
  const data = await fixture(t, 'vk-games');
  data.receipt.sha256 = 'f'.repeat(64);
  fs.writeFileSync(data.receiptPath, JSON.stringify(data.receipt));
  const result = cli(...data.args, '--json');
  assert.equal(result.exit, 1);
  assert.equal(result.report.status, 'ISSUES_FOUND');
  assert.ok(result.report.findings.some(row => row.id === 'build-receipt'));
  assert.equal(cli(...data.args, '--apply').exit, 1);
  assert.equal(cli(...data.args, '--unexpected', 'value').exit, 1);
  assert.equal(cli(...data.args, '--target', 'yandex-games').exit, 1);
  assert.equal(cli('qa', 'simulate', '--archive', data.archivePath, '--receipt', data.receiptPath).exit, 1);
  assert.equal(cli('qa', 'simulate', '--target', 'unknown', '--archive', data.archivePath,
    '--receipt', data.receiptPath).exit, 1);
  const invalidJson = cli('qa', 'simulate', '--target', 'unknown', '--archive', data.archivePath,
    '--receipt', data.receiptPath, '--json');
  assert.equal(invalidJson.exit, 1);
  assert.equal(invalidJson.report.status, 'FAILED');
  assert.deepEqual(invalidJson.report.writes, []);
  assert.equal(cli('qa', 'simulate', '--json').report.status, 'FAILED');
});

test('Studio QA CLI returns exit 2 for an absent VK candidate instead of claiming a defect', async t => {
  const data = await fixture(t, 'vk-games');
  const missingArchive = path.join(data.folder, 'absent.zip');
  const args = data.args.map(arg => arg === data.archivePath ? missingArchive : arg);
  const result = cli(...args, '--json');
  assert.equal(result.exit, 2);
  assert.equal(result.report.status, 'BLOCKED');
  assert.equal(result.report.checks.find(row => row.id === 'archive').reasonCode, 'INPUT_MISSING');
  assert.deepEqual(result.report.findings, []);
});
