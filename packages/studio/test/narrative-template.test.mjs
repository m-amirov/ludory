import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'parse5';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { loadCatalog, validateNarrativeAuthorProof } from '../src/catalog.mjs';
import { planPreviewBuild, buildPreview } from '../src/preview-build.mjs';
import { buildNarrativeBundle, verifyStoryAssets } from '../../../scripts/build-narrative-template.mjs';
import { graphData, catalogData, assets } from '../catalog/templates/narrative-interactive/src/story.js';
import { defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState, advanceNarrative, resolveNarrativeView } from '@ludory/narrative';

const originalTemplate = fileURLToPath(new URL('../catalog/templates/narrative-interactive/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function mobileOrientationMeta(html) {
  const queue = [parse(html)];
  while (queue.length) {
    const node = queue.shift();
    if (node.tagName === 'meta' && node.attrs?.some(attr => attr.name === 'name' && attr.value === 'ludory-mobile-orientation')) {
      return node.attrs.find(attr => attr.name === 'content')?.value;
    }
    queue.push(...(node.childNodes ?? []));
  }
  return undefined;
}

test('new narrative games opt into portrait metadata without imposing it on other genres', t => {
  for (const template of ['narrative-basic', 'narrative-interactive']) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-portrait-new-'));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    const plan = planCreate(project, { id: `${template}-new`, title: 'Story', lang: 'en',
      profile: 'narrative-game', template, targets: ['vk-games', 'yandex-games'] });
    assert.equal(plan.status, 'READY');
    assert.deepEqual(fs.readdirSync(project), [], 'planning does not change an existing project');
    applyCreatePlan(plan);
    const htmlPath = path.join(project, 'index.html');
    assert.equal(mobileOrientationMeta(fs.readFileSync(htmlPath, 'utf8')), 'portrait', template);
    const receipt = JSON.parse(fs.readFileSync(path.join(project, 'ludory.studio.json')));
    assert.equal(receipt.template.version, template === 'narrative-interactive' ? '1.2.4' : '1.1.0');
    // An author can opt out in a newly created game; catalog and the creation receipt remain unchanged.
    const html = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(htmlPath, html.replace('content="portrait"', 'content="auto"'));
    assert.equal(mobileOrientationMeta(fs.readFileSync(htmlPath, 'utf8')), 'auto');
    assert.equal(mobileOrientationMeta(fs.readFileSync(path.join(originalTemplate, 'index.html'), 'utf8')),
      'portrait', 'opting out in a project does not mutate bundled templates');
  }
  for (const template of ['web-basic', 'runtime-basic', 'vk-runtime', 'yandex-runtime']) {
    const bundled = loadCatalog().templates.get(template);
    assert.equal(mobileOrientationMeta(bundled.assets.get('index.html').bytes.toString('utf8')), undefined,
      `non-narrative ${template} keeps its current layout`);
  }
});

test('narrative source bundle is deterministic and exactly matches shipped bytes', async () => {
  const first = await buildNarrativeBundle();
  const second = await buildNarrativeBundle();
  assert.equal(hash(first), hash(second));
  assert.equal(hash(first), hash(fs.readFileSync(path.join(originalTemplate, 'assets/ludory-narrative.js'))));
  assert.ok(first.length > 5_000);
  assert.match(first.toString(), /defineNarrativePresentation/, 'bundled API must be available to games');
  // N2 parses against this synthetic origin for URL safety; it never fetches it.
  const bundle = first.toString().replaceAll('https://ludory.local/story/', '').replaceAll('https://ludory.local', '');
  assert.doesNotMatch(bundle, /https?:\/\/|from\s*['"]@ludory\/|\bimport\s*\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(originalTemplate, 'src/main.js'), 'utf8'), /https?:\/\/|from\s*['"]@ludory\//);
});

test('optional story presentation is backward compatible with an old story.js export list', async t => {
  const source = fs.readFileSync(path.join(originalTemplate, 'src/main.js'), 'utf8');
  assert.match(source, /import \* as story from ['"]\.\/story\.js['"]/);
  assert.match(source, /Reflect\.get\(story, 'presentationData'\)/);
  assert.doesNotMatch(source, /import\s*\{[^}]*presentationData[^}]*\}\s*from\s*['"]\.\/story\.js['"]/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-legacy-story-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(applyCreatePlan(planCreate(dir, { id: 'old-legacy-story', title: 'Legacy', lang: 'ru',
    profile: 'narrative-game', template: 'narrative-interactive', targets: ['vk-games', 'yandex-games'] })).status, 'APPLIED');
  const authored = fs.readFileSync(path.join(dir, 'src/story.js'), 'utf8');
  const legacy = authored.replace(/^export const presentationData = undefined;?\n/m, '');
  assert.notEqual(legacy, authored);
  fs.writeFileSync(path.join(dir, 'src/story.js'), legacy);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'src/story.js'), 'utf8'), /export const presentationData/);
  const { pathToFileURL } = await import('node:url');
  assert.equal(typeof (await import(pathToFileURL(path.join(dir, 'src/main.js')).href)).startNarrative, 'function');
});

