import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL('../packages/runtime/src/index.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('../packages/studio/catalog/templates/runtime-basic/assets/ludory-runtime.js', import.meta.url)),
  bundle: true, platform: 'browser', format: 'esm', target: ['es2022'], minify: false,
  legalComments: 'none', logLevel: 'warning', absWorkingDir: root,
});
