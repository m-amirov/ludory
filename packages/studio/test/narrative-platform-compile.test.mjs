import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { verifyStudioOrigin } from '@ludory/studio-trust';
import { planNarrativePlatformExport, materializeNarrativePlatformProjects } from '@ludory/studio/narrative-platform-export';
import { compileNarrativePlatformEntrypoint } from '../src/narrative-platform-compile.mjs';
import { buildYandexCandidate } from '../../../scripts/build-yandex-candidate.mjs';
import { buildVkCandidate } from '../../../scripts/build-vk-candidate.mjs';
import { inspectYandexArchive, inspectVkArchive } from '@ludory/release';

function refreshStoryProof(project) {
  const filename = path.join(project, 'narrative-assets.json');
  const proof = JSON.parse(fs.readFileSync(filename, 'utf8'));
  proof.storySha256 = createHash('sha256').update(fs.readFileSync(path.join(project, 'src/story.js'))).digest('hex');
  fs.writeFileSync(filename, `${JSON.stringify(proof, null, 2)}\n`);
}

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
  refreshStoryProof(project);
  const html = path.join(project, 'index.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('Интерактивная история · Ludory', 'F5B2_CUSTOM_TITLE_214'));
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

test('F5b2 compiles legacy authored stories without optional presentationData export', t => {
  const { project } = fixture(t);
  const filename = path.join(project, 'src/story.js');
  const current = fs.readFileSync(filename, 'utf8');
  const legacy = current.replace(/^export const presentationData = undefined;?\n/m, '');
  assert.notEqual(legacy, current, 'fixture must remove the optional export');
  fs.writeFileSync(filename, legacy);
  refreshStoryProof(project);
  for (const target of ['yandex-games', 'vk-games']) {
    const output = compileNarrativePlatformEntrypoint({ sourceRoot: project, target });
    assert.match(output.entryBytes.toString('utf8'), /F5B2_CUSTOM_STORY_214/);
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
      html: '<img srcset="assets/author-test-image.svg 1x, //example.invalid/leak.png 2x">',
      files: { 'assets/author-test-image.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } },
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

test('F5b2 packages an authored CSS skin and local TTF dependencies for both targets', t => {
  const { project } = fixture(t);
  const ui = path.join(project, 'src', 'ui');
  const fonts = path.join(project, 'assets', 'fonts');
  fs.mkdirSync(ui, { recursive: true });
  fs.mkdirSync(fonts, { recursive: true });
  const cormorant = Buffer.from('original-cormorant-ttf-bytes');
  const manrope = Buffer.from('original-manrope-ttf-bytes');
  fs.writeFileSync(path.join(fonts, 'CormorantGaramond[wght].ttf'), cormorant);
  fs.writeFileSync(path.join(fonts, 'Manrope[wght].ttf'), manrope);
  fs.writeFileSync(path.join(ui, 'original-game.css'), `@font-face {
  font-family: 'Cinematic Cormorant';
  src: url('../../assets/fonts/CormorantGaramond[wght].ttf') format('truetype');
}
@font-face {
  font-family: 'Cinematic Manrope';
  src: url('../../assets/fonts/Manrope[wght].ttf') format('truetype');
}
body { font-family: 'Cinematic Manrope'; }
`);
  fs.writeFileSync(path.join(ui, 'original-game-ui.js'),
    "export const theme = new URL('./original-game.css', import.meta.url);\n");
  const story = path.join(project, 'src', 'story.js');
  fs.appendFileSync(story, "\nimport './ui/original-game-ui.js';\n");
  refreshStoryProof(project);

  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE', plan.reasonCode);
  const derived = materializeNarrativePlatformProjects(plan);
  assert.equal(derived.status, 'DERIVED_LOCAL', derived.reasonCode);
  try {
    for (const name of ['yandex', 'vk']) {
      const root = derived.projects[name].root;
      const css = path.join(root, 'assets', 'ui', 'original-game.css');
      assert.equal(fs.readFileSync(css, 'utf8').includes('../fonts/CormorantGaramond-wght.ttf'), true);
      assert.equal(fs.readFileSync(css, 'utf8').includes('../fonts/Manrope-wght.ttf'), true);
      assert.equal(fs.readFileSync(path.join(root, 'assets', 'fonts', 'CormorantGaramond-wght.ttf')).equals(cormorant), true);
      assert.equal(fs.readFileSync(path.join(root, 'assets', 'fonts', 'Manrope-wght.ttf')).equals(manrope), true);
      assert.match(fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8'),
        /\.\.\/assets\/ui\/original-game\.css/);
      assert.equal(fs.existsSync(path.join(root, 'assets', 'fonts', 'CormorantGaramond[wght].ttf')), false);
      assert.equal(fs.existsSync(path.join(root, 'assets', 'fonts', 'Manrope[wght].ttf')), false);
    }
  } finally { derived.cleanup(); }
});

test('F5b2 rebases identical module-relative URLs according to each source module', t => {
  const { project } = fixture(t);
  const directories = ['a', 'b'].map(name => path.join(project, 'src', 'ui', name));
  for (const directory of directories) fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(project, 'assets', 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(project, 'assets', 'fonts', 'Manrope[wght].ttf'), 'manrope-query-font');
  fs.writeFileSync(path.join(directories[0], 'theme.css'), 'body { color: red; }\n');
  fs.writeFileSync(path.join(directories[1], 'theme.css'), 'body { color: blue; }\n');
  fs.writeFileSync(path.join(directories[0], 'theme.js'),
    "export const themeA = new URL('./theme.css', import.meta.url);\n");
  fs.writeFileSync(path.join(directories[1], 'theme.js'),
    "export const themeB = new URL('./theme.css', import.meta.url);\n");
  fs.writeFileSync(path.join(directories[0], 'query.js'),
    "export const queriedTheme = new URL('./theme.css?v=1#theme', import.meta.url);\n" +
    "export const queriedFont = new URL('../../../assets/fonts/Manrope%5Bwght%5D.ttf?v=1#font', import.meta.url);\n");
  fs.writeFileSync(path.join(directories[0], 'dynamic.js'),
    "export const dynamicTheme = new URL(`./${'theme.css'}`, import.meta.url);\n");
  fs.appendFileSync(path.join(project, 'src', 'story.js'), `\nimport { themeA } from './ui/a/theme.js';
import { themeB } from './ui/b/theme.js';
import { queriedTheme, queriedFont } from './ui/a/query.js';
import { dynamicTheme } from './ui/a/dynamic.js';
export const moduleThemes = [themeA.href, themeB.href, queriedTheme.href, queriedFont.href, dynamicTheme.href];\n`);
  refreshStoryProof(project);

  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE', plan.reasonCode);
  const derived = materializeNarrativePlatformProjects(plan);
  assert.equal(derived.status, 'DERIVED_LOCAL', derived.reasonCode);
  try {
    for (const item of Object.values(derived.projects)) {
      const js = fs.readFileSync(path.join(item.root, 'src', 'main.js'), 'utf8');
      assert.match(js, /\.\.\/assets\/ui\/a\/theme\.css/);
      assert.match(js, /\.\.\/assets\/ui\/b\/theme\.css/);
      assert.match(js, /\.\.\/assets\/ui\/a\/theme\.css\?v=1#theme/);
      assert.match(js, /\.\.\/assets\/fonts\/Manrope-wght\.ttf\?v=1#font/);
      assert.match(js, /`\.\.\/assets\/ui\/a\/\$\{["']theme\.css["']\}`/);
      assert.equal(js.match(/\.\.\/assets\/ui\/a\/theme\.css/g)?.length, 2);
      assert.equal(js.match(/\.\.\/assets\/ui\/b\/theme\.css/g)?.length, 1);
    }
  } finally { derived.cleanup(); }
});

test('F5b2 resolves percent-encoded and root-relative CSS dependencies without weakening traversal checks', t => {
  const { project } = fixture(t);
  const ui = path.join(project, 'src', 'ui');
  const fonts = path.join(project, 'assets', 'fonts');
  fs.mkdirSync(ui, { recursive: true });
  fs.mkdirSync(fonts, { recursive: true });
  fs.writeFileSync(path.join(fonts, 'CormorantGaramond[wght].ttf'), 'cormorant');
  fs.writeFileSync(path.join(fonts, 'Manrope[wght].ttf'), 'manrope');
  fs.writeFileSync(path.join(ui, 'theme.css'), `@font-face {
  font-family: 'Cinematic Cormorant';
  src: url('../../assets/fonts/CormorantGaramond%5Bwght%5D.ttf');
}
@font-face {
  font-family: 'Cinematic Manrope';
  src: url('/assets/fonts/Manrope%5Bwght%5D.ttf');
}
@import './base.css';
`);
  fs.writeFileSync(path.join(ui, 'base.css'), '.theme-base { color: inherit; }\n');
  fs.writeFileSync(path.join(ui, 'theme.js'),
    "export const theme = new URL('./theme.css', import.meta.url);\n");
  fs.appendFileSync(path.join(project, 'src', 'story.js'), "\nimport './ui/theme.js';\n");
  refreshStoryProof(project);

  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE', plan.reasonCode);
  const derived = materializeNarrativePlatformProjects(plan);
  assert.equal(derived.status, 'DERIVED_LOCAL', derived.reasonCode);
  try {
    for (const item of Object.values(derived.projects)) {
      const css = fs.readFileSync(path.join(item.root, 'assets', 'ui', 'theme.css'), 'utf8');
      assert.match(css, /\.\.\/fonts\/CormorantGaramond-wght\.ttf/);
      assert.match(css, /\.\.\/fonts\/Manrope-wght\.ttf/);
      assert.match(css, /@import ['"]base\.css['"]/);
      assert.doesNotMatch(css, /%5B|%5D|\/assets\/fonts/);
    }
  } finally { derived.cleanup(); }

  fs.writeFileSync(path.join(project, 'assets', 'escape.ttf'), 'escape');
  fs.writeFileSync(path.join(ui, 'theme.css'), 'body { background: url(/assets/%2e%2e/assets/escape.ttf); }\n');
  refreshStoryProof(project);
  const unsafePlan = planNarrativePlatformExport(project);
  assert.equal(unsafePlan.status, 'READY_TO_DERIVE', unsafePlan.reasonCode);
  const unsafe = materializeNarrativePlatformProjects(unsafePlan);
  assert.equal(unsafe.status, 'BLOCKED');
  assert.match(unsafe.reasonCode, /F5B_CSS_DEPENDENCY_UNPACKAGED|F5B_CSS_DEPENDENCY_UNSAFE/);
  unsafe.cleanup?.();
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
