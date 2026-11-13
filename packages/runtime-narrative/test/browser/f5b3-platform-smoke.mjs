import '../../../studio/test/setup-trust-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium, firefox, webkit, devices } from 'playwright';
import { createF5b3Fixture } from './f5b3-fixture.mjs';
import { F5B3_BROWSER_CASES, F5B3_ADVERSE_CASES, F5B3_STORY_PATH,
  buildF5b3Evidence } from './f5b3-evidence.mjs';
import { isF5b3DirectInvocation } from './f5b3-runner-path.mjs';

const matrix = [
  { browser: 'chromium', engine: chromium, device: 'desktop', options: { viewport: { width: 1000, height: 720 } } },
  { browser: 'chromium', engine: chromium, device: 'pixel-7', options: devices['Pixel 7'] },
  { browser: 'chromium', engine: chromium, device: 'narrow-320', options: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true } },
  { browser: 'firefox', engine: firefox, device: 'desktop', options: { viewport: { width: 1000, height: 720 } } },
  { browser: 'webkit', engine: webkit, device: 'iphone-13', options: devices['iPhone 13'] },
];

assert.deepEqual(matrix.map(({ browser, device }) => ({ browser, device })), F5B3_BROWSER_CASES);

async function checkLayout(page, device) {
  const violations = await page.evaluate(minTap => {
    const errors = [];
    for (const element of [document.documentElement, document.body, document.querySelector('#game'),
      document.querySelector('.ludory-narrative'), document.querySelector('.ludory-narrative__panel'),
      document.querySelector('.ludory-narrative__actions'),
      document.querySelector('.ludory-narrative__journal')].filter(Boolean)) {
      if (element.scrollWidth > element.clientWidth + 2) errors.push('horizontal overflow ' + element.className);
    }
    for (const button of document.querySelectorAll('header button, .ludory-narrative button')) {
      const box = button.getBoundingClientRect();
      if (box.width <= 0 || box.left < -2 || box.right > document.documentElement.clientWidth + 2 ||
          button.scrollWidth > button.clientWidth + 2) errors.push('invisible or clipped action: ' + button.textContent);
      if (minTap && box.height < 44) errors.push('tap target under 44px: ' + button.textContent);
    }
    return errors;
  }, device !== 'desktop');
  assert.deepEqual(violations, [], `${device}: layout violations`);
  assert.equal(await page.locator('.ludory-narrative').getAttribute('data-mobile-preference'), 'portrait');
  assert.equal(await page.locator('html').getAttribute('data-mobile-preference'), 'portrait');
}

