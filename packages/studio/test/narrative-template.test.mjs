import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { loadCatalog, validateNarrativeAuthorProof } from '../src/catalog.mjs';
import { buildNarrativeBundle, verifyStoryAssets } from '../../../scripts/build-narrative-template.mjs';
import { graphData, catalogData, assets } from '../catalog/templates/narrative-interactive/src/story.js';
import { defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState, advanceNarrative, resolveNarrativeView } from '@ludory/narrative';

const originalTemplate = fileURLToPath(new URL('../catalog/templates/narrative-interactive/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('narrative source bundle is deterministic and exactly matches shipped bytes', async () => {
  const first = await buildNarrativeBundle();
  const second = await buildNarrativeBundle();
  assert.equal(hash(first), hash(second));
  assert.equal(hash(first), hash(fs.readFileSync(path.join(originalTemplate, 'assets/ludory-narrative.js'))));
  assert.ok(first.length > 5_000);
  // N2 parses against this synthetic origin for URL safety; it never fetches it.
  const bundle = first.toString().replaceAll('https://ludory.local/story/', '').replaceAll('https://ludory.local', '');
  assert.doesNotMatch(bundle, /https?:\/\/|from\s*['"]@ludory\/|\bimport\s*\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(originalTemplate, 'src/main.js'), 'utf8'), /https?:\/\/|from\s*['"]@ludory\//);
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
  for (const [file, digest] of Object.entries(receipt.files)) assert.equal(hash(fs.readFileSync(path.join(dir, file))), digest, file);
  const entry = fs.readFileSync(path.join(dir, 'src/main.js'), 'utf8');
  assert.match(entry, /assets\/ludory-narrative\.js/);
  assert.doesNotMatch(entry, /from\s*['"]@ludory\//);
});