test('a proved optional visual file is included in Studio preview; tamper and symlink block', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-art-proof-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(applyCreatePlan(planCreate(dir, { id: 'art-proof', title: 'Art', lang: 'ru',
    profile: 'narrative-game', template: 'narrative-interactive', targets: ['vk-games', 'yandex-games'] })).status, 'APPLIED');
  const image = path.join(dir, 'assets/vis-intro.webp');
  const contents = Buffer.from('RIFF0000WEBPVP8 mock visual proof');
  fs.writeFileSync(image, contents);
  const proofPath = path.join(dir, 'narrative-assets.json');
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  proof.assets['vis-intro'] = { path: 'assets/vis-intro.webp', sha256: hash(contents) };
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  const ready = planPreviewBuild(dir);
  assert.equal(ready.status, 'READY', ready.reasonCode);
  const built = buildPreview(ready);
  assert.equal(built.status, 'BUILT', built.reasonCode);
  t.after(() => built.cleanup());
  assert.deepEqual(fs.readFileSync(path.join(built.root, 'assets/vis-intro.webp')), contents);
  fs.appendFileSync(image, 'tamper');
  assert.equal(planPreviewBuild(dir).status, 'BLOCKED');
  fs.unlinkSync(image);
  fs.symlinkSync(path.join(dir, 'src/story.js'), image);
  assert.equal(planPreviewBuild(dir).status, 'BLOCKED');
});

test('narrative preview refuses missing asset proof and unproved visual files', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-art-proof-required-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(applyCreatePlan(planCreate(dir, { id: 'art-proof-required', title: 'Art', lang: 'ru',
    profile: 'narrative-game', template: 'narrative-interactive', targets: ['vk-games', 'yandex-games'] })).status, 'APPLIED');
  const proofPath = path.join(dir, 'narrative-assets.json');
  const original = fs.readFileSync(proofPath);
  fs.unlinkSync(proofPath);
  const noProof = planPreviewBuild(dir);
  assert.equal(noProof.status, 'BLOCKED');
  assert.match(noProof.reasonCode, /PROOF|MANIFEST/);
  fs.writeFileSync(proofPath, original);
  const image = path.join(dir, 'assets/vis-unregistered.png');
  const bytes = Buffer.from('unregistered-art');
  fs.writeFileSync(image, bytes);
  const unproved = planPreviewBuild(dir);
  assert.equal(unproved.status, 'BLOCKED');
  assert.match(unproved.reasonCode, /PROOF|MANIFEST/);
  const proof = JSON.parse(original);
  proof.assets['vis-unregistered'] = { path: 'assets/vis-unregistered.png', sha256: hash(bytes) };
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  assert.equal(planPreviewBuild(dir).status, 'READY');
});

test('story validates as a canonical graph with complete authored delayed echoes and local images', () => {
  const result = verifyStoryAssets({ templateDir: originalTemplate, graphData, catalogData, assets });
  assert.ok(result.assetIds.includes('lighthouse'));
  assert.ok(result.echoCoverage);
});