async function closeBrowserCase(context, browser, server) {
  const failures = [];
  for (const resource of [context, browser, server]) {
    if (!resource) continue;
    try { await resource.close(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'F5B3_BROWSER_CASE_CLEANUP_FAILED');
}

async function playAuthoredStory(page, target, device) {
  const pathObserved = [];
  await page.locator('#status[data-sdk-ready="true"]').waitFor({ timeout: 8_000 });
  await page.getByText('F5B3_AUTHORED_STORY_317').waitFor();
  pathObserved.push('F5B3_AUTHORED_STORY_317');
  await checkLayout(page, device);
  await page.getByRole('button', { name: 'Далее' }).click();
  const images = page.locator('.ludory-narrative__actions img');
  await images.first().waitFor();
  assert.equal(await images.count(), 2, 'photo decisions must show two real media frames');
  await images.first().evaluate(async img => { await img.decode(); if (!img.naturalWidth) throw new Error('Undecoded photo'); });
  await checkLayout(page, device); // Photo selection contains two image-backed tappable choices.
  await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
  pathObserved.push('photo:lights');
  await page.getByRole('button', { name: 'Белая ракушка' }).waitFor();
  await checkLayout(page, device); // Keepsake choices are wider than opening dialogue.
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).waitFor();
  pathObserved.push('back:photo');
  await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
  pathObserved.push('photo:lights');
  await page.getByRole('button', { name: 'Белая ракушка' }).click();
  pathObserved.push('keepsake:shell');
  await page.getByText('Смотри, какой сегодня свет.').waitFor();
  await checkLayout(page, device); // Composer presents nested actions on short portrait screens.
  await page.getByRole('button', { name: 'Отмена' }).click();
  await page.getByRole('button', { name: 'Составить сообщение' }).click();
  await page.getByText('Смотри, какой сегодня свет.').waitFor();
  await checkLayout(page, device);
  await page.getByRole('button', { name: 'Отправить' }).click();
  pathObserved.push('message:photo');
  await page.getByText('Я узнала этот свет!').waitFor();
  pathObserved.push('echo:mira');
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByText('Ракушка звякнула').waitFor();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByText('Экран погас').waitFor();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByRole('button', { name: 'Пойти навстречу Мире' }).waitFor();
  await checkLayout(page, device); // Relationship-gated route menu.
  await page.getByRole('button', { name: 'Пойти навстречу Мире' }).click();
  pathObserved.push('route:mira');
  await page.getByRole('button', { name: 'Остаться у маяка' }).click();
  pathObserved.push('ending:lighthouse');
  await page.getByText('Когда Мира появилась').waitFor();
  await page.getByRole('button', { name: 'Журнал' }).click();
  await page.getByText('Снимок у маяка').waitFor();
  await page.getByText('Белая ракушка').waitFor();
  await checkLayout(page, device); // Open journal cards and long labels.
  await page.locator('.ludory-narrative__journal img').evaluate(async img => {
    await img.decode();
    if (!img.naturalWidth) throw new Error('Undecoded journal photo');
  });
  pathObserved.push('journal:photo-shell');
  await page.getByRole('button', { name: 'Скрыть журнал' }).click();
  await page.locator('#save').click();
  await page.getByText('Сохранено').waitFor();
  const platformCloud = await page.evaluate(() => structuredClone(globalThis.__f5b3Sdk.cloud));
  assert.ok(Object.keys(platformCloud).some(key => key.includes('f5b3-author')), `${target} cloud save was not written`);
  assert.equal(await page.evaluate(() => localStorage.getItem('ludory-narrative-v1:f5b3-author:narrative-demo')),
    null, 'platform save must not fall back to source preview localStorage');
  pathObserved.push('save:platform-cloud');
  const sdkCallsBeforeReload = await page.evaluate(() => [...globalThis.__f5b3Sdk.calls]);
  await page.reload();
  await page.locator('#status[data-sdk-ready="true"]').waitFor();
  await page.getByText('Когда Мира появилась').waitFor();
  await page.getByText('Сохранение восстановлено').waitFor();
  await page.getByRole('button', { name: 'Журнал' }).click();
  await page.getByText('Снимок у маяка').waitFor();
  await page.getByText('Белая ракушка').waitFor();
  await checkLayout(page, device); // Restored journal, including WebKit.
  await page.getByRole('button', { name: 'Скрыть журнал' }).click();
  assert.equal(await page.getByRole('button', { name: 'Назад' }).count(), 0,
    'transient Back history must not survive a cloud restore');
  pathObserved.push('reload:restored');
  await checkLayout(page, device);
  assert.deepEqual(pathObserved, F5B3_STORY_PATH);
  return { observedStoryPath: pathObserved, sdkCallsBeforeReload };
}

export async function runNarrativeCandidate(fixture, entry, target) {
  await fixture.assertVerified();
  const server = await fixture.serve(target);
  let browser;
  let context;
  const external = [];
  const browserErrors = [];
  try {
    browser = await entry.engine.launch({ headless: true });
    context = await browser.newContext(entry.options);
    const page = await context.newPage();
    page.setDefaultTimeout(6_000);
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(server.url) || url.startsWith('data:') || url.startsWith('blob:')) {
        return route.continue();
      }
      external.push(url);
      return route.abort();
    });
    page.on('pageerror', error => browserErrors.push(error.message));
    const loaded = await page.goto(server.url, { waitUntil: 'load' });
    assert.equal(loaded?.status(), 200);
    assert.equal(loaded?.headers()['x-content-type-options'], 'nosniff');
    assert.equal(loaded?.headers()['cache-control'], 'no-store');
    const { observedStoryPath, sdkCallsBeforeReload } = await playAuthoredStory(page, target, entry.device);
    const callsAfterReload = await page.evaluate(() => [...globalThis.__f5b3Sdk.calls]);
    const calls = [...sdkCallsBeforeReload, ...callsAfterReload];
    if (target === 'yandex') {
      for (const action of ['sdk:init', 'loading:ready', 'gameplay:start', 'player:getData', 'player:setData']) {
        assert.ok(calls.includes(action), `Yandex SDK did not observe ${action}: ${calls.join(',')}`);
      }
    } else {
      for (const action of ['VKWebAppInit', 'VKWebAppStorageGet', 'VKWebAppStorageSet']) {
        assert.ok(calls.includes(action), `VK Bridge did not observe ${action}: ${calls.join(',')}`);
      }
    }
    assert.deepEqual(browserErrors, [], 'runtime generated uncaught browser errors');
    assert.deepEqual(external, [], 'browser attempted to request a non-local resource');
    await fixture.assertVerified();
    return {
      target, browser: entry.browser, device: entry.device, viewport: entry.options.viewport,
      status: 'PASS', archiveSha256: fixture.candidates[target].archiveSha256,
      sourceDigest: fixture.sourceDigest, externalRequests: external.length,
      sdkCalls: calls, observedStoryPath, mockSdkOnly: true,
    };
  } finally {
    await closeBrowserCase(context, browser, server);
  }
}

