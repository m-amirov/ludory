import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { verifyStudioOrigin } from '@ludory/studio-trust';
import { planNarrativePlatformExport, materializeNarrativePlatformProjects } from '@ludory/studio/narrative-platform-export';
import { compileNarrativePlatformEntrypoint } from '../src/narrative-platform-compile.mjs';
import { buildYandexCandidate } from '../../../scripts/build-yandex-candidate.mjs';
import { buildVkCandidate } from '../../../scripts/build-vk-candidate.mjs';
import { inspectYandexArchive, inspectVkArchive } from '@ludory/release';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f5b2-compile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'author');
  fs.mkdirSync(project);
  const create = planCreate(project, { id: 'f5b2-custom', version: '2.3.4', title: 'Авторский маяк',
    lang: 'ru', template: 'narrative-interactive', profile: 'narrative-game',
    targets: ['yandex-games', 'vk-games'] });
  assert.equal(create.status, 'READY');
  assert.equal(applyCreatePlan(create).status, 'APPLIED');
  const story = path.join(project, 'src/story.js');
  fs.writeFileSync(story, fs.readFileSync(story, 'utf8').replace('Маяк мигнул трижды.', 'F5B2_CUSTOM_STORY_214'));
  const html = path.join(project, 'index.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('Вечер у маяка · Ludory', 'F5B2_CUSTOM_TITLE_214'));
  return { dir, project };
}

test('F5b2 compiles actual authored story and HTML into distinct platform SDK entrypoints', t => {
  const { project } = fixture(t);
  for (const target of ['yandex-games', 'vk-games']) {
    const compiled = compileNarrativePlatformEntrypoint({ sourceRoot: project, target });
    const js = compiled.entryBytes.toString('utf8');
    assert.match(js, /F5B2_CUSTOM_STORY_214/);
    assert.match(compiled.htmlBytes.toString('utf8'), /F5B2_CUSTOM_TITLE_214/);
    assert.match(compiled.htmlBytes.toString('utf8'), /@media/);
    assert.match(compiled.authorEntrySha256, /^[a-f0-9]{64}$/);
    assert.match(compiled.authorStorySha256, /^[a-f0-9]{64}$/);
    assert.ok(js.includes(target === 'yandex-games' ? '../assets/ludory-yandex.js' : '../assets/ludory-vk.js'));
    if (target === 'yandex-games') assert.doesNotMatch(js, /vk-bridge\.js|createVkConnector/);
    else assert.doesNotMatch(js, /ludory-yandex\.js|YaGames/);
  }
});

test('F5b2 materializes separate trusted Studio SDK projects without editing author files', t => {
  const { project } = fixture(t);
  const before = fs.readFileSync(path.join(project, 'src/story.js'));
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  const result = materializeNarrativePlatformProjects(plan);
  assert.equal(result.status, 'DERIVED_LOCAL', result.reasonCode);
  try {
    for (const [name, target] of [['yandex', 'yandex-games'], ['vk', 'vk-games']]) {
      const item = result.projects[name];
      assert.equal(verifyStudioOrigin(item.root).ok, true);
      const manifest = JSON.parse(fs.readFileSync(path.join(item.root, 'ludory.project.json')));
      assert.equal(manifest.id, 'f5b2-custom');
      assert.equal(manifest.version, '2.3.4');
      assert.deepEqual(manifest.title, { ru: 'Авторский маяк' });
      assert.deepEqual(manifest.targets, [target]);
      assert.match(fs.readFileSync(path.join(item.root, 'src/main.js'), 'utf8'), /F5B2_CUSTOM_STORY_214/);
      assert.match(fs.readFileSync(path.join(item.root, 'index.html'), 'utf8'), /F5B2_CUSTOM_TITLE_214/);
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
    }
  } finally { result.cleanup(); }
  assert.deepEqual(fs.readFileSync(path.join(project, 'src/story.js')), before);
});

