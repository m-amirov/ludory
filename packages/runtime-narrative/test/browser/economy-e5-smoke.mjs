import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';
import { planPreviewBuild, buildPreview } from '../../../studio/src/preview-build.mjs';
import { startPreviewServer } from '../../../studio/src/preview-server.mjs';

// A real browser exercises the generated default-OFF template and the opt-in
// economy panel; all money/SDK operations remain mocks, NEVER real acceptance.
const created = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-e5-created-'));
let server;
let built;
try {
  const plan = planCreate(created, {
    id: 'e5-browser-game', version: '0.1.0', title: 'Берег', lang: 'ru',
    profile: 'narrative-game', template: 'narrative-economy',
    targets: ['yandex-games', 'vk-games'],
  });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  const buildPlan = planPreviewBuild(created);
  assert.equal(buildPlan.status, 'READY');
  built = buildPreview(buildPlan);
  assert.equal(built.status, 'BUILT');
  server = await startPreviewServer({ root: built.root, port: 0, buildSha256: built.buildSha256 });

  for (const [name, options] of [
    ['desktop', { viewport: { width: 1280, height: 720 } }],
    ['mobile-portrait', { ...devices['Pixel 7'] }],
  ]) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      const errors = [];
      const external = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (!request.url().startsWith(server.url) && !request.url().startsWith('data:')) external.push(request.url());
      });
      await page.goto(server.url);
      await page.getByText('На берегу стояли двое.').waitFor();
      assert.equal(await page.getByText('Демонстрация без монетизации').count(), 1);
      assert.equal(await page.locator('#economy-panel').locator('*').count(), 0);
      assert.equal(await page.locator('meta[name="ludory-mobile-orientation"]').getAttribute('content'), 'portrait');

      await page.getByRole('button', { name: 'Далее' }).click();
      await page.getByRole('button', { name: 'Поговорить по душам' }).click();
      await page.getByRole('button', { name: 'Далее' }).click();
      await page.getByRole('button', { name: 'Остаться рядом' }).click();
      await page.getByText('Они встретили рассвет вместе.').waitFor();
      await page.getByRole('button', { name: 'Сохранить историю' }).click();
      await page.getByText('История сохранена').waitFor();
      await page.reload();
      await page.getByText('Они встретили рассвет вместе.').waitFor();
      assert.equal(await page.locator('#economy-panel').locator('*').count(), 0);

      const storageKey = 'ludory-economy-demo-story:e5-browser-game:economy-narrative';
      await page.evaluate(key => localStorage.setItem(key, '{corrupt'), storageKey);
      await page.reload();
      await page.getByText('Не удалось восстановить сохранение.').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Сохранить историю' }).isDisabled(), true);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), '{corrupt');
      await page.getByRole('button', { name: 'Начать заново' }).click();
      await page.getByText('На берегу стояли двое.').waitFor();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null);

      // Test a panel with an explicitly provided fake wallet, while the game
      // itself stays economy-disabled. No ad, purchase or cloud SDK involved.
      const panelResult = await page.evaluate(async () => {
        const { createEconomyPanel } = await import('./assets/ludory-economy.js');
        const root = document.querySelector('#economy-panel');
        let rewardedCalls = 0;
        const wallet = {
          getView: () => ({ enabled: true, ready: true, balance: 9,
            currency: { icon: '✦', displayName: 'звёзд' } }),
          getRewardsView: () => ({ pendingReward: null, amounts: { starter: 0, daily: 0, rewarded: 3 },
            daily: { eligible: false } }),
          initialize: async () => {}, grantStarter: async () => {}, claimDaily: async () => {},
          claimRewarded: async () => { rewardedCalls++; }, retryPendingReward: async () => {},
          getStoreCatalog: async () => [], purchaseProduct: async () => {}, restorePurchases: async () => {},
        };
        const panel = createEconomyPanel({ root, wallet, target: 'vk-games' });
        panel.render();
        const balance = root.querySelector('[data-ui="economy-balance"]')?.textContent;
        root.querySelector('[data-ui="economy-rewarded"]')?.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        const success = root.querySelector('[data-ui="economy-status"]')?.textContent;
        const noStore = root.querySelector('[data-ui="economy-catalog"]') === null;
        panel.dispose();
        return { balance, success, rewardedCalls, noStore, emptyAfterDispose: !root.firstChild };
      });
      assert.match(panelResult.balance, /9/);
      assert.equal(panelResult.success, 'Операция подтверждена');
      assert.equal(panelResult.rewardedCalls, 1);
      assert.equal(panelResult.noStore, true);
      assert.equal(panelResult.emptyAfterDispose, true);
      assert.deepEqual(errors, [], `${name} page errors`);
      assert.deepEqual(external, [], `${name} unexpected external requests`);
      console.log(`PASS E5 local browser mock: ${name}`);
      await context.close();
    } finally { await browser.close(); }
  }
} finally {
  if (server) await server.close();
  if (built?.status === 'BUILT') built.cleanup();
  fs.rmSync(created, { recursive: true, force: true });
}