export async function runAdverseCandidate(fixture, target, mode) {
  const server = await fixture.serve(target, { sdkMode: ['sdk-pause-resume', 'pagehide-restore'].includes(mode)
    ? 'normal' : mode });
  let browser;
  let context;
  const external = [];
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1000, height: 720 } });
    const page = await context.newPage();
    page.setDefaultTimeout(6_000);
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(server.url) || url.startsWith('data:') || url.startsWith('blob:')) {
        return route.continue();
      }
      external.push(url);
      return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    if (mode === 'init-refused' || mode === 'ready-refused') {
      await page.locator('#status[data-error-code]').waitFor();
      assert.equal(await page.locator('#status').getAttribute('data-sdk-ready'), null,
        `${target}/${mode} must not mark the host SDK-ready`);
      assert.equal(await page.locator('#status').getAttribute('data-error-code') !== null, true);
      if (mode === 'init-refused') {
        assert.equal(await page.getByRole('button', { name: 'Далее' }).count(), 0,
          `${target}/${mode}: initialization refusal must not mount the story`);
      } else {
        const start = page.getByRole('button', { name: 'Далее' });
        if (await start.count()) await start.click();
        assert.equal(await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).count(), 0,
          `${target}/${mode}: readiness refusal must not advance game input`);
      }
      const calls = await page.evaluate(() => globalThis.__f5b3Sdk.calls);
      assert.equal(calls.includes('gameplay:start'), false);
    } else if (mode === 'storage-refused') {
      await page.locator('#status[data-sdk-ready="true"]').waitFor();
      await page.locator('#save').click();
      await page.getByText('Не удалось сохранить').waitFor();
      assert.deepEqual(await page.evaluate(() => globalThis.__f5b3Sdk.cloud), {});
      assert.equal(await page.evaluate(() =>
        localStorage.getItem('ludory-narrative-v1:f5b3-author:narrative-demo')), null);
      const calls = await page.evaluate(() => globalThis.__f5b3Sdk.calls);
      assert.ok(calls.includes(target === 'yandex' ? 'player:setData' : 'VKWebAppStorageSet'));
    } else if (mode === 'corrupt-cloud') {
      await page.getByText('Не удалось восстановить сохранение').waitFor();
      assert.equal(await page.locator('#save').isDisabled(), true);
      const original = await page.evaluate(() => JSON.stringify(globalThis.__f5b3Sdk.cloud));
      await page.reload();
      await page.getByText('Не удалось восстановить сохранение').waitFor();
      assert.equal(await page.locator('#save').isDisabled(), true);
      assert.equal(await page.evaluate(() => JSON.stringify(globalThis.__f5b3Sdk.cloud)), original,
        'failed restore must not modify invalid platform record');
      assert.equal(await page.evaluate(() =>
        localStorage.getItem('ludory-narrative-v1:f5b3-author:narrative-demo')), null);
    } else {
      await page.locator('#status[data-sdk-ready="true"]').waitFor();
      await page.getByRole('button', { name: 'Далее' }).click();
      await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).waitFor();
      const event = mode === 'sdk-pause-resume'
        ? target === 'yandex' ? ['game_api_pause', 'game_api_resume'] : ['VKWebAppViewHide', 'VKWebAppViewRestore']
        : ['pagehide', 'pageshow'];
      const dispatch = async stage => page.evaluate(({ stage, event }) => {
        if (event === 'pagehide' || event === 'pageshow') {
          window.dispatchEvent(new PageTransitionEvent(event, { persisted: true }));
        } else {
          globalThis.__f5b3Sdk.emit(event);
        }
      }, { stage, event: event[stage] });
      await dispatch(0);
      await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
      await page.waitForTimeout(100);
      assert.equal(await page.getByRole('button', { name: 'Белая ракушка' }).count(), 0,
        'input during platform pause must not advance the story');
      assert.equal(await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).count(), 1);
      if (target === 'yandex') {
        const during = await page.evaluate(() => [...globalThis.__f5b3Sdk.calls]);
        assert.ok(during.includes('gameplay:stop'), 'Yandex pause must close gameplay marker');
      }
      await dispatch(1);
      // A paused command queued for the next frame would run here: inspect
      // after resume *before* any fresh user input can hide that regression.
      await page.waitForTimeout(120);
      assert.equal(await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).count(), 1,
        'queued paused input must not run after resume');
      assert.equal(await page.getByRole('button', { name: 'Белая ракушка' }).count(), 0,
        'resume must not replay a photo selection attempted during pause');
      await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
      await page.getByRole('button', { name: 'Белая ракушка' }).waitFor();
      await page.getByRole('button', { name: 'Назад' }).click();
      await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).waitFor();
      if (target === 'yandex') {
        const after = await page.evaluate(() => [...globalThis.__f5b3Sdk.calls]);
        assert.equal(after.filter(call => call === 'gameplay:start').length, 2,
          'Yandex resume must start gameplay once and only once');
      }
    }
    assert.deepEqual(external, [], `${target}/${mode} requested external network`);
    assert.deepEqual(errors, [], `${target}/${mode} had an unhandled page error`);
    await fixture.assertVerified();
    return { target, browser: 'chromium', device: 'desktop', scenario: mode, status: 'PASS',
      archiveSha256: fixture.candidates[target].archiveSha256, sourceDigest: fixture.sourceDigest,
      externalRequests: external.length, mockSdkOnly: true };
  } finally {
    await closeBrowserCase(context, browser, server);
  }
}

