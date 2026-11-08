/** Real-browser layout check for opt-in visual staging. Fixture images are tiny synthetic PNGs,
 * so this verifies decoding and composition geometry, not real character/face art acceptance. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { planCreate, applyCreatePlan } from '../../../studio/src/scaffold.mjs';
import { planPreviewBuild, buildPreview } from '../../../studio/src/preview-build.mjs';
import { startPreviewServer } from '../../../studio/src/preview-server.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artDir = process.env.LUDORY_M4_ARTIFACT_DIR ? path.resolve(process.env.LUDORY_M4_ARTIFACT_DIR) : null;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-m4-browser-'));
const game = path.join(sandbox, 'game');
let built, server;

// Known valid RGBA PNG; solely a proof of browser image handling and CSS geometry.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvZkAAAAASUVORK5CYII=', 'base64');
const images = {
  'vis-m4-bg.png': pixel, 'vis-m4-person.png': pixel, 'vis-m4-cg.png': pixel,
  'vis-m4-broken.png': Buffer.from('INVALID_PNG_DECODE'),
};

async function runCase(base, size, name) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: size, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith(base) && !request.url().startsWith('data:')) errors.push(`external: ${request.url()}`);
  });
  try {
    await page.goto(base);
    const stage = page.locator('.ludory-narrative__stage');
    await stage.waitFor();
    if (await stage.getAttribute('data-variant-id') !== 'intro') throw new Error(`${name}: initial visual beat missing`);
    const background = stage.locator('[data-role=background]');
    const portrait = stage.locator('[data-role=portrait]');
    await background.evaluate(img => img.decode());
    await portrait.evaluate(img => img.decode());
    if (await portrait.getAttribute('alt') !== 'Мира') throw new Error(`${name}: portrait alt is wrong`);
    await page.getByRole('button', { name: 'English' }).click();
    if (await portrait.getAttribute('alt') !== 'Mira') throw new Error(`${name}: locale did not update art alt`);
    await page.getByRole('button', { name: 'Русский' }).click();
    const dimensions = await page.evaluate(() => {
      const surface = document.querySelector('.ludory-narrative');
      const panel = surface.querySelector('.ludory-narrative__panel');
      const stage = surface.querySelector('.ludory-narrative__stage');
      const actor = stage.querySelector('[data-role=portrait]');
      const a = actor.getBoundingClientRect(), p = panel.getBoundingClientRect(), s = surface.getBoundingClientRect();
      return { panel: { top: p.top, bottom: p.bottom, left: p.left, right: p.right },
        portrait: { top: a.top, bottom: a.bottom, left: a.left, right: a.right },
        surface: { top: s.top, bottom: s.bottom, left: s.left, right: s.right },
        reducedMotion: { transition: getComputedStyle(panel).transitionDuration,
          animation: getComputedStyle(panel).animationDuration } };
    });
    const { panel, portrait: person, surface } = dimensions;
    if (panel.top < surface.top - 2 || panel.bottom > surface.bottom + 2 ||
        panel.left < surface.left - 2 || panel.right > surface.right + 2 ||
        person.top < surface.top - 2 || person.bottom > surface.bottom + 2 ||
        person.left < surface.left - 2 || person.right > surface.right + 2 ||
        Number.parseFloat(dimensions.reducedMotion.transition) !== 0 ||
        Number.parseFloat(dimensions.reducedMotion.animation) !== 0 ||
        !await page.getByRole('button', { name: 'Далее' }).isVisible()) {
      throw new Error(`${name}: scene crops dialogue or portrait ${JSON.stringify(dimensions)}`);
    }
    if (artDir) {
      fs.mkdirSync(artDir, { recursive: true });
      await page.screenshot({ path: path.join(artDir, `${name}-intro.png`) });
    }
    await page.locator('#save').click();
    await page.getByText('Сохранено').waitFor();
    await page.reload();
    if (await stage.getAttribute('data-variant-id') !== 'intro') throw new Error(`${name}: reload lost initial visual beat`);
    await page.getByRole('button', { name: 'Далее' }).click();
    // Runtime paints on a later frame; wait for the *new* stage, not the click event.
    await page.locator('.ludory-narrative__stage[data-variant-id="neutral"]').waitFor();
    if (await stage.getAttribute('data-variant-id') !== 'neutral' || await stage.locator('img').count()) {
      throw new Error(`${name}: explicit neutral leaked previous art`);
    }
    await page.getByRole('button', { name: 'Сфотографировать огни маяка' }).click();
    await page.locator('.ludory-narrative__stage[data-variant-id="replace"]').waitFor();
    if (await stage.getAttribute('data-cg-mode') !== 'replace-stage' ||
        await stage.locator('img').count() !== 1) throw new Error(`${name}: CG replace-stage invalid`);
    await stage.locator('[data-role=cg]').evaluate(img => img.decode());
    await page.getByRole('button', { name: 'Белая ракушка' }).click();
    await page.locator('.ludory-narrative__stage[data-variant-id="overlay"]').waitFor();
    if (await stage.getAttribute('data-cg-mode') !== 'overlay' ||
        await stage.locator('[data-role=background]').count() !== 1 ||
        await stage.locator('[data-role=cg]').count() !== 1) throw new Error(`${name}: CG overlay invalid`);
    await page.getByRole('button', { name: 'Назад' }).click();
    await page.locator('.ludory-narrative__stage[data-variant-id="replace"]').waitFor();
    if (await stage.getAttribute('data-cg-mode') !== 'replace-stage') throw new Error(`${name}: Back did not restore CG`);
    await page.getByRole('button', { name: 'Белая ракушка' }).click();
    await page.getByRole('button', { name: 'Отправить' }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Далее' }).click();
    await page.locator('.ludory-narrative__stage[data-degraded=true]').waitFor({ timeout: 5_000 });
    // The deliberately invalid image must disappear, leaving only neutral fill.
    if (await stage.getAttribute('data-variant-id') !== 'broken' || await stage.locator('img').count()) {
      throw new Error(`${name}: broken image did not degrade safely`);
    }
    if (errors.length) throw new Error(`${name}: ${errors.join(' | ')}`);
    if (artDir) await page.screenshot({ path: path.join(artDir, `${name}-late.png`) });
    return { viewport: name, status: 'PASS_BROWSER_GEOMETRY_ONLY' };
  } finally { await context.close(); await browser.close(); }
}

try {
  fs.mkdirSync(game);
  const plan = planCreate(game, { id: 'm4-browser-game', title: 'Вечер у маяка', lang: 'ru',
    profile: 'narrative-game', template: 'narrative-interactive', targets: ['yandex-games', 'vk-games'] });
  if (plan.status !== 'READY' || applyCreatePlan(plan).status !== 'APPLIED') throw new Error('M4 fixture create blocked');
  for (const [file, bytes] of Object.entries(images)) fs.writeFileSync(path.join(game, 'assets', file), bytes);
  const manifest = { schemaVersion: 1, media: {
    bg: { kind: 'background', src: 'assets/vis-m4-bg.png', alt: { ru: 'Маяк', en: 'Lighthouse' } },
    mira: { kind: 'portrait', src: 'assets/vis-m4-person.png', alt: { ru: 'Мира', en: 'Mira' } },
    cg: { kind: 'cg', src: 'assets/vis-m4-cg.png', alt: { ru: 'Момент', en: 'Moment' } },
    broken: { kind: 'background', src: 'assets/vis-m4-broken.png', alt: { ru: 'Нет картинки', en: 'Missing art' } },
  }, beats: {
    arrival: [{ id: 'intro', background: 'bg', portraits: [{ characterId: 'mira', mediaId: 'mira', slot: 'center' }],
      speaker: { ru: 'Мира', en: 'Mira' } }],
    take_photo: [{ id: 'neutral', neutral: { reason: 'interactive' } }],
    choose_item: [{ id: 'replace', cg: { mediaId: 'cg', mode: 'replace-stage' } }],
    send_note: [{ id: 'overlay', background: 'bg', cg: { mediaId: 'cg', mode: 'overlay' } }],
    commit_route: [{ id: 'broken', background: 'broken' }],
  } };
  const story = path.join(game, 'src/story.js');
  const before = fs.readFileSync(story, 'utf8');
  const after = before.replace('export const presentationData = undefined;',
    `export const presentationData = ${JSON.stringify(manifest)};`);
  if (after === before) throw new Error('M4 fixture lost optional story entrypoint');
  fs.writeFileSync(story, after);
  const proofPath = path.join(game, 'narrative-assets.json');
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  proof.storySha256 = hash(Buffer.from(after));
  for (const [file, bytes] of Object.entries(images)) proof.assets[file.slice(0, -4)] = {
    path: `assets/${file}`, sha256: hash(bytes),
  };
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  const staging = planPreviewBuild(game);
  if (staging.status !== 'READY') throw new Error(`M4 fixture proof blocked: ${staging.reasonCode}`);
  built = buildPreview(staging);
  if (built.status !== 'BUILT') throw new Error(`M4 fixture staging blocked: ${built.reasonCode}`);
  server = await startPreviewServer({ root: built.root, port: 0, buildSha256: built.buildSha256 });
  const results = [];
  for (const [name, viewport] of [['mobile-390x844', { width: 390, height: 844 }],
    ['desktop-1000x720', { width: 1000, height: 720 }]]) {
    results.push(await runCase(server.url, viewport, name));
  }
  process.stdout.write(`${JSON.stringify({ status: 'M4_BROWSER_GEOMETRY_PASS', results })}\n`);
} finally {
  await server?.close();
  built?.cleanup();
  fs.rmSync(sandbox, { recursive: true, force: true });
}