test('F5b2 refuses unsupported author entry or remote imports', t => {
  const { project } = fixture(t);
  const entry = path.join(project, 'src/main.js');
  const original = fs.readFileSync(entry, 'utf8');
  fs.writeFileSync(entry, original.replace('export async function startNarrative', 'async function startNarrative'));
  assert.throws(() => compileNarrativePlatformEntrypoint({ sourceRoot: project, target: 'vk-games' }), /startNarrative|export|ENTRY_CONTRACT/i);
  fs.writeFileSync(entry, original);
  fs.appendFileSync(path.join(project, 'src/story.js'), "\nimport 'https://example.invalid/evil.js';\n");
  assert.throws(() => compileNarrativePlatformEntrypoint({ sourceRoot: project, target: 'yandex-games' }), /remote|import|URL|forbidden/i);
});

test('F5b2 blocks authored HTML resources that cannot be safely packaged for both SDKs', async t => {
  const cases = [
    { name: 'protocol-relative CSS import', html: '<style>@import url(//example.invalid/leak.css);</style>' },
    { name: 'protocol-relative CSS image', html: '<style>body{background:url(//example.invalid/leak.png)}</style>' },
    { name: 'CSS image-set remote string', html: '<style>body{background:image-set("//example.invalid/leak.png" 1x)}</style>' },
    { name: 'escaped CSS url function', html: '<style>body{background:u\\72l(//example.invalid/leak.png)}</style>' },
    { name: 'inline style remote image', html: '<div style="background:url(//example.invalid/leak.png)"></div>' },
    { name: 'mixed local and remote srcset',
      html: '<img srcset="assets/lighthouse.svg 1x, //example.invalid/leak.png 2x">',
      files: { 'assets/lighthouse.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } },
    { name: 'remote video poster', html: '<video poster="//example.invalid/leak.png"></video>' },
    { name: 'unpackaged local stylesheet', html: '<link rel="stylesheet" href="src/custom.css">',
      files: { 'src/custom.css': 'body { color: red; }' } },
    { name: 'unpackaged local image', html: '<img src="src/photo.png">',
      files: { 'src/photo.png': 'not-an-image' } },
  ];
  for (const item of cases) {
    await t.test(item.name, tt => {
      const { project } = fixture(tt);
      for (const [relative, bytes] of Object.entries(item.files ?? {})) {
        const filename = path.join(project, relative);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, bytes);
      }
      const filename = path.join(project, 'index.html');
      const original = fs.readFileSync(filename, 'utf8');
      fs.writeFileSync(filename, original.replace('</head>', `${item.html}\n</head>`));
      const plan = planNarrativePlatformExport(project);
      assert.equal(plan.status, 'READY_TO_DERIVE', `${item.name}: ${plan.reasonCode}`);
      for (const target of ['yandex-games', 'vk-games']) {
        assert.throws(() => compileNarrativePlatformEntrypoint({ sourceRoot: project, target }),
          /F5B_(?:UNSUPPORTED_AUTHOR_HTML_RESOURCE|REMOTE_OR_ACTIVE_HTML_FORBIDDEN)/, `${item.name}: ${target}`);
      }
      const derived = materializeNarrativePlatformProjects(plan);
      try {
        assert.equal(derived.status, 'BLOCKED', item.name);
        assert.match(derived.reasonCode, /F5B_(?:UNSUPPORTED_AUTHOR_HTML_RESOURCE|REMOTE_OR_ACTIVE_HTML_FORBIDDEN)/);
        assert.equal(derived.releaseReady, false);
        assert.equal(derived.publicationAllowed, false);
      } finally { derived.cleanup?.(); }
    });
  }
});

test('F5b2 keeps supported local HTML media in each derived project', t => {
  const { project } = fixture(t);
  const image = path.join(project, 'assets', 'author-photo.svg');
  fs.writeFileSync(image, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
  const filename = path.join(project, 'index.html');
  fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace('</body>',
    '<img src="assets/author-photo.svg" alt="Авторское фото">\n</body>'));
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE', plan.reasonCode);
  const derived = materializeNarrativePlatformProjects(plan);
  assert.equal(derived.status, 'DERIVED_LOCAL', derived.reasonCode);
  try {
    for (const item of Object.values(derived.projects)) {
      assert.equal(fs.readFileSync(path.join(item.root, 'assets/author-photo.svg')).equals(fs.readFileSync(image)), true);
      assert.match(fs.readFileSync(path.join(item.root, 'index.html'), 'utf8'), /assets\/author-photo\.svg/);
    }
  } finally { derived.cleanup(); }
});

test('F5b2 derived manifests preserve all authored title locales', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f5b2-titles-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'author');
  fs.mkdirSync(project);
  const titles = { ru: 'Маяк', en: 'Lighthouse' };
  const create = planCreate(project, { id: 'multi-title', title: titles, lang: 'ru', version: '1.0.0',
    template: 'narrative-interactive', profile: 'narrative-game', targets: ['yandex-games', 'vk-games'] });
  assert.equal(create.status, 'READY');
  assert.equal(applyCreatePlan(create).status, 'APPLIED');
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  const derived = materializeNarrativePlatformProjects(plan);
  assert.equal(derived.status, 'DERIVED_LOCAL', derived.reasonCode);
  try {
    for (const key of ['yandex', 'vk']) {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(derived.projects[key].root, 'ludory.project.json'))).title, titles);
    }
  } finally { derived.cleanup(); }
});