async function main() {
  const artifactDirectory = process.env.LUDORY_F5B3_ARTIFACT_DIR
    ? path.resolve(process.env.LUDORY_F5B3_ARTIFACT_DIR) : null;
  let fixture;
  let fixtureChecks = 'NOT_RUN';
  const results = [];
  let fatal;
  let receipt;
  try {
    const localDirectory = path.dirname(fileURLToPath(import.meta.url));
    const check = spawnSync(process.execPath, ['--test', 'f5b3-fixture.test.mjs'],
      { cwd: localDirectory, timeout: 30_000, encoding: 'utf8' });
    if (check.error || check.status !== 0) {
      throw new Error(`F5B3_FIXTURE_TESTS_FAILED: ${String(
        (check.error?.message ?? check.stderr) || check.stdout || 'fixture test terminated').slice(0, 250)}`);
    }
    fixtureChecks = 'PASS';
    fixture = await createF5b3Fixture();
    assert.equal(fixture.verification.status, 'LOCAL_ARCHIVES_VERIFIED');
    const selected = process.env.LUDORY_F5B3_LOCAL_ENGINE
      ? matrix.filter(entry => entry.browser === process.env.LUDORY_F5B3_LOCAL_ENGINE) : matrix;
    assert.ok(selected.length, 'F5B3_UNKNOWN_LOCAL_ENGINE');
    for (const entry of selected) for (const target of ['yandex', 'vk']) {
      try {
        results.push(await runNarrativeCandidate(fixture, entry, target));
      } catch (error) {
        results.push(failedScenario(fixture, { target, browser: entry.browser, device: entry.device }, error));
      }
    }
    for (const entry of selected) {
      const [yandex, vk] = results.filter(result => result.browser === entry.browser &&
        result.device === entry.device && !result.scenario);
      if (yandex.status === 'PASS' && vk.status === 'PASS') {
        assert.deepEqual(yandex.observedStoryPath, vk.observedStoryPath,
          'both SDK targets must produce the same observed authored choices');
      }
    }
    for (const target of ['yandex', 'vk']) {
      for (const mode of F5B3_ADVERSE_CASES) {
        try {
          results.push(await runAdverseCandidate(fixture, target, mode));
        } catch (error) {
          results.push(failedScenario(fixture, { target, browser: 'chromium', device: 'desktop',
            scenario: mode }, error));
        }
      }
    }
  } catch (error) {
    fatal = error;
  } finally {
    try { await fixture?.cleanup(); }
    catch (error) { fatal ??= error; }
    receipt = buildF5b3Evidence({
      sourceDigest: fixture?.sourceDigest,
      archiveSha256: fixture ? Object.fromEntries(
        ['yandex', 'vk'].map(target => [target, fixture.candidates[target].archiveSha256])) : {},
      results, fixtureChecks,
    });
    if (fatal) {
      receipt.status = 'BLOCKED';
      receipt.failures = [...new Set([...(receipt.failures ?? []), 'F5B3_RUNNER_FAILED'])];
      receipt.error = String(fatal.message).slice(0, 450);
    }
    if (artifactDirectory) {
      fs.mkdirSync(artifactDirectory, { recursive: true });
      fs.writeFileSync(path.join(artifactDirectory, 'f5b3-mock-browser.json'), JSON.stringify(receipt, null, 2) + '\n');
    }
  }
  console.log(JSON.stringify({ status: receipt.status,
    sourceDigest: receipt.sourceDigest, archiveSha256: receipt.archiveSha256,
    scenarios: receipt.results.length, failures: receipt.failures ?? [],
    ...(artifactDirectory ? { evidence: path.join(artifactDirectory, 'f5b3-mock-browser.json') } : {}),
  }));
  if (receipt.status !== 'MOCK_SDK_BROWSER_PASS') process.exitCode = 1;
}

function failedScenario(fixture, scenario, error) {
  const message = String(error?.message ?? error).slice(0, 450);
  const missingEngine = /Executable doesn't exist|Host system is missing dependencies/.test(message);
  return { ...scenario, status: missingEngine ? 'NOT_RUN' : 'BLOCKED',
    sourceDigest: fixture.sourceDigest, archiveSha256: fixture.candidates[scenario.target].archiveSha256,
    externalRequests: null, mockSdkOnly: true, error: message };
}

if (isF5b3DirectInvocation(process.argv[1], import.meta.url)) {
  await main();
}