test('missing, linked and cross-origin assets fail closed before project creation', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-narrative-assets-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const image = path.join(temp, 'lighthouse.svg');
  fs.writeFileSync(image, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.throws(() => verifyStoryAssets({ templateDir: temp, graphData, catalogData, assets }), /missing|asset|image|local/i);
  assert.throws(() => verifyStoryAssets({ templateDir: temp, graphData, catalogData,
    assets: { ...assets, lighthouse: 'https://example.invalid/image.svg' } }), /local|URL|asset/i);
  const inside = path.join(temp, 'assets');
  fs.mkdirSync(inside);
  fs.symlinkSync(image, path.join(inside, 'lighthouse.svg'));
  assert.throws(() => verifyStoryAssets({ templateDir: temp, graphData, catalogData,
    assets: { lighthouse: './assets/lighthouse.svg' } }), /symbolic|link|unsafe/i);
  const orphanedAttachment = structuredClone(catalogData);
  orphanedAttachment.interactions.find(i => i.id === 'note').variants[0].attachmentId = 'missing-frame';
  assert.throws(() => verifyStoryAssets({ graphData, catalogData: orphanedAttachment, assets }),
    /attachment|image|asset|photo/i);
});

test('an unshared photo must not trigger an echo claiming its delivery to Mira', () => {
  const graph = defineNarrativeGraph(graphData);
  const catalog = defineNarrativeCatalog(catalogData);
  let state = createNarrativeState(graph);
  state = advanceNarrative(graph, catalog, state, { type: 'next' }).state;
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'take' }).state;
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'shell' }).state;
  state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'support' }).state;
  const seen = [];
  while (resolveNarrativeView(graph, catalog, state).type === 'echo') {
    seen.push(resolveNarrativeView(graph, catalog, state).text);
    state = advanceNarrative(graph, catalog, state, { type: 'next' }).state;
  }
  assert.equal(state.album.includes('lighthouse'), true);
  assert.equal(state.messages.at(-1).attachmentId ?? null, null);
  assert.doesNotMatch(seen.join(' '), /заметила снимок в переписке/i);
  assert.match(seen.join(' '), /снимок остался в альбоме/i);
});

test('photo options include two meaningful frames and each may be sent as a message attachment', () => {
  const graph = defineNarrativeGraph(graphData);
  const catalog = defineNarrativeCatalog(catalogData);
  const photoOptions = catalog.interactions.find(i => i.id === 'camera').options.filter(o => o.assetId);
  assert.equal(photoOptions.length, 2);
  assert.notEqual(photoOptions[0].assetId, photoOptions[1].assetId);
  for (const option of photoOptions) {
    let state = createNarrativeState(graph);
    state = advanceNarrative(graph, catalog, state, { type: 'next' }).state;
    state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: option.id }).state;
    state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'shell' }).state;
    assert.ok(resolveNarrativeView(graph, catalog, state).variants.some(v => v.attachmentId === option.assetId));
    state = advanceNarrative(graph, catalog, state, { type: 'interact', optionId: 'support' }).state;
    const echoes = [];
    while (resolveNarrativeView(graph, catalog, state).type === 'echo') {
      echoes.push(resolveNarrativeView(graph, catalog, state).text);
      state = advanceNarrative(graph, catalog, state, { type: 'next' }).state;
    }
    assert.match(echoes.join(' '), /Снимок остался в альбоме/);
  }
});

test('Studio blocks a modified narrative source without a matching asset validation proof', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-asset-proof-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const catalog = path.join(dir, 'catalog');
  const profileDir = path.join(catalog, 'profiles');
  const templateDir = path.join(catalog, 'templates', 'narrative-asset-audit');
  const gameDir = path.join(dir, 'game');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.cpSync(originalTemplate, templateDir, { recursive: true });
  fs.mkdirSync(gameDir);
  const template = JSON.parse(fs.readFileSync(path.join(templateDir, 'template.json'), 'utf8'));
  template.id = 'narrative-asset-audit';
  template.profile = 'narrative-asset-audit';
  fs.writeFileSync(path.join(templateDir, 'template.json'), JSON.stringify(template));
  fs.writeFileSync(path.join(profileDir, 'narrative-asset-audit.json'), JSON.stringify({
    schemaVersion: 1, id: 'narrative-asset-audit', version: '1.0.0', description: 'Integrity test',
    engine: template.engine, targets: template.targets, templates: [template.id],
  }));
  const source = path.join(templateDir, 'src/story.js');
  fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('./assets/lighthouse.svg', './assets/missing.svg'));
  assert.throws(() => planCreate(gameDir, { id: 'audit', title: 'Audit', lang: 'ru',
    profile: template.profile, template: template.id, targets: template.targets, catalog }),
  /integrity|proof|asset|stale|mismatch/i);
  assert.deepEqual(fs.readdirSync(gameDir), []);
});

