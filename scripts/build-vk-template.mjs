import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const templateDir = fileURLToPath(new URL('../packages/studio/catalog/templates/vk-runtime/', import.meta.url));

async function bundle(contents, sourcefile) {
  const compilation = await build({
    stdin: { contents, sourcefile, resolveDir: root },
    bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], minify: true,
    legalComments: 'none', logLevel: 'silent', absWorkingDir: root, write: false,
  });
  if (compilation.errors.length || compilation.outputFiles.length !== 1) {
    throw new Error(`VK template ${sourcefile} was not bundled`);
  }
  return Buffer.from(compilation.outputFiles[0].contents);
}

/** Two isolated ESM entrypoints; only the VK template receives the official Bridge. */
export async function buildVkTemplateBundles() {
  const [ludory, bridge] = await Promise.all([
    bundle([
      "export { createRuntimeHost, createBrowserEnvironment, createBrowserAudio } from '@ludory/runtime';",
      "export { createVkConnector, createVkLifecycle, createVkStorage, createVkAds } from '@ludory/connect-vk';",
    ].join('\n'), 'vk-ludory-exports.js'),
    bundle("export { default } from '@vkontakte/vk-bridge';", 'vk-official-bridge.js'),
  ]);
  return { ludory, bridge };
}

export async function verifyVkTemplateBundles(candidate) {
  if (!candidate || !Buffer.isBuffer(candidate.ludory) || !Buffer.isBuffer(candidate.bridge)) {
    throw new TypeError('candidate must include two Buffer bundles');
  }
  const expected = await buildVkTemplateBundles();
  if (!candidate.ludory.equals(expected.ludory) || !candidate.bridge.equals(expected.bridge)) {
    throw new Error('VK template bundle is stale: rebuild both local assets');
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.length === 3 && process.argv[2] === '--check';
  if (process.argv.length > 2 && !check) throw new TypeError('Usage: build-vk-template.mjs [--check]');
  const bundles = await buildVkTemplateBundles();
  const files = [
    ['assets/ludory-vk.js', bundles.ludory],
    ['assets/vk-bridge.js', bundles.bridge],
    ['licenses/vk-bridge.txt', fs.readFileSync(path.join(root, 'node_modules/@vkontakte/vk-bridge/LICENSE'))],
    ['licenses/swc-helpers.txt', fs.readFileSync(path.join(root, 'node_modules/@swc/helpers/LICENSE'))],
  ];
  if (check) {
    for (const [name, contents] of files) {
      const filename = path.join(templateDir, name);
      if (!fs.existsSync(filename) || !fs.readFileSync(filename).equals(contents)) {
        throw new Error(`VK template bundle is stale or missing: ${name}`);
      }
    }
  } else {
    for (const [name, contents] of files) {
      const filename = path.join(templateDir, name);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, contents);
    }
  }
  process.stdout.write(`VK template ${check ? 'verified' : 'built'}: ${bundles.ludory.length}+${bundles.bridge.length} bytes\n`);
}
