import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli.mjs';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { buildYandexCandidate } from '../../../scripts/build-yandex-candidate.mjs';
import { createYandexC5Evidence } from '../../../scripts/yandex-c5-evidence.mjs';

function cli(...args) {
  let stdout = '', stderr = '';
  const exit = runCli(args, { out: message => { stdout += message; }, err: message => { stderr += message; } });
  return { exit, stdout, stderr, report: stdout.trim().startsWith('{') ? JSON.parse(stdout) : null };
}

async function prepare(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-release-cli-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const project = path.join(folder, 'game');
  fs.mkdirSync(project);
  const options = { id: 'release-game', title: 'Release fixture', lang: 'en', version: '1.0.0',
    profile: 'web-game', template: 'yandex-runtime', targets: ['yandex-games'] };
  const preview = planCreate(project, options);
  assert.equal(preview.status, 'READY');
  assert.equal(applyCreatePlan(preview).status, 'APPLIED');
  fs.writeFileSync(path.join(project, 'assets', 'cover.png'), 'owner original image');
  const archive = path.join(folder, 'candidate.zip');
  const receipt = await buildYandexCandidate({ projectDir: project, outputZip: archive });
  const receiptPath = path.join(folder, 'receipt.json');
  const sdkEvidencePath = path.join(folder, 'sdk.json');
  const rightsPath = path.join(folder, 'rights.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const variants = [
    ['Chromium desktop', 'chromium', false], ['Firefox desktop', 'firefox', false],
    ['WebKit desktop', 'webkit', false], ['Android Chromium', 'chromium', true],
    ['iPhone WebKit', 'webkit', true],
  ];
  fs.writeFileSync(sdkEvidencePath, JSON.stringify(createYandexC5Evidence({ candidateSha256: receipt.sha256,
    results: variants.map(([browser, engine, emulated]) => ({ browser, engine, emulated,
      phase: 'complete', status: 'SDK_CONTRACT_PASS' })) })));
  const image = receipt.files.find(file => file.path === 'assets/cover.png');
  fs.writeFileSync(rightsPath, JSON.stringify({ schemaVersion: 1, target: 'yandex-games',
    candidateSha256: receipt.sha256, assets: [{ path: image.path, sha256: image.sha256,
      provenance: 'owned', evidence: 'Original cover image by project author' }] }));
  return { folder, project, archive, receiptPath, sdkEvidencePath, rightsPath };
}

test('Studio Release CLI inspects actual C5 archive and leaves owner files untouched', async t => {
  const data = await prepare(t);
  const args = ['release', 'check', '--archive', data.archive, '--receipt', data.receiptPath,
    '--sdk-evidence', data.sdkEvidencePath, '--rights', data.rightsPath, '--json'];
  const before = fs.readdirSync(data.folder).sort();
  const result = cli(...args);
  assert.equal(result.exit, 0, result.stderr);
  assert.equal(result.report.status, 'PASS_LOCAL');
  assert.equal(result.report.releaseReady, false);
  assert.equal(result.report.publicationAllowed, false);
  assert.deepEqual(fs.readdirSync(data.folder).sort(), before);
  assert.match(cli('help').stdout, /ludory release check/);
});

test('Studio Release CLI rejects mutation flags and fails closed for missing input', async t => {
  const data = await prepare(t);
  const args = ['release', 'check', '--archive', data.archive, '--receipt', data.receiptPath,
    '--sdk-evidence', data.sdkEvidencePath, '--rights', data.rightsPath, '--json'];
  assert.equal(cli(...args, '--apply').exit, 1);
  assert.equal(cli(...args, '--apply').report?.status, 'FAILED');
  fs.unlinkSync(data.sdkEvidencePath);
  const blocked = cli(...args);
  assert.equal(blocked.exit, 2);
  assert.equal(blocked.report.status, 'BLOCKED');
  assert.equal(blocked.report.releaseReady, false);
});
