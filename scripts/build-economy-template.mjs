import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'packages/studio/catalog/templates/narrative-economy/assets/ludory-economy.js');

export async function buildEconomyBundle() {
  const result = await build({
    stdin: { contents: [
      "export { defineGame } from '@ludory/core';",
      "export { defineEconomy } from '@ludory/economy';",
      "export { defineNarrativeGraph, defineNarrativeCatalog, createNarrativeState } from '@ludory/narrative';",
      "export { definePremiumManifest, verifyFreeNarrativePaths, createEconomyRuntime, createEconomyPanel } from '@ludory/runtime-economy';",
      "export { createNarrativeRenderer, createNarrativeRuntimeUpdate } from '@ludory/runtime-narrative';",
      "export { createRuntimeHost, createBrowserEnvironment, createBrowserStorage } from '@ludory/runtime';",
      "export { createYandexEconomyStorage, createYandexPlayerStorage, createYandexPurchases, createYandexAds } from '@ludory/connect-yandex';",
      "export { createVkEconomyStorage, createVkStorage, createVkAds } from '@ludory/connect-vk';",
    ].join('\n'), resolveDir: root, sourcefile: 'economy-template-exports.js' },
    bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], minify: true,
    legalComments: 'none', logLevel: 'silent', absWorkingDir: root, outfile: output, write: false,
  });
  if (result.errors.length || result.outputFiles.length !== 1) throw new TypeError('Economy template bundle failed');
  return Buffer.from(result.outputFiles[0].contents);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.length === 3 && process.argv[2] === '--check';
  if (process.argv.length > 2 && !check) throw new TypeError('Usage: build-economy-template.mjs [--check]');
  const bytes = await buildEconomyBundle();
  if (check) {
    if (!fs.existsSync(output) || !bytes.equals(fs.readFileSync(output))) {
      throw new Error('Economy template bundle is stale: npm run build:economy-template');
    }
  } else {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes);
  }
  process.stdout.write(`Economy template ${check ? 'verified' : 'built'}: ${bytes.length} bytes\n`);
}
