#!/usr/bin/env node
/** Owner-operated, noninteractive read-only R3 observation. Never uploads/publishes. */
import https from 'node:https';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { prepareDraftProbe, validateGameBase, verifyServedCandidate,
  finalizeDraftObservation, draftFailureReport } from '../../../release/src/draft-probe.mjs';

function flags(argv) {
  const allowed = new Set(['--archive', '--receipt', '--sdk-evidence', '--rights', '--draft-url', '--execute']);
  const result = new Map();
  for (let i = 0; i < argv.length; ++i) {
    const key = argv[i];
    if (!allowed.has(key) || result.has(key)) throw new Error('R3_OPTIONS_INVALID');
    if (key === '--execute') result.set(key, true);
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('R3_OPTIONS_INVALID');
      result.set(key, value);
    }
  }
  for (const key of ['--archive', '--receipt', '--sdk-evidence', '--rights', '--draft-url']) {
    if (!result.has(key)) throw new Error('R3_REQUIRED_INPUT');
  }
  return result;
}

/** Bounded TLS download, no redirects, cookies, or content decompression. */
function hashRemoteFile(url, expectedSize) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-store' },
      timeout: 10000, agent: false }, response => {
      if (response.statusCode !== 200 || response.headers['content-encoding']) {
        response.destroy(); reject(new Error('R3_ASSET_HTTP_NOT_PLAIN_200')); return;
      }
      let size = 0;
      const digest = createHash('sha256');
      response.on('data', bytes => {
        size += bytes.length;
        if (size > expectedSize) { response.destroy(new Error('R3_ASSET_TOO_LARGE')); return; }
        digest.update(bytes);
      });
      response.on('end', () => resolve({ size, sha256: digest.digest('hex') }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('R3_ASSET_TIMEOUT')));
    request.on('error', reject);
  });
}

async function observe(prepared) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', () => pageErrors.push('PAGE_ERROR'));
    const response = await page.goto(prepared.draft.href, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (!response?.ok() || new URL(page.url()).origin !== prepared.draft.origin) throw new Error('R3_DRAFT_NAVIGATION_FAILED');
    const deadline = Date.now() + 20000;
    let gameFrame;
    while (Date.now() < deadline && !gameFrame) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          if (await frame.locator('#status[data-last-operation="bootstrap:error"]').count() > 0) {
            throw new Error('R3_SDK_BOOTSTRAP_FAILED');
          }
          if (await frame.locator('#game[data-mounted="true"]').count() > 0 &&
              await frame.locator('#status[data-host="READY"][data-sdk-ready="true"]:not([data-error-code])').count() > 0) {
            gameFrame = frame;
            break;
          }
        } catch (error) {
          if (error?.message === 'R3_SDK_BOOTSTRAP_FAILED') throw error;
          // Cross-origin and unloading frames are not proof.
        }
      }
      if (!gameFrame) await page.waitForTimeout(200);
    }
    if (!gameFrame || pageErrors.length) throw new Error('R3_GAME_NOT_READY');
    const frameUrl = new URL(gameFrame.url());
    if (frameUrl.protocol !== 'https:' || frameUrl.searchParams.has('game_url')) throw new Error('R3_FRAME_NOT_HOSTED');
    const root = new URL('.', frameUrl);
    validateGameBase(root.href); // Reject owner-controlled localhost / arbitrary hosts.
    const count = await verifyServedCandidate(prepared.files, root.href, hashRemoteFile);
    // Recheck after potentially slow network hashing; READY may precede a failed SDK bootstrap.
    const bootstrap = await gameFrame.locator('#status').evaluate(element => ({
      ready: element.dataset.host === 'READY',
      sdkReady: element.dataset.sdkReady === 'true',
      bootstrapError: element.dataset.lastOperation === 'bootstrap:error' || !!element.dataset.errorCode,
    }));
    if (bootstrap.bootstrapError) throw new Error('R3_SDK_BOOTSTRAP_FAILED');
    return finalizeDraftObservation(prepared, { frameLinked: true, ...bootstrap,
      browser: 'chromium', filesVerified: count });
  } finally { await browser.close(); }
}

let report;
try {
  const args = flags(process.argv.slice(2));
  const prepared = prepareDraftProbe({ archivePath: args.get('--archive'), receiptPath: args.get('--receipt'),
    sdkEvidencePath: args.get('--sdk-evidence'), rightsPath: args.get('--rights'), draftUrl: args.get('--draft-url') });
  report = args.has('--execute') && prepared.report.reasonCode === 'AWAIT_OWNER_AUTHORIZED_BROWSER'
    ? await observe(prepared) : prepared.report;
} catch (error) {
  report = draftFailureReport(error);
}
console.log(JSON.stringify(report, null, 2));
if (report.status === 'FAIL') process.exitCode = 1;
else if (report.status === 'BLOCKED') process.exitCode = 2;
else process.exitCode = 0;
