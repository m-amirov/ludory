import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { simulateModeration, stageQaCandidate } from '../../../release/src/index.mjs';
import { startPreviewServer } from '../../../studio/src/preview-server.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = Object.freeze([
  { id: 'desktop-1000x720', viewport: { width: 1000, height: 720 }, isMobile: false },
  { id: 'mobile-390x844', viewport: { width: 390, height: 844 }, isMobile: true },
  { id: 'landscape-667x375', viewport: { width: 667, height: 375 }, isMobile: true },
]);
const blocked = reasonCode => ({ kind: 'qa-browser-capture', schemaVersion: 1, status: 'BLOCKED',
  reasonCode, browserObservation: 'NOT_RUN', releaseReady: false, publicationAllowed: false,
  actualModeration: 'NOT_RUN' });
const pngDimensions = bytes => {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('QA_SCREENSHOT_INVALID');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};
const inside = (root, child) => child === root || child.startsWith(root + path.sep);

function validateOutput(outputDir, archivePath, stagedRoot) {
  if (typeof outputDir !== 'string' || !outputDir.trim()) throw new Error('QA_OUTPUT_REQUIRED');
  const output = path.resolve(outputDir);
  const archive = path.resolve(archivePath);
  const stage = path.resolve(stagedRoot);
  if (inside(stage, output) || inside(output, stage) ||
      inside(path.dirname(archive), output) || output === archive) {
    throw new Error('QA_OUTPUT_UNSAFE_LOCATION');
  }
  if (fs.existsSync(output)) throw new Error('QA_OUTPUT_EXISTS');
  const parent = fs.realpathSync(path.dirname(output));
  if (!fs.statSync(parent).isDirectory()) throw new Error('QA_OUTPUT_PARENT_INVALID');
  if (path.resolve(parent, path.basename(output)) !== output) throw new Error('QA_OUTPUT_PARENT_SYMLINK');
  return output;
}

/**
 * Explicit opt-in Playwright capture for an owner-trusted candidate.
 * No Docker, container isolation, SDK host or moderation authority.
 * Only STARTUP is observed: saves, monetization and gameplay routes remain NOT_RUN.
 */