test('the built-in interactive novel cannot opt out of its asset proof by deleting the file declaration', () => {
  const bundled = loadCatalog().templates.get('narrative-interactive');
  const missingProof = new Map(bundled.assets);
  missingProof.delete('narrative-assets.json');
  assert.throws(() => validateNarrativeAuthorProof(missingProof, { templateId: bundled.id }), /proof|required|missing/i);
});

test('Studio create receipts preserve exact N3 bundle hashes without template imports', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-narrative-created-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plan = planCreate(dir, { id: 'new-world', title: 'New World', lang: 'en',
    profile: 'narrative-game', template: 'narrative-interactive', targets: ['vk-games', 'yandex-games'] });
  assert.equal(plan.status, 'READY');
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.ok(plan.writes.includes('assets/ludory-narrative.js'));
  applyCreatePlan(plan);
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'ludory.studio.json')));
  assert.equal(receipt.template.id, 'narrative-interactive');
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'ludory.components.json')));
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.authorFiles, ['src/story.js', 'narrative-assets.json', 'assets/lighthouse.svg', 'assets/shoreline.svg']);
  for (const name of state.authorFiles) {
    assert.equal(Object.hasOwn(state.files, name), false, `authored content must not be a managed component: ${name}`);
    assert.match(receipt.files[name], /^[a-f0-9]{64}$/);
  }
  for (const name of ['src/main.js', 'src/entry.js', 'index.html', 'assets/ludory-narrative.js']) {
    assert.match(state.files[name], /^[a-f0-9]{64}$/);
  }
  for (const [file, digest] of Object.entries(receipt.files)) assert.equal(hash(fs.readFileSync(path.join(dir, file))), digest, file);
  const entry = fs.readFileSync(path.join(dir, 'src/main.js'), 'utf8');
  assert.match(entry, /assets\/ludory-narrative\.js/);
  assert.doesNotMatch(entry, /from\s*['"]@ludory\//);
});

test('narrative authored entry exports a launch function without starting on import', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-narrative-entry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plan = planCreate(dir, { id: 'entry-contract', title: 'Entry', lang: 'ru',
    profile: 'narrative-game', template: 'narrative-interactive', targets: ['yandex-games', 'vk-games'] });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  const { pathToFileURL } = await import('node:url');
  // A source module must be safe to bundle/import without a browser; only the
  // preview's explicit src/entry.js is allowed to call startNarrative().
  const entry = await import(pathToFileURL(path.join(dir, 'src/main.js')).href);
  assert.equal(typeof entry.startNarrative, 'function');
  assert.equal(entry.resolveNarrativeTitle({ title: { ru: 'Поцелуй на краю света' } }, 'ru'),
    'Поцелуй на краю света · Ludory');
  assert.equal(entry.resolveNarrativeTitle({ title: { ru: 'Поцелуй на краю света' } }, 'en'),
    'Поцелуй на краю света · Ludory', 'a missing translation must not show the template demo');
  assert.equal(entry.resolveNarrativeTitle({ title: { ru: 'Поцелуй на краю света', en: 'Kiss at the Edge' } }, 'en'),
    'Kiss at the Edge · Ludory');
  assert.equal(entry.resolveNarrativeTitle({ title: { fr: 'Le Phare', ru: 'Маяк' } }, 'it'),
    'Маяк · Ludory', 'an unknown locale must use the RU title when available');
  const initialHtml = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(initialHtml, /Вечер у маяка|Lighthouse Evening/);
  assert.ok(fs.readFileSync(path.join(dir, 'src/entry.js'), 'utf8').includes('startNarrative'));
});
