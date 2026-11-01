import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';
import { planPreviewBuild, buildPreview } from '../../../studio/src/preview-build.mjs';
import { startPreviewServer } from '../../../studio/src/preview-server.mjs';

const created = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-n3-created-'));
const options = { id: 'n3-browser-game', version: '0.1.0', title: 'Вечер у маяка', lang: 'ru',
  profile: 'narrative-game', template: 'narrative-interactive', targets: ['yandex-games', 'vk-games'] };
const preview = planCreate(created, options);
if (preview.status !== 'READY' || fs.readdirSync(created).length !== 0) throw new Error('Studio preview mutated game or blocked N3');
const applied = applyCreatePlan(preview);
if (applied.status !== 'APPLIED') throw new Error('Studio apply did not complete');
const previewBuildPlan = planPreviewBuild(created);
if (previewBuildPlan.status !== 'READY') throw new Error(`N3 preview source blocked: ${previewBuildPlan.reasonCode}`);
const built = buildPreview(previewBuildPlan);
if (built.status !== 'BUILT') throw new Error(`N3 preview build blocked: ${built.reasonCode}`);
const server = await startPreviewServer({ root: built.root, port: 0, buildSha256: built.buildSha256 });
const base = server.url;
const results = [];
const artifactDirectory = process.env.LUDORY_N3_ARTIFACT_DIR ? path.resolve(process.env.LUDORY_N3_ARTIFACT_DIR) : null;
if (artifactDirectory) fs.mkdirSync(artifactDirectory, { recursive: true });