test('F5b2 rejects an author JavaScript import that escapes the pinned project', t => {
  const { dir, project } = fixture(t);
  fs.writeFileSync(path.join(dir, 'foreign.js'), 'export const foreign = true;\n');
  const story = path.join(project, 'src/story.js');
  fs.appendFileSync(story, "\nimport { foreign } from '../../foreign.js';\nconsole.log(foreign);\n");
  assert.throws(() => compileNarrativePlatformEntrypoint({ sourceRoot: project, target: 'vk-games' }),
    /FOREIGN|IMPORT|outside/i);
});

test('F5b2 target projects pass the unchanged SDK candidate builders and Release ZIP inspectors', async t => {
  const { dir, project } = fixture(t);
  const plan = planNarrativePlatformExport(project);
  const derived = materializeNarrativePlatformProjects(plan);
  assert.equal(derived.status, 'DERIVED_LOCAL', derived.reasonCode);
  try {
    const yandex = await buildYandexCandidate({ projectDir: derived.projects.yandex.root,
      outputZip: path.join(dir, 'yandex.zip') });
    const vk = await buildVkCandidate({ projectDir: derived.projects.vk.root,
      outputZip: path.join(dir, 'vk.zip') });
    assert.equal(inspectYandexArchive(yandex.archivePath).sha256, yandex.sha256);
    assert.equal(inspectVkArchive(vk.archivePath).sha256, vk.sha256);
  } finally { derived.cleanup(); }
});

test('F5b2 rejects an author entry that ignores platform hooks while retaining the export name', t => {
  const { project } = fixture(t);
  const filename = path.join(project, 'src/main.js');
  fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8')
    .replace('startNarrative({ platform = null } = {})', 'startNarrative()')
    .replace('  let integration;', '  const platform = null;\n  let integration;'));
  assert.throws(() => compileNarrativePlatformEntrypoint({ sourceRoot: project, target: 'yandex-games' }),
    /ENTRY_CONTRACT|platform|trusted/i);
});

test('F5b2 rejects a computed dynamic import hidden behind a runtime value', t => {
  const { project } = fixture(t);
  const story = path.join(project, 'src/story.js');
  const original = fs.readFileSync(story, 'utf8');
  fs.appendFileSync(story,
    '\nconst runtimeModule = globalThis.remoteModuleUrl;\nif (runtimeModule) import(runtimeModule);\n');
  assert.throws(() => compileNarrativePlatformEntrypoint({ sourceRoot: project, target: 'vk-games' }),
    /DYNAMIC|IMPORT|remote/i);
  fs.writeFileSync(story, `${original}\nif (globalThis.loadExtra) import(\`./${'${'}globalThis.loadExtra}.js\`);\n`);
  assert.throws(() => compileNarrativePlatformEntrypoint({ sourceRoot: project, target: 'yandex-games' }),
    /DYNAMIC|IMPORT|remote/i);
});
