import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { captureTrustedCandidate } from './qa-capture.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const targets = ['yandex-games', 'vk-games'];
function fixture(t, target, { injectedScript = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-qa-capture-smoke-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = { schemaVersion: 1, id: 'qa-capture-demo', version: '1.0.0',
    title: { en: 'Capture test' }, engine: 'web', targets: [target] };
  const entries = {
    'index.html': '<!doctype html><html><head><title>QA</title></head><body><main id="game">Ready to capture</main><script src="/src/main.js"></script></body></html>',
    'ludory.project.json': JSON.stringify(project),
    'src/main.js': 'document.querySelector("#game").dataset.ready = "true";' + injectedScript,
    ...(target === 'yandex-games'
      ? { 'assets/ludory-yandex.js': '// local adapter' }
      : { 'assets/ludory-vk.js': '// local adapter', 'assets/vk-bridge.js': '// bridge',
        'licenses/swc-helpers.txt': 'license', 'licenses/vk-bridge.txt': 'license' }),
  };
  const bytes = Buffer.from(zipSync(Object.fromEntries(Object.entries(entries)
    .map(([name, body]) => [name, new Uint8Array(Buffer.from(body))])), { level: 0 }));
  const archivePath = path.join(dir, 'candidate.zip');
  const receiptPath = path.join(dir, 'receipt.json');
  fs.writeFileSync(archivePath, bytes);
  fs.writeFileSync(receiptPath, JSON.stringify({ archivePath, sha256: sha(bytes),
    files: Object.entries(entries).map(([name, body]) => ({
      path: name, sha256: sha(body), size: Buffer.byteLength(body) })) }));
  return { dir, target, archivePath, receiptPath, bytes,
    outputDir: path.join(os.tmpdir(), 'ludory-qa-capture-evidence-' + path.basename(dir)) };
}

for (const target of targets) {
  test('P3b Playwright captures real startup screenshots for ' + target, { timeout: 90000 }, async t => {
    const data = fixture(t, target);
    t.after(() => fs.rmSync(data.outputDir, { recursive: true, force: true }));
    const result = await captureTrustedCandidate({ ...data, trusted: true, engine: 'chromium' });
    assert.equal(result.status, 'STARTUP_OBSERVED', JSON.stringify(result, null, 2));
    assert.equal(result.candidateSha256, sha(data.bytes));
    assert.deepEqual(result.cases.map(item => item.status), Array(3).fill('STARTUP_OBSERVED'));
    assert.equal(result.cases.length, 3);
    assert.ok(result.cases.every(item => item.screenshot?.sha256?.length === 64));
    for (const item of result.cases) {
      const png = fs.readFileSync(path.join(data.outputDir, item.screenshot.file));
      assert.equal(sha(png), item.screenshot.sha256);
      assert.ok(item.screenshot.width >= item.viewport.width);
      assert.ok(item.screenshot.height >= item.viewport.height);
      assert.equal(item.gameplayRoutes, 'NOT_RUN');
      assert.equal(item.sdk, 'LIVE_NOT_TESTED');
    }
    const manifest = fs.readFileSync(path.join(data.outputDir, 'capture.json'));
    assert.equal(sha(manifest), result.reportSha256);
    assert.equal(JSON.parse(manifest.toString('utf8')).actualModeration, 'NOT_RUN');
    assert.equal(result.releaseReady, false);
    assert.equal(result.publicationAllowed, false);
    assert.deepEqual(fs.readFileSync(data.archivePath), data.bytes);
  });
}

test('P3b refuses untrusted, mutated or missing browser inputs before producing evidence', { timeout: 30000 }, async t => {
  const data = fixture(t, 'vk-games');
  const noTrust = await captureTrustedCandidate({ ...data });
  assert.equal(noTrust.reasonCode, 'QA_TRUSTED_EXECUTION_NOT_AUTHORIZED');
  const absent = await captureTrustedCandidate({ ...data, trusted: true, playwrightModule: {} });
  assert.equal(absent.reasonCode, 'QA_PLAYWRIGHT_UNAVAILABLE');
  assert.equal(fs.existsSync(data.outputDir), false);
  const receipt = JSON.parse(fs.readFileSync(data.receiptPath, 'utf8'));
  receipt.sha256 = 'a'.repeat(64);
  fs.writeFileSync(data.receiptPath, JSON.stringify(receipt));
  const mutated = await captureTrustedCandidate({ ...data, trusted: true });
  assert.equal(mutated.reasonCode, 'QA_CANDIDATE_UNVERIFIED');
  assert.equal(fs.existsSync(data.outputDir), false);
});

test('P3b browser capture records real console failures and blocked external requests', { timeout: 90000 }, async t => {
  const data = fixture(t, 'vk-games', {
    injectedScript: 'console.error("qa-test-visible-error");fetch("https://example.invalid/untrusted.js").catch(() => {});',
  });
  t.after(() => fs.rmSync(data.outputDir, { recursive: true, force: true }));
  const result = await captureTrustedCandidate({ ...data, trusted: true, engine: 'chromium' });
  assert.equal(result.status, 'ISSUES_FOUND', JSON.stringify(result, null, 2));
  assert.ok(result.cases.every(item => item.observedIssues?.includes('CONSOLE_OR_HTTP_ERROR')));
  assert.ok(result.cases.every(item => item.observedIssues?.includes('EXTERNAL_REQUEST_BLOCKED')));
  assert.ok(result.cases.every(item => item.screenshot?.sha256?.length === 64));
  assert.equal(result.releaseReady, false);
  assert.equal(result.publicationAllowed, false);
});

test('P3b declared flow observes save/reload, back button and text entry on each viewport',
  { timeout: 90000 }, async t => {
    const data = fixture(t, 'vk-games', { injectedScript: `
document.body.insertAdjacentHTML('beforeend', '<button id="start">Start</button><button id="back">Back</button><p id="stage"></p><textarea id="note"></textarea><button id="send">Send</button><p id="message"></p>');
const render = () => document.querySelector('#stage').textContent = localStorage.getItem('chapter') || 'Chapter 1';
document.querySelector('#start').onclick = () => { localStorage.setItem('chapter', 'Chapter 2'); render(); };
document.querySelector('#back').onclick = () => { localStorage.setItem('chapter', 'Chapter 1'); render(); };
document.querySelector('#send').onclick = () => document.querySelector('#message').textContent = document.querySelector('#note').value;
render();` });
    t.after(() => fs.rmSync(data.outputDir, { recursive: true, force: true }));
    const flowPath = path.join(data.dir, 'flow.json');
    const steps = [
      { kind: 'click', selector: '#start' },
      { kind: 'expect-text', selector: '#stage', text: 'Chapter 2' },
      { kind: 'reload' },
      { kind: 'expect-text', selector: '#stage', text: 'Chapter 2' },
      { kind: 'click', selector: '#back' },
      { kind: 'expect-text', selector: '#stage', text: 'Chapter 1' },
      { kind: 'fill', selector: '#note', text: 'Player choice' },
      { kind: 'click', selector: '#send' },
      { kind: 'expect-text', selector: '#message', text: 'Player choice' },
    ];
    fs.writeFileSync(flowPath, JSON.stringify({ schemaVersion: 1, target: data.target,
      candidateSha256: sha(data.bytes), steps }));
    const result = await captureTrustedCandidate({ ...data, flowPath, trusted: true });
    assert.equal(result.status, 'STARTUP_OBSERVED', JSON.stringify(result, null, 2));
    assert.equal(result.observedScope, 'STARTUP_AND_DECLARED_FLOW');
    assert.equal(result.flowSha256, sha(fs.readFileSync(flowPath)));
    assert.equal(result.cases.length, 3);
    assert.ok(result.cases.every(item => item.interaction?.status === 'PASS'));
    assert.ok(result.cases.every(item => item.interaction.steps.length === steps.length));
    assert.ok(result.cases.every(item => item.gameplayRoutes === 'DECLARED_STEPS_ONLY'));
    assert.equal(result.actualModeration, 'NOT_RUN');
    assert.equal(result.releaseReady, false);
  });

test('P3b rejects forged/stale flow and arbitrary script steps before launching browser',
  { timeout: 30000 }, async t => {
    const data = fixture(t, 'yandex-games');
    t.after(() => fs.rmSync(data.outputDir, { recursive: true, force: true }));
    const flowPath = path.join(data.dir, 'flow.json');
    const source = { schemaVersion: 1, target: data.target,
      candidateSha256: 'a'.repeat(64), steps: [{ kind: 'click', selector: '#start' }] };
    fs.writeFileSync(flowPath, JSON.stringify(source));
    let result = await captureTrustedCandidate({ ...data, flowPath, trusted: true });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.reasonCode, 'QA_FLOW_CANDIDATE_MISMATCH');
    source.candidateSha256 = sha(data.bytes);
    source.steps = [{ kind: 'evaluate', code: 'fetch("https://example.org")' }];
    fs.writeFileSync(flowPath, JSON.stringify(source));
    result = await captureTrustedCandidate({ ...data, flowPath, trusted: true });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.reasonCode, 'QA_FLOW_STEP_INVALID');
    assert.equal(fs.existsSync(data.outputDir), false);
  });

