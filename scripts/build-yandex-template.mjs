import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../packages/studio/catalog/templates/yandex-runtime/assets/ludory-yandex.js', import.meta.url));

/** Build a browser ESM export bridge, never downloading or embedding the platform SDK. */
export async function buildYandexTemplateBundle() {
  const compilation = await build({
    stdin: {
      contents: [
        "export { createRuntimeHost, createBrowserEnvironment, createBrowserAudio } from '@ludory/runtime';",
        "export { createYandexConnector, createYandexLifecycle, createYandexPlayerStorage, createYandexAds } from '@ludory/connect-yandex';",
      ].join('\n'),
      resolveDir: root, sourcefile: 'yandex-template-exports.js',
    },
    bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], minify: true,
    legalComments: 'none', logLevel: 'silent', absWorkingDir: root, outfile: output, write: false,
  });
  if (compilation.errors.length || compilation.outputFiles.length !== 1) {
    throw new Error('Yandex template bridge was not bundled');
  }
  return Buffer.from(compilation.outputFiles[0].contents);
}

export async function verifyYandexTemplateBundle(candidate) {
  if (!Buffer.isBuffer(candidate)) throw new TypeError('candidate must be a Buffer');
  const expected = await buildYandexTemplateBundle();
  if (!candidate.equals(expected)) throw new Error('Yandex template bundle is stale: rebuild the template');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.length === 3 && process.argv[2] === '--check';
  if (process.argv.length > 2 && !check) throw new TypeError('Usage: build-yandex-template.mjs [--check]');
  const bundle = await buildYandexTemplateBundle();
  if (check) {
    if (!fs.existsSync(output)) throw new Error('Yandex template bundle missing');
    await verifyYandexTemplateBundle(fs.readFileSync(output));
  } else {
    fs.writeFileSync(output, bundle);
  }
  process.stdout.write(`Yandex template ${check ? 'verified' : 'built'}: ${bundle.length} bytes\n`);
}
