import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const byteExactTemplateFiles = [
  'packages/studio/catalog/templates/runtime-basic/assets/ludory-runtime.js',
  'packages/studio/catalog/templates/narrative-interactive/assets/ludory-narrative.js',
  'packages/studio/catalog/templates/narrative-economy/assets/ludory-economy.js',
  'packages/studio/catalog/templates/yandex-runtime/assets/ludory-yandex.js',
  'packages/studio/catalog/templates/vk-runtime/assets/ludory-vk.js',
  'packages/studio/catalog/templates/vk-runtime/assets/vk-bridge.js',
  'packages/studio/catalog/templates/vk-runtime/licenses/vk-bridge.txt',
  'packages/studio/catalog/templates/vk-runtime/licenses/swc-helpers.txt',
];

test('committed byte-exact template files retain LF bytes on Windows', () => {
  const output = execFileSync('git', ['check-attr', 'eol', '--', ...byteExactTemplateFiles], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const actual = new Map(output.trim().split('\n').map(line => {
    const match = /^(.*): eol: (.*)$/.exec(line);
    assert.ok(match, `Unexpected git check-attr output: ${line}`);
    return [match[1], match[2]];
  }));
  for (const file of byteExactTemplateFiles) {
    assert.equal(actual.get(file), 'lf', `${file} must not be converted to CRLF in Windows checkouts`);
  }
});