test('P3b marks failed declared assertion as an issue, not a successful game test',
  { timeout: 90000 }, async t => {
    const data = fixture(t, 'vk-games');
    t.after(() => fs.rmSync(data.outputDir, { recursive: true, force: true }));
    const flowPath = path.join(data.dir, 'flow.json');
    fs.writeFileSync(flowPath, JSON.stringify({ schemaVersion: 1, target: data.target,
      candidateSha256: sha(data.bytes),
      steps: [{ kind: 'expect-text', selector: '#game', text: 'not-present-in-candidate' }] }));
    const result = await captureTrustedCandidate({ ...data, flowPath, trusted: true, timeoutMs: 1000 });
    assert.equal(result.status, 'ISSUES_FOUND', JSON.stringify(result, null, 2));
    assert.ok(result.cases.every(row => row.interaction?.status === 'FAIL'));
    assert.ok(result.cases.every(row => row.observedIssues?.includes('INTERACTION_FLOW_FAILED')));
    assert.equal(result.actualModeration, 'NOT_RUN');
    assert.equal(result.releaseReady, false);
    assert.equal(result.publicationAllowed, false);
  });

test('P3b cannot claim PASS from hidden DOM text',
  { timeout: 90000 }, async t => {
    const data = fixture(t, 'vk-games', { injectedScript:
      "document.body.insertAdjacentHTML('beforeend', '<p id=secret hidden>Private hidden answer</p>');" });
    t.after(() => fs.rmSync(data.outputDir, { recursive: true, force: true }));
    const flowPath = path.join(data.dir, 'flow.json');
    fs.writeFileSync(flowPath, JSON.stringify({ schemaVersion: 1, target: data.target,
      candidateSha256: sha(data.bytes),
      steps: [{ kind: 'expect-text', selector: '#secret', text: 'Private hidden answer' }] }));
    const result = await captureTrustedCandidate({ ...data, flowPath, trusted: true, timeoutMs: 1000 });
    assert.equal(result.status, 'ISSUES_FOUND', JSON.stringify(result, null, 2));
    assert.ok(result.cases.every(row => row.interaction?.status === 'FAIL'));
    assert.ok(result.cases.every(row => row.observedIssues?.includes('INTERACTION_FLOW_FAILED')));
  });