export async function captureTrustedCandidate({
  target, archivePath, receiptPath, sdkEvidencePath, rightsPath, metadataPath, promoRoot,
  outputDir, trusted = false, engine = 'chromium', timeoutMs = 10000, playwrightModule,
} = {}) {
  if (!trusted) return blocked('QA_TRUSTED_EXECUTION_NOT_AUTHORIZED');
  if (!['chromium', 'firefox', 'webkit'].includes(engine) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    return blocked('QA_BROWSER_OPTIONS_INVALID');
  }
  let local;
  try { local = simulateModeration({ target, archivePath, receiptPath, sdkEvidencePath,
    rightsPath, metadataPath, promoRoot }); }
  catch (error) { return { ...blocked('QA_INPUT_INVALID'), message: String(error.code ?? error.message) }; }
  const archiveGate = local.checks.find(item => item.id === 'archive');
  const receiptGate = local.checks.find(item => item.id === 'build-receipt');
  if (archiveGate?.status !== 'PASS' || receiptGate?.status !== 'PASS' ||
      !local.candidateSha256) return { ...blocked('QA_CANDIDATE_UNVERIFIED'), target };
  let stage, server, browser, context;
  try {
    stage = stageQaCandidate({ target, archivePath, candidateSha256: local.candidateSha256 });
    const output = validateOutput(outputDir, archivePath, stage.root);
    let playwright;
    try { playwright = playwrightModule ?? await import('playwright'); }
    catch { return { ...blocked('QA_PLAYWRIGHT_UNAVAILABLE'), target, candidateSha256: local.candidateSha256 }; }
    const browserType = playwright[engine];
    if (typeof browserType?.launch !== 'function') return blocked('QA_PLAYWRIGHT_UNAVAILABLE');
    try { browser = await browserType.launch({ headless: true, timeout: timeoutMs }); }
    catch { return { ...blocked('QA_BROWSER_BINARY_UNAVAILABLE'), target, candidateSha256: local.candidateSha256 }; }
    try { server = await startPreviewServer({ root: stage.root, port: 0, lan: false,
      buildSha256: local.candidateSha256 }); }
    catch { return { ...blocked('QA_PREVIEW_UNAVAILABLE'), target, candidateSha256: local.candidateSha256 }; }
    // Create evidence only after input, browser and preview preflights.
    fs.mkdirSync(output, { mode: 0o700 });
    const entries = [];
    const baseOrigin = new URL(server.url).origin;
    for (const item of cases) {
      const failures = [];
      const blockedRequests = [];
      const consoleErrors = [];
      const pageErrors = [];
      let page;
      try {
        context = await browser.newContext({ viewport: item.viewport,
          isMobile: item.isMobile, hasTouch: item.isMobile, serviceWorkers: 'block',
          acceptDownloads: false, ignoreHTTPSErrors: false });
        context.setDefaultTimeout(timeoutMs);
        await context.route('**/*', route => {
          const url = route.request().url();
          if (url.startsWith(baseOrigin + '/')) return route.continue();
          if (blockedRequests.length < 20) blockedRequests.push('REQUEST_OUTSIDE_CANDIDATE_ORIGIN');
          return route.abort('blockedbyclient');
        });
        page = await context.newPage();
        page.on('pageerror', e => { if (pageErrors.length < 20) pageErrors.push(String(e).slice(0, 500)); });
        page.on('console', m => { if (m.type() === 'error' && consoleErrors.length < 20)
          consoleErrors.push(m.text().slice(0, 500)); });
        page.on('response', r => { if (r.status() >= 400 && failures.length < 20)
          failures.push({ status: r.status(), path: new URL(r.url()).pathname }); });
        await page.goto(server.url, { waitUntil: 'load', timeout: timeoutMs });
        await page.waitForTimeout(250);
        const dom = await page.evaluate(() => ({
          title: document.title.slice(0, 200),
          visibleTextLength: document.body?.innerText?.trim().length ?? 0,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
        }));
        const imageName = item.id + '.png';
        const imageBytes = await page.screenshot({ fullPage: true, timeout: timeoutMs });
        fs.writeFileSync(path.join(output, imageName), imageBytes, { flag: 'wx', mode: 0o600 });
        const viewport = page.viewportSize();
        const screenshot = { file: imageName, sha256: sha256(imageBytes), ...pngDimensions(imageBytes) };
        const observedIssues = [];
        if (dom.visibleTextLength === 0) observedIssues.push('NO_VISIBLE_TEXT');
        if (dom.scrollWidth > dom.clientWidth + 2) observedIssues.push('HORIZONTAL_OVERFLOW');
        if (pageErrors.length) observedIssues.push('PAGE_EXCEPTION');
        if (consoleErrors.length || failures.length) observedIssues.push('CONSOLE_OR_HTTP_ERROR');
        if (blockedRequests.length) observedIssues.push('EXTERNAL_REQUEST_BLOCKED');
        entries.push({ id: item.id, status: observedIssues.length ? 'ISSUES_FOUND' : 'STARTUP_OBSERVED',
          viewport, deviceScaleFactor: await page.evaluate(() => devicePixelRatio),
          browser: engine, screenshot, dom, pageErrors, consoleErrors, httpFailures: failures,
          blockedRequests, observedIssues, sdk: 'LIVE_NOT_TESTED', physicalDevice: false,
          actions: ['navigate', 'inspect-dom', 'screenshot'], gameplayRoutes: 'NOT_RUN',
          saveReload: 'NOT_RUN', audioFocus: 'NOT_RUN' });
      } catch (error) {
        entries.push({ id: item.id, status: 'BLOCKED', reasonCode: 'QA_BROWSER_CASE_FAILED',
          detail: String(error.message).slice(0, 300), screenshot: null });
      } finally {
        if (context) { await context.close().catch(() => {}); context = null; }
      }
    }
    const status = entries.some(item => item.status === 'ISSUES_FOUND') ? 'ISSUES_FOUND'
      : entries.some(item => item.status === 'BLOCKED') ? 'BLOCKED' : 'STARTUP_OBSERVED';
    const report = { schemaVersion: 1, kind: 'qa-browser-capture', status, target,
      candidateSha256: local.candidateSha256, engine, browserVersion: browser.version(),
      cases: entries, observedScope: 'STARTUP_ONLY', sdk: 'LIVE_NOT_TESTED',
      physicalDevices: 'NOT_RUN', actualModeration: 'NOT_RUN',
      releaseReady: false, publicationAllowed: false, outputDirectory: output };
    const encoded = Buffer.from(JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'capture.json'), encoded, { flag: 'wx', mode: 0o600 });
    return { ...report, reportSha256: sha256(encoded) };
  } catch (error) {
    return { ...blocked('QA_BROWSER_CAPTURE_FAILED'), target,
      message: String(error.code ?? error.message).slice(0, 200) };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    if (stage) stage.cleanup();
  }
}

function parseArgs(args) {
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--target', '--archive', '--receipt', '--sdk-evidence', '--rights', '--metadata',
      '--promo-root', '--output', '--engine', '--timeout-ms', '--trusted'].includes(key) ||
      flags.has(key)) throw new Error('QA_ARGUMENT_INVALID');
    flags.set(key, key === '--trusted' ? true : args[++i]);
  }
  for (const key of ['--target', '--archive', '--receipt', '--output', '--trusted']) {
    if (!flags.get(key)) throw new Error('QA_ARGUMENT_REQUIRED_' + key);
  }
  return { target: flags.get('--target'), archivePath: flags.get('--archive'),
    receiptPath: flags.get('--receipt'), sdkEvidencePath: flags.get('--sdk-evidence'),
    rightsPath: flags.get('--rights'), metadataPath: flags.get('--metadata'),
    promoRoot: flags.get('--promo-root'), outputDir: flags.get('--output'),
    engine: flags.get('--engine'), trusted: true,
    timeoutMs: flags.has('--timeout-ms') ? Number(flags.get('--timeout-ms')) : undefined };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await captureTrustedCandidate(parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = report.status === 'STARTUP_OBSERVED' ? 0 : report.status === 'BLOCKED' ? 2 : 1;
  } catch (error) {
    process.stderr.write('Ludory QA capture: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