async function run(browserOptions, name, isMobile) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(browserOptions);
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url());
  });
  try {
    const load = await page.goto(base);
    if (load?.headers()['x-content-type-options'] !== 'nosniff' ||
        load?.headers()['cache-control'] !== 'no-store') {
      throw new Error('N3 browser fixture did not load a protected, fresh preview build');
    }
    await page.getByText('Маяк мигнул трижды.').waitFor();
    await page.getByRole('button', { name: 'English' }).click();
    await page.getByText('The lighthouse flashed three times.').waitFor();
    await page.getByRole('region', { name: 'Narrative' }).waitFor();
    if (await page.locator('html').getAttribute('lang') !== 'en' ||
        await page.title() !== 'Lighthouse Evening · Ludory' ||
        !await page.getByRole('navigation', { name: 'Story controls' }).count() ||
        !await page.getByRole('main', { name: 'Interactive story' }).count() ||
        !await page.getByText('Story started').count()) throw new Error('English shell is incomplete');
    await page.getByRole('button', { name: 'Русский' }).click();
    await page.getByRole('region', { name: 'История' }).waitFor();
    await page.getByRole('button', { name: 'Далее' }).click();
    const artwork = page.locator('.ludory-narrative__actions img');
    await artwork.first().waitFor();
    if (await artwork.count() !== 2) throw new Error('Expected two selectable photo frames');
    await Promise.all([artwork.nth(0).evaluate(img => img.decode()), artwork.nth(1).evaluate(img => img.decode())]);
    if (await artwork.first().evaluate(img => img.naturalWidth === 0 || img.getBoundingClientRect().width > 320)) {
      throw new Error('Bundled image missing or oversized');
    }
    await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
    await page.getByRole('button', { name: 'Белая ракушка' }).click();
    await page.getByText('Смотри, какой сегодня свет.').waitFor();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await page.getByRole('button', { name: 'Составить сообщение' }).click();
    await page.getByRole('button', { name: 'Отправить' }).click();
    await page.getByText('Чуть позже Мира заметила снимок').waitFor();
    await page.getByText('Я узнала этот свет!').waitFor();
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByText('Ракушка звякнула').waitFor();
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByText('Экран погас').waitFor();
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByRole('button', { name: 'Пойти навстречу Мире' }).click();
    if (await page.getByRole('button', { name: 'Идти вдоль берега' }).count()) throw new Error('Route lock leaked opposite choice');
    await page.getByRole('button', { name: 'Остаться у маяка' }).click();
    await page.getByText('Когда Мира появилась').waitFor();
    await page.getByRole('button', { name: 'Журнал' }).click();
    await page.getByText('Снимок у маяка').waitFor();
    const albumImage = page.locator('.ludory-narrative__journal img');
    await albumImage.waitFor();
    await albumImage.evaluate(img => img.decode());
    if (!(await albumImage.evaluate(img => img.naturalWidth > 0))) throw new Error('Photo album has no saved artwork');
    await page.getByText('Белая ракушка').waitFor();
    await page.getByText('Разделённый вечер').waitFor();
    await page.getByText('Мира чувствует, что тебе можно доверять.').waitFor();
    await page.getByRole('button', { name: 'Скрыть журнал' }).click();
    await page.locator('#save').click();
    await page.getByText('Сохранено').waitFor();
    await page.reload();
    await page.getByText('Когда Мира появилась').waitFor();
    await page.getByRole('button', { name: 'Журнал' }).click();
    const restoredAlbumImage = page.locator('.ludory-narrative__journal img');
    await restoredAlbumImage.waitFor();
    await restoredAlbumImage.evaluate(img => img.decode());
    if (!(await restoredAlbumImage.evaluate(img => img.naturalWidth > 0))) {
      throw new Error('Restored photo album image failed to decode');
    }
    await page.getByRole('button', { name: 'Скрыть журнал' }).click();
    if (await page.getByRole('button', { name: 'Назад' }).count()) throw new Error('Transient Back history survived reload');
    await page.getByRole('button', { name: 'English' }).click();
    await page.getByText('When Mira emerged from the mist').waitFor();
    const originalSave = await page.evaluate(() => window.localStorage.getItem('ludory-narrative-v1:n3-browser-game:narrative-demo'));
    await page.evaluate(async () => {
      const key = 'ludory-narrative-v1:n3-browser-game:narrative-demo';
      const record = JSON.parse(window.localStorage.getItem(key));
      record.snapshot.state.narrative.sceneId = 'scene-no-longer-present';
      const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
        value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` :
        JSON.stringify(value);
      const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(record.snapshot)));
      record.snapshotSha256 = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
      window.localStorage.setItem(key, JSON.stringify(record));
    });
    await page.reload();
    await page.getByText('Не удалось восстановить сохранение').waitFor();
    await page.getByRole('button', { name: 'Начать заново' }).click();
    await page.getByText('Маяк мигнул трижды.').waitFor();
    await page.evaluate(value => window.localStorage.setItem('ludory-narrative-v1:n3-browser-game:narrative-demo', value), originalSave);
    await page.reload();
    await page.getByText('Когда Мира появилась').waitFor();
    await page.evaluate(() => {
      const key = 'ludory-narrative-v1:n3-browser-game:narrative-demo';
      const record = JSON.parse(window.localStorage.getItem(key));
      record.formatVersion = 2;
      window.localStorage.setItem(key, JSON.stringify(record));
    });
    await page.reload();
    await page.getByText('Не удалось восстановить сохранение').waitFor();
    if (!(await page.locator('#save').isDisabled()) ||
        await page.evaluate(() => JSON.parse(window.localStorage.getItem('ludory-narrative-v1:n3-browser-game:narrative-demo')).formatVersion) !== 2) {
      throw new Error('Incompatible save was silently overwritten or Save was not disabled');
    }
    await page.evaluate(() => window.localStorage.setItem('ludory-narrative-v1:n3-browser-game:narrative-demo', '{corrupted'));
    await page.reload();
    await page.getByText('Не удалось восстановить сохранение').waitFor();
    if (!(await page.locator('#save').isDisabled()) ||
        await page.evaluate(() => window.localStorage.getItem('ludory-narrative-v1:n3-browser-game:narrative-demo')) !== '{corrupted') {
      throw new Error('Corrupt save was silently overwritten or Save was not disabled');
    }
    await page.getByRole('button', { name: 'Начать заново' }).click();
    await page.getByText('Маяк мигнул трижды.').waitFor();
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByRole('button', { name: 'Оставить вечер только в памяти' }).click();
    await page.getByRole('button', { name: 'Старинный медный ключ' }).click();
    await page.locator('[data-intent="support"]').click();
    await page.getByText('Я помню, что тебе было нелегко.').waitFor();
    await page.getByRole('button', { name: 'Отправить' }).click();
    await page.getByText('Спасибо. Именно это мне сейчас было нужно.').waitFor();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Далее' }).click();
    if (await page.getByRole('button', { name: 'Пойти навстречу Мире' }).count()) throw new Error('Unmet relationship gate leaked route');
    await page.getByRole('button', { name: 'Встретить рассвет в одиночестве' }).click();
    await page.getByRole('button', { name: 'Идти вдоль берега' }).click();
    await page.getByText('Первые лучи рассвета').waitFor();
    if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory, `${name}.png`), fullPage: true });
    if (errors.length || external.length) throw new Error(`Browser errors ${errors.join(' | ')}; external requests ${external.join(' | ')}`);
    const width = await page.locator('#game').evaluate(node => node.getBoundingClientRect().width);
    if (width < 320 || (isMobile && width > 520)) throw new Error(`Unexpected viewport width ${width}`);
    results.push({ name, status: 'PASS', viewportWidth: width, externalRequests: external.length });
  } finally { await context.close(); await browser.close(); }
}

async function runInsecureLanSave() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  try {
    // Private-IP HTTP origins are not secure contexts. Simulate that browser
    // restriction while connecting to the localhost-only CI fixture.
    await page.addInitScript(() => {
      Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: undefined });
    });
    await page.goto(base);
    if (await page.evaluate(() => typeof window.crypto?.subtle?.digest === 'function')) {
      throw new Error('LAN insecure-origin test did not remove Web Crypto subtle');
    }
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.locator('#save').click();
    await page.getByText('Сохранено').waitFor({ timeout: 2_000 });
    await page.reload();
    await page.getByText('Сохранение восстановлено').waitFor();
    results.push({ name: 'android-lan-insecure-save-emulated', status: 'PASS', webCryptoSubtle: false });
  } finally { await context.close(); await browser.close(); }
}

async function checkVisibleControls(page, name, { minTap = false } = {}) {
  const problems = await page.evaluate(({ minTap }) => {
    const viewportWidth = document.documentElement.clientWidth;
    const problems = [];
    for (const [label, node] of [['document', document.documentElement], ['body', document.body],
      ['game', document.querySelector('#game')], ['surface', document.querySelector('.ludory-narrative')],
      ['panel', document.querySelector('.ludory-narrative__panel')]]) {
      if (node.scrollWidth > node.clientWidth + 2) {
        const edge = node.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(node).paddingRight);
        const offenders = [...node.querySelectorAll('*')].filter(child =>
          child.getBoundingClientRect().right > edge + 2 || child.scrollWidth > child.clientWidth + 2)
          .slice(0, 3).map(child => `${child.tagName}.${child.className || ''}: ${child.textContent.slice(0, 20)} (${child.scrollWidth}/${child.clientWidth})`);
        problems.push(`${label} horizontal overflow: ${node.scrollWidth}/${node.clientWidth}; children ${offenders.join(', ')}`);
      }
    }
    for (const button of document.querySelectorAll('header button, .ludory-narrative button')) {
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.left < -2 || rect.right > viewportWidth + 2) {
        problems.push(`button outside viewport: ${button.textContent.slice(0, 35)}`);
      }
      if (button.scrollWidth > button.clientWidth + 2) problems.push(`button clipped: ${button.textContent.slice(0, 35)}`);
      if (minTap && rect.height < 44) problems.push(`tap target under 44px: ${button.textContent.slice(0, 35)} (${rect.height})`);
    }
    return problems;
  }, { minTap });
  if (problems.length) throw new Error(`${name} layout: ${problems.join('; ')}`);
}

async function runViewportCase(browserOptions, name, expectedOrientation, browserType = chromium) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext(browserOptions);
  const page = await context.newPage();
  try {
    await page.goto(base);
    await page.getByText('Маяк мигнул трижды.').waitFor();
    const surface = page.locator('.ludory-narrative');
    if (await surface.getAttribute('data-mobile-preference') !== 'portrait' ||
        await page.locator('html').getAttribute('data-mobile-preference') !== 'portrait' ||
        await surface.getAttribute('data-orientation') !== expectedOrientation) {
      throw new Error(`${name}: desired preference and actual viewport orientation diverge`);
    }
    await checkVisibleControls(page, name, { minTap: browserOptions.isMobile === true });
    await page.getByRole('button', { name: 'Далее' }).click();
    const longLabel = 'Очень длинный русский вариант ответа с описанием чувств и последствий выбора — '
      .repeat(3) + ' An equally long English choice label that must remain tappable and readable.';
    await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).evaluate((button, value) => {
      button.textContent = value;
    }, longLabel);
    await checkVisibleControls(page, `${name}-long-choice`, { minTap: browserOptions.isMobile === true });
    if (name === 'phone-667-landscape') {
      const back = await page.getByRole('button', { name: 'Назад' }).boundingBox();
      if (!back || back.y < 0 || back.y + back.height > 375) {
        throw new Error(`Landscape scroll starts with toolbar inaccessible: ${JSON.stringify(back)}`);
      }
      const gutters = await page.evaluate(() => {
        const padding = selector => {
          const node = document.querySelector(selector);
          const style = getComputedStyle(node);
          return [Number.parseFloat(style.paddingLeft), Number.parseFloat(style.paddingRight)];
        };
        return { header: padding('header'), surface: padding('.ludory-narrative') };
      });
      if (gutters.header.some(value => value < 24) || gutters.surface.some(value => value < 24)) {
        throw new Error(`Short landscape needs protective gutters for safe-area fallback: ${JSON.stringify(gutters)}`);
      }
    }
    if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory, `${name}.png`), fullPage: true });
    if (name === 'phone-320-portrait') {
      // The author's root-font scaling stands in for enlarged browser text; it is not a physical pinch-zoom test.
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      const narrativeFontPx = await surface.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize));
      if (narrativeFontPx < 30) throw new Error(`Narrative text ignored 200% root font scaling: ${narrativeFontPx}px`);
      await checkVisibleControls(page, 'phone-320-large-text', { minTap: true });
      if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory, 'phone-320-large-text.png'), fullPage: true });
    }
    results.push({ name, status: 'PASS', orientation: expectedOrientation, mobilePreference: 'portrait' });
  } finally { await context.close(); await browser.close(); }
}

async function checkPortraitScroll(page, name) {
  const geometry = await page.evaluate(() => {
    const documentRoot = document.documentElement;
    const surface = document.querySelector('.ludory-narrative');
    const game = document.querySelector('#game');
    const actions = document.querySelector('.ludory-narrative__actions');
    return { documentScrollHeight: documentRoot.scrollHeight, documentClientHeight: documentRoot.clientHeight,
      documentScrollTop: documentRoot.scrollTop,
      surfaceScrollHeight: surface.scrollHeight, surfaceClientHeight: surface.clientHeight,
      surfaceScrollTop: surface.scrollTop,
      gameHeight: game.getBoundingClientRect().height,
      surfaceOverflow: getComputedStyle(surface).overflowY,
      actionDirection: actions ? getComputedStyle(actions).flexDirection : null,
      gameOrientation: surface.dataset.orientation };
  });
  if (geometry.documentScrollHeight > geometry.documentClientHeight + 2 ||
      geometry.surfaceScrollHeight <= geometry.surfaceClientHeight + 20 ||
      geometry.gameHeight <= 44 || geometry.surfaceOverflow !== 'auto' ||
      (geometry.actionDirection !== null && geometry.actionDirection !== 'column')) {
    throw new Error(`${name}: dialogue scroll must stay inside a bounded game surface: ${JSON.stringify(geometry)}`);
  }
  return geometry;
}

async function runRotationSaveAndOptOut() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(base);
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
    await page.getByRole('button', { name: 'Назад' }).click();
    await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).waitFor();
    await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
    await page.getByRole('button', { name: 'Белая ракушка' }).click();
    await page.getByText('Смотри, какой сегодня свет.').waitFor();
    await page.locator('[data-intent="support"]').focus();
    await page.keyboard.press('Enter');
    await page.getByText('Я помню, что тебе было нелегко.').waitFor();
    await page.setViewportSize({ width: 320, height: 360 }); // reduced visual viewport / keyboard-space proxy
    const beforeScroll = await checkPortraitScroll(page, 'short-portrait-composer');
    await page.getByRole('button', { name: 'Отправить' }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Отмена' }).scrollIntoViewIfNeeded();
    const afterScroll = await checkPortraitScroll(page, 'short-portrait-after-scroll');
    if (afterScroll.surfaceScrollTop <= beforeScroll.surfaceScrollTop || afterScroll.documentScrollTop > 2) {
      throw new Error(`Composer scroll escaped game surface: ${JSON.stringify({ beforeScroll, afterScroll })}`);
    }
    await checkVisibleControls(page, 'short-portrait-composer', { minTap: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await checkPortraitScroll(page, 'short-portrait-large-text-composer');
    await page.getByRole('button', { name: 'Отправить' }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Отмена' }).scrollIntoViewIfNeeded();
    await checkVisibleControls(page, 'short-portrait-large-text', { minTap: true });
    await page.getByRole('button', { name: 'Журнал' }).click();
    await page.getByText('Снимок у маяка').waitFor();
    await checkPortraitScroll(page, 'short-portrait-large-text-journal');
    await page.getByRole('button', { name: 'Скрыть журнал' }).click();
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize({ width: 667, height: 375 });
    await page.waitForFunction(() => document.querySelector('.ludory-narrative')?.dataset.orientation === 'landscape');
    await page.locator('#save').click();
    await page.getByText('Сохранено').waitFor();
    const before = await page.evaluate(() => JSON.parse(window.localStorage.getItem(
      'ludory-narrative-v1:n3-browser-game:narrative-demo')).snapshot.state.narrative);
    await page.reload();
    await page.getByText('Смотри, какой сегодня свет.').waitFor();
    const after = await page.evaluate(() => JSON.parse(window.localStorage.getItem(
      'ludory-narrative-v1:n3-browser-game:narrative-demo')).snapshot.state.narrative);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Orientation/reload changed the saved scene');
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForFunction(() => document.querySelector('.ludory-narrative')?.dataset.orientation === 'portrait');
    await page.getByRole('button', { name: 'Отправить' }).click();
    await page.getByText('Чуть позже Мира заметила снимок').waitFor();
    await page.locator('#save').click();
    await page.getByText('Сохранено').waitFor();
    results.push({ name: 'rotation-back-save-reload', status: 'PASS', savedSceneStable: true });

    // This simulates an author changing only the new project's metadata to opt out.
    let optOutResponses = 0;
    await page.route(new URL('/', base).href, async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace('name="ludory-mobile-orientation" content="portrait"',
        'name="ludory-mobile-orientation" content="auto"');
      optOutResponses++;
      await route.fulfill({ response, body: html });
    });
    await page.reload();
    await page.getByText('Чуть позже Мира заметила снимок').waitFor();
    const optedOut = await page.evaluate(() => ({ meta: document.querySelector('meta[name="ludory-mobile-orientation"]')?.content,
      html: document.documentElement.dataset.mobilePreference,
      renderer: document.querySelector('.ludory-narrative')?.dataset.mobilePreference }));
    if (optOutResponses !== 1 || optedOut.meta !== 'auto' || optedOut.renderer !== 'auto') {
      throw new Error(`Author opting out did not reach the renderer: intercepted ${optOutResponses}, ${JSON.stringify(optedOut)}`);
    }
    await checkVisibleControls(page, 'opt-out-auto');
    results.push({ name: 'author-auto-opt-out', status: 'PASS', mobilePreference: 'auto' });
  } finally { await context.close(); await browser.close(); }
}

async function runBasicNarrativeTemplate() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-p2-basic-'));
  let builtBasic;
  let basicServer;
  let browser;
  try {
    const plan = planCreate(project, { id: 'p2-basic', title: 'Simple Story', lang: 'en',
      profile: 'narrative-game', template: 'narrative-basic', targets: ['yandex-games'] });
    if (plan.status !== 'READY') throw new Error(`Simple narrative Studio plan blocked: ${plan.status}`);
    applyCreatePlan(plan);
    builtBasic = buildPreview(planPreviewBuild(project));
    if (builtBasic.status !== 'BUILT') throw new Error(`Simple narrative preview blocked: ${builtBasic.reasonCode}`);
    basicServer = await startPreviewServer({ root: builtBasic.root, port: 0, buildSha256: builtBasic.buildSha256 });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(basicServer.url);
    await page.getByText('The road divides at sunset.').waitFor();
    const first = page.getByRole('button', { name: 'Take the forest road' });
    const responsive = await first.evaluate(button => ({ height: button.getBoundingClientRect().height,
      minHeight: getComputedStyle(button).minHeight,
      contentWidth: button.getBoundingClientRect().width,
      bodyWidth: document.documentElement.clientWidth,
      preference: document.documentElement.dataset.mobilePreference }));
    if (responsive.preference !== 'portrait' || responsive.height < 44 || responsive.minHeight !== '44px' ||
        responsive.contentWidth > responsive.bodyWidth || responsive.contentWidth < 250) {
      throw new Error(`Basic narrative portrait opt-in failed: ${JSON.stringify(responsive)}`);
    }
    await first.click();
    await page.getByText('Fireflies guide you home.').waitFor();
    await page.setViewportSize({ width: 667, height: 375 });
    const landscape = await page.getByRole('button', { name: 'Start again' }).evaluate(button => ({
      height: button.getBoundingClientRect().height,
      minHeight: getComputedStyle(button).minHeight,
      bodyPaddingLeft: Number.parseFloat(getComputedStyle(document.body).paddingLeft),
      bodyPaddingRight: Number.parseFloat(getComputedStyle(document.body).paddingRight),
    }));
    if (landscape.height < 44 || landscape.minHeight !== '44px' ||
        landscape.bodyPaddingLeft < 16 || landscape.bodyPaddingRight < 16) {
      throw new Error(`Basic narrative landscape touch/safe-area fallback failed: ${JSON.stringify(landscape)}`);
    }
    await page.getByRole('button', { name: 'Start again' }).click();
    await page.getByText('The road divides at sunset.').waitFor();
    await page.setViewportSize({ width: 320, height: 640 });

    await page.route(new URL('/', basicServer.url).href, async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace('name="ludory-mobile-orientation" content="portrait"',
        'name="ludory-mobile-orientation" content="auto"');
      await route.fulfill({ response, body: html });
    });
    await page.reload();
    await page.getByText('The road divides at sunset.').waitFor();
    const preference = await page.locator('html').getAttribute('data-mobile-preference');
    const autoMinHeight = await page.getByRole('button', { name: 'Take the forest road' })
      .evaluate(button => getComputedStyle(button).minHeight);
    if (preference !== 'auto' || autoMinHeight === '44px') {
      throw new Error(`Basic narrative author opt-out failed: ${preference}, ${autoMinHeight}`);
    }
    results.push({ name: 'basic-narrative-portrait-and-opt-out', status: 'PASS' });
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (basicServer) await basicServer.close();
    builtBasic?.cleanup();
    fs.rmSync(project, { recursive: true, force: true });
  }
}

try {
  await run({ viewport: { width: 1000, height: 720 } }, 'desktop-wide', false);
  await run({ ...devices['Pixel 7'] }, 'android-portrait-emulated', true);
  await runInsecureLanSave();
  await runViewportCase({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }, 'phone-320-portrait', 'portrait');
  await runViewportCase({ ...devices['iPhone 13'] }, 'iphone-portrait-emulated', 'portrait');
  await runViewportCase({ ...devices['iPhone 13'] }, 'iphone-webkit-portrait-emulated', 'portrait', webkit);
  await runViewportCase({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true }, 'phone-667-landscape', 'landscape');
  await runViewportCase({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true }, 'iphone-webkit-landscape', 'landscape', webkit);
  await runViewportCase({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }, 'tablet-portrait', 'portrait');
  await runRotationSaveAndOptOut();
  await runBasicNarrativeTemplate();
  const result = { status: 'PASS_N3_STUDIO_BROWSER', results };
  if (artifactDirectory) fs.writeFileSync(path.join(artifactDirectory, 'n3-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await server.close();
  built.cleanup();
  fs.rmSync(created, { recursive: true, force: true });
}
