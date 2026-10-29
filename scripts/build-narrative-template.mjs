import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { defineNarrativeGraph, defineNarrativeCatalog, validateNarrativeEchoCoverage } from '@ludory/narrative';
import { graphData, catalogData, assets } from '../packages/studio/catalog/templates/narrative-interactive/src/story.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const templateDir = path.join(root, 'packages/studio/catalog/templates/narrative-interactive');
const output = path.join(templateDir, 'assets/ludory-narrative.js');
const proofOutput = path.join(templateDir, 'narrative-assets.json');
const allowedPath = /^\.\/assets\/[a-z0-9_-]+\.(?:svg|png|webp|jpg|jpeg)$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Fail before scaffold when authored graph/echoes refer to missing or unsafe images. */
export function verifyStoryAssets({ templateDir: directory = templateDir, graphData: rawGraph,
  catalogData: rawCatalog, assets: authoredAssets }) {
  const graph = defineNarrativeGraph(rawGraph);
  const catalog = defineNarrativeCatalog(rawCatalog);
  const echoCoverage = validateNarrativeEchoCoverage(graph);
  for (const scene of graph.scenes) for (const beat of scene.beats) {
    if (!beat.interactionId) continue;
    const definition = catalog.interactions.find(i => i.id === beat.interactionId);
    if (!definition || definition.type !== beat.type) throw new TypeError(`Missing or mismatched interaction: ${beat.interactionId}`);
  }
  if (!authoredAssets || typeof authoredAssets !== 'object' || Array.isArray(authoredAssets)) {
    throw new TypeError('Story assets must be a local image map');
  }
  const ids = [...new Set(catalog.interactions.flatMap(i => i.type === 'photo'
    ? i.options.flatMap(o => o.assetId === undefined ? [] : [o.assetId]) : []))];
  for (const interaction of catalog.interactions.filter(i => i.type === 'message')) {
    for (const variant of interaction.variants) {
      if (variant.attachmentId !== undefined && !ids.includes(variant.attachmentId)) {
        throw new TypeError(`Message attachment has no authored photo asset: ${variant.attachmentId}`);
      }
    }
  }
  for (const id of ids) {
    if (!Object.hasOwn(authoredAssets, id)) throw new TypeError(`Missing authored image for ${id}`);
    const filename = authoredAssets[id];
    if (typeof filename !== 'string' || !allowedPath.test(filename)) throw new TypeError(`Non-local image URL for ${id}`);
    const folder = path.join(directory, 'assets');
    const folderStat = fs.lstatSync(folder);
    if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) throw new TypeError('Unsafe image directory');
    const target = path.join(directory, filename.slice(2));
    let stat;
    try { stat = fs.lstatSync(target); }
    catch { throw new TypeError(`Missing image asset: ${filename}`); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 2_000_000) {
      throw new TypeError(`Unsafe symbolic or oversized image asset: ${filename}`);
    }
    // SVG is authored first-party, but reject external image/script payloads before bundling.
    if (filename.endsWith('.svg') && /<script\b|\bon\w+\s*=|(?:href|src)\s*=\s*['"](?:https?:|\/\/|data:)/i.test(fs.readFileSync(target, 'utf8'))) {
      throw new TypeError(`Unsafe active SVG image asset: ${filename}`);
    }
  }
  for (const [id, value] of Object.entries(authoredAssets)) {
    if (!ids.includes(id) || typeof value !== 'string' || !allowedPath.test(value)) {
      throw new TypeError(`Unused or unsafe image mapping: ${id}`);
    }
  }
  return { assetIds: ids, echoCoverage };
}

/** Deterministic self-contained ESM bundle, no CDN or runtime build step in generated game. */
export async function buildNarrativeBundle() {
  verifyStoryAssets({ graphData, catalogData, assets });
  const compiled = await build({
    stdin: { contents: [
      "export { defineGame } from '@ludory/core';",
      "export { defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState } from '@ludory/narrative';",
      "export { createNarrativeRenderer, createNarrativeRuntimeUpdate } from '@ludory/runtime-narrative';",
      "export { createRuntimeHost, createBrowserEnvironment, createBrowserStorage } from '@ludory/runtime';",
    ].join('\n'), resolveDir: root, sourcefile: 'narrative-exports.js' },
    bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], minify: true,
    legalComments: 'none', logLevel: 'silent', absWorkingDir: root, outfile: output, write: false,
  });
  if (compiled.errors.length || compiled.outputFiles.length !== 1) throw new TypeError('Unresolved narrative bundle imports');
  return Buffer.from(compiled.outputFiles[0].contents);
}

/** Authoring-time semantic validation sealed to source and image bytes. Studio only reads this JSON proof. */
export function createNarrativeAuthorProof() {
  const declaration = JSON.parse(fs.readFileSync(path.join(templateDir, 'template.json'), 'utf8'));
  if (declaration.id !== 'narrative-interactive' ||
      !Array.isArray(declaration.files) || !declaration.files.includes('narrative-assets.json')) {
    throw new TypeError('Interactive narrative template must declare its author asset proof');
  }
  const { assetIds } = verifyStoryAssets({ graphData, catalogData, assets });
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    storySha256: sha256(fs.readFileSync(path.join(templateDir, 'src/story.js'))),
    assets: Object.fromEntries(assetIds.sort().map(id => [id, {
      path: assets[id].slice(2),
      sha256: sha256(fs.readFileSync(path.join(templateDir, assets[id].slice(2)))),
    }])),
  }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.length === 3 && process.argv[2] === '--check';
  if (process.argv.length > 2 && !check) throw new TypeError('Usage: build-narrative-template.mjs [--check]');
  const candidate = await buildNarrativeBundle();
  const proof = createNarrativeAuthorProof();
  if (check) {
    if (!fs.existsSync(output) || !candidate.equals(fs.readFileSync(output))) {
      throw new Error('Narrative template bundle is stale: run npm run build:narrative-template');
    }
    if (!fs.existsSync(proofOutput) || !proof.equals(fs.readFileSync(proofOutput))) {
      throw new Error('Narrative template asset proof is stale: run npm run build:narrative-template');
    }
  } else {
    fs.writeFileSync(output, candidate);
    fs.writeFileSync(proofOutput, proof);
  }
  process.stdout.write(`Narrative template ${check ? 'verified' : 'built'}: ${candidate.length} bytes\n`);
}
