import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox, webkit, devices } from 'playwright';

const dir = fileURLToPath(new URL('.', import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-n2-browser-'));
await build({ entryPoints: [path.join(dir, 'entry.mjs')], outfile: path.join(out, 'bundle.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#141d29;color:white;font:16px system-ui">
<div id="controls"><button id="start">Start</button><button id="pause">Pause</button><button id="resume">Resume</button><button id="save">Save</button><button id="restore">Restore</button><span id="status"></span></div>
<main id="game" style="width:100%;height:calc(100dvh - 48px)"></main><script type="module" src="./bundle.js"></script></body></html>`);
fs.mkdirSync(path.join(out, 'assets'));
fs.writeFileSync(path.join(out, 'assets/large-art.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1400"><rect width="100%" height="100%" fill="royalblue"/></svg>');
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const target = path.resolve(out, `.${name === '/' ? '/index.html' : name}`);
  if (!target.startsWith(`${out}${path.sep}`)) { response.writeHead(403).end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': path.extname(target) === '.js' ? 'text/javascript' :
      path.extname(target) === '.svg' ? 'image/svg+xml' : 'text/html' }).end(data);
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
const artifactDirectory = process.env.LUDORY_N2_ARTIFACT_DIR ?
  path.resolve(dir, process.env.LUDORY_N2_ARTIFACT_DIR) : null;
if (artifactDirectory) fs.mkdirSync(artifactDirectory, { recursive: true });

async function scenario(name, browserType, contextOptions) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  const outbound = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith(base) && !request.url().startsWith('data:')) outbound.push(request.url());
  });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.n2Host?.getStatus() === 'READY');
    await page.locator('#start').click();
    const press = locator => contextOptions.isMobile ? locator.tap() : locator.click();
    await press(page.getByRole('button', { name: /Далее/ }));
    await page.locator('.ludory-narrative__actions img').waitFor();
    await page.locator('.ludory-narrative__actions img').evaluate(img => img.decode());
    const artworkSize = await page.locator('.ludory-narrative__actions img').evaluate(img => ({
      width: img.getBoundingClientRect().width, intrinsic: img.naturalWidth }));
    if (artworkSize.intrinsic <= 0 || artworkSize.width > 320) {
      throw new Error(`Oversized artwork escaped responsive constraint: ${JSON.stringify(artworkSize)}`);
    }
    await press(page.getByRole('button', { name: /Снять гавань/ }));
    await press(page.getByRole('button', { name: /Ракушка/ }));
    await page.waitForFunction(() => window.n2Host.getSnapshot().state.narrative.album.includes('harbor'));
    await page.getByText('Встречаемся? Я пришлю фото.').waitFor();
    const support = page.locator('[data-intent="support"]');
    await support.focus();
    await page.keyboard.press('Enter');
    await page.getByText('Как ты?').waitFor();
    if (!(await page.evaluate(() => document.activeElement?.dataset?.intent === 'support'))) {
      throw new Error('Message composer lost keyboard focus after intent change');
    }
    await page.getByRole('button', { name: 'Отмена' }).click();
    await page.getByRole('button', { name: 'Составить сообщение' }).click();
    if (await page.evaluate(() => window.n2Host.getSnapshot().state.narrative.messages.length) !== 0) {
      throw new Error('Composer Cancel mutated game state');
    }
    await page.locator('[data-intent="invite"]').click();
    await page.getByText('Встречаемся? Я пришлю фото.').waitFor();
    await page.getByRole('button', { name: /Отправить/ }).evaluate(button => {
      button.click();
      button.click();
    });
    await page.waitForFunction(() => window.n2Host.getSnapshot().state.narrative.messages.length === 1);
    if ((await page.evaluate(() => window.n2Host.getSnapshot().state.narrative.messages.length)) !== 1) {
      throw new Error('Double-send duplicated messages');
    }
    await page.getByText('Он увидел фото.').waitFor();
    await page.getByRole('button', { name: /Далее/ }).click();
    await page.getByRole('button', { name: /Остаться/ }).click();
    await page.getByText('Вместе!').waitFor();
    await page.getByRole('button', { name: 'Назад' }).click();
    await page.getByRole('button', { name: /Уехать/ }).click();
    await page.getByText('Один.').waitFor();
    if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory,
      `${name.replaceAll(/[^a-z0-9]/gi, '_')}-ending.png`) });
    await page.getByRole('button', { name: 'Журнал' }).click();
    await page.getByText('harbor').waitFor();
    const stateBeforeSave = await page.evaluate(() => window.n2Host.getSnapshot().state.narrative);
    if (stateBeforeSave.routeLock !== null || stateBeforeSave.messages.length !== 1) throw new Error('Wrong alternate ending');
    await page.locator('#pause').click();
    await page.locator('#save').click();
    await page.getByText('save:ok').waitFor();
    await page.reload();
    await page.waitForFunction(() => window.n2Host?.getStatus() === 'READY');
    await page.locator('#restore').click();
    await page.getByText('restore:ok').waitFor();
    await page.getByText('Один.').waitFor();
    if (await page.getByRole('button', { name: 'Назад' }).count()) throw new Error('Back should be hidden after reload');
    const afterReload = await page.evaluate(() => window.n2Host.getSnapshot().state.narrative);
    if (JSON.stringify(afterReload) !== JSON.stringify(stateBeforeSave)) throw new Error('Reload changed saved narrative state');
    const width = await page.locator('#game').evaluate(node => node.getBoundingClientRect().width);
    if (width < 320) throw new Error(`Unexpectedly narrow viewport ${width}`);
    if (!contextOptions.isMobile) {
      await page.setViewportSize({ width: 390, height: 800 });
      await page.waitForFunction(() => document.querySelector('.ludory-narrative')?.dataset.orientation === 'portrait');
      await page.setViewportSize({ width: 1000, height: 720 });
      await page.waitForFunction(() => document.querySelector('.ludory-narrative')?.dataset.orientation === 'landscape');
    }
    if (errors.length || outbound.length) throw new Error(`Errors: ${errors}; outbound: ${outbound}`);
    results.push({ name, status: 'PASS', browser: browser.version(), width, offline: true });
  } finally { await context.close(); await browser.close(); }
}

async function unavailableAssetScenario() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 380, height: 720 } });
  const page = await context.newPage();
  try {
    await page.route('**/assets/large-art.svg', route => route.abort());
    await page.goto(base);
    await page.waitForFunction(() => window.n2Host?.getStatus() === 'READY');
    await page.locator('#start').click();
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByText('Изображение недоступно: harbor').waitFor();
    await page.getByRole('button', { name: 'Не снимать' }).click();
    await page.getByRole('button', { name: 'Ракушка' }).click();
    await page.waitForFunction(() => window.n2Host.getSnapshot().state.narrative.sceneId === 'start' &&
      window.n2Host.getSnapshot().state.narrative.messages.length === 0 &&
      window.n2Host.getSnapshot().state.narrative.completedEvents.length === 2);
    results.push({ name: 'Chromium offline missing asset', status: 'PASS', browser: browser.version(), offline: true });
  } finally { await context.close(); await browser.close(); }
}

try {
  await scenario('Chromium desktop 1000x720', chromium, { viewport: { width: 1000, height: 720 } });
  await scenario('Chromium Android portrait', chromium, { ...devices['Pixel 7'] });
  await scenario('Firefox desktop', firefox, { viewport: { width: 1000, height: 720 } });
  await scenario('WebKit desktop', webkit, { viewport: { width: 1000, height: 720 } });
  await unavailableAssetScenario();
  if (artifactDirectory) fs.writeFileSync(path.join(artifactDirectory, 'results.json'),
    JSON.stringify({ status: 'PASS_N2_BROWSER', results }, null, 2));
  console.log(JSON.stringify({ status: 'PASS_N2_BROWSER', results }));
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(out, { recursive: true, force: true });
}
