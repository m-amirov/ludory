import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, devices } from 'playwright';
import { planPreviewBuild, buildPreview } from '../../../studio/src/preview-build.mjs';
import { startPreviewServer } from '../../../studio/src/preview-server.mjs';
import { runF5Fixture } from '../../../../scripts/f5-fixture-evidence.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const saveKey = 'ludory-narrative-v1:f5-disposable-story:narrative-demo';

async function observeNarrative({ projectDir, outputDir }) {
  const plan = planPreviewBuild(projectDir);
  if (plan.status !== 'READY') throw new Error(`F5 narrative preview blocked: ${plan.reasonCode}`);
  const built = buildPreview(plan);
  if (built.status !== 'BUILT') throw new Error(`F5 narrative preview build blocked: ${built.reasonCode}`);
  let server;
  let browser;
  try {
    server = await startPreviewServer({ root: built.root, port: 0, buildSha256: built.buildSha256 });
    browser = await chromium.launch({ headless: true });
    const results = [];
    for (const [name, options] of [
      ['desktop-wide', { viewport: { width: 1000, height: 720 } }],
      ['android-portrait-emulated', { ...devices['Pixel 7'] }],
    ]) {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      const pageErrors = [];
      const externalRequests = [];
      const consoleErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('request', request => {
        if (!request.url().startsWith(server.url) && !request.url().startsWith('data:')) {
          externalRequests.push(request.url());
        }
      });
      try {
        const screenshots = [];
        const capture = async stage => {
          const file = `${name}-${stage}.png`;
          const bytes = await page.screenshot({ path: path.join(outputDir, file), fullPage: true });
          screenshots.push({ stage, file, sha256: sha256(bytes) });
        };
        await page.goto(server.url);
        await page.getByText('Маяк мигнул трижды.').waitFor();
        const orientation = await page.locator('.ludory-narrative').getAttribute('data-orientation');
        if (orientation !== (name === 'desktop-wide' ? 'landscape' : 'portrait')) {
          throw new Error(`F5 viewport orientation mismatch: ${name}, ${orientation}`);
        }
        await page.getByRole('button', { name: 'Далее' }).click();
        await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
        await page.getByRole('button', { name: 'Назад' }).click();
        await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
        await page.getByRole('button', { name: 'Белая ракушка' }).click();
        await page.getByText('Смотри, какой сегодня свет.').waitFor();
        await page.getByRole('button', { name: 'Отмена' }).click();
        await page.getByRole('button', { name: 'Составить сообщение' }).click();
        await page.getByRole('button', { name: 'Отправить' }).click();
        await page.getByText('Чуть позже Мира заметила снимок').waitFor();
        await page.getByText('Я узнала этот свет!').waitFor();
        await page.getByRole('button', { name: 'Журнал' }).click();
        await page.getByText('Снимок у маяка').waitFor();
        await page.getByText('Белая ракушка').waitFor();
        const albumImage = page.locator('.ludory-narrative__journal img');
        await albumImage.waitFor();
        await albumImage.evaluate(img => img.decode());
        await capture('journal');
        await page.getByRole('button', { name: 'Скрыть журнал' }).click();
        await page.locator('#save').click();
        await page.getByText('Сохранено').waitFor();
        await page.reload();
        await page.getByText('Чуть позже Мира заметила снимок').waitFor();
        await capture('restored');
        if (await page.getByRole('button', { name: 'Назад' }).count()) {
          throw new Error('F5 transient Back history survived save/reload');
        }
        await page.evaluate(key => {
          const record = JSON.parse(localStorage.getItem(key));
          record.formatVersion = 2;
          localStorage.setItem(key, JSON.stringify(record));
        }, saveKey);
        await page.reload();
        await page.getByText('Не удалось восстановить сохранение').waitFor();
        if (!await page.locator('#save').isDisabled()) throw new Error('F5 upgrade conflict Save is not blocked');
        await page.evaluate(key => localStorage.setItem(key, '{corrupt'), saveKey);
        await page.reload();
        await page.getByText('Не удалось восстановить сохранение').waitFor();
        if (!await page.locator('#save').isDisabled() ||
            await page.evaluate(key => localStorage.getItem(key), saveKey) !== '{corrupt') {
          throw new Error('F5 corrupt save was silently overwritten');
        }
        await page.getByRole('button', { name: 'Начать заново' }).click();
        await page.getByText('Маяк мигнул трижды.').waitFor();
        await capture('replay');
        if (pageErrors.length || externalRequests.length || consoleErrors.length) {
          throw new Error(`F5 ${name} browser errors: ${JSON.stringify({ pageErrors, externalRequests, consoleErrors })}`);
        }
        results.push({ name, status: 'PASS', viewport: options.viewport,
          emulated: name !== 'desktop-wide', orientation, steps: [
            'start', 'back', 'photo', 'keepsake', 'message-echo', 'journal', 'save-reload',
            'upgrade-conflict', 'corrupt-save', 'replay',
          ], pageErrors, consoleErrors, externalRequests,
          screenshots });

      } finally { await context.close(); }
    }
    return { status: 'OBSERVED_PASS', previewBuildSha256: built.buildSha256,
      offlineStartup: 'NOT_REQUIRED', cases: results };
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    built.cleanup();
  }
}

const outputDir = process.env.LUDORY_F5_ARTIFACT_DIR
  ? path.resolve(process.env.LUDORY_F5_ARTIFACT_DIR)
  : path.resolve('artifacts/f5');
fs.mkdirSync(path.dirname(outputDir), { recursive: true });
const result = await runF5Fixture({ outputDir, observeNarrative });
console.log(JSON.stringify({ phase: result.phase, runId: result.runId,
  checkedHead: result.checkedHead, status: result.status,
  browser: result.browser.status, offlineStartup: result.browser.offlineStartup,
  narrativePackaging: result.narrativePackaging.reasonCode,
  candidates: Object.fromEntries(Object.entries(result.candidates).map(([target, candidate]) =>
    [target, candidate.sha256])) }));
