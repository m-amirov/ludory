import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium, devices } from 'playwright';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';

const created = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-n3-created-'));
const options = { id: 'n3-browser-game', version: '0.1.0', title: 'Вечер у маяка', lang: 'ru',
  profile: 'narrative-game', template: 'narrative-interactive', targets: ['yandex-games', 'vk-games'] };
const preview = planCreate(created, options);
if (preview.status !== 'READY' || fs.readdirSync(created).length !== 0) throw new Error('Studio preview mutated game or blocked N3');
const applied = applyCreatePlan(preview);
if (applied.status !== 'APPLIED') throw new Error('Studio apply did not complete');
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const target = path.resolve(created, `.${name === '/' ? '/index.html' : name}`);
  if (!target.startsWith(`${created}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(target, (error, data) => {
    if (error) return response.writeHead(404).end();
    const ext = path.extname(target);
    response.writeHead(200, { 'Content-Type': {
      '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.html': 'text/html',
    }[ext] ?? 'application/octet-stream' }).end(data);
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
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
    await page.goto(base);
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

try {
  await run({ viewport: { width: 1000, height: 720 } }, 'desktop-wide', false);
  await run({ ...devices['Pixel 7'] }, 'android-portrait-emulated', true);
  const result = { status: 'PASS_N3_STUDIO_BROWSER', results };
  if (artifactDirectory) fs.writeFileSync(path.join(artifactDirectory, 'n3-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(created, { recursive: true, force: true });
}
