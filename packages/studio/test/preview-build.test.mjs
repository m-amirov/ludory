import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newStudioAiProject, nativeProject } from '../../ai/test/helpers/project.mjs';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { planPreviewBuild, buildPreview } from '../src/preview-build.mjs';

test('a fresh Studio game builds current bytes without writing into the project', t => {
  const project = newStudioAiProject(t, { git: false });
  const before = fs.readdirSync(project).sort();
  const plan = planPreviewBuild(project);
  assert.equal(plan.status, 'READY', plan.reasonCode);
  assert.deepEqual(fs.readdirSync(project).sort(), before);

  const first = buildPreview(plan);
  assert.equal(first.status, 'BUILT', first.reasonCode);
  t.after(() => first.cleanup());
  const original = fs.readFileSync(path.join(first.root, 'src', 'main.js'), 'utf8');
  assert.equal(original, '// Original user code\n');
  assert.equal(fs.existsSync(path.join(first.root, 'ludory.studio.json')), false);
  assert.equal(fs.existsSync(path.join(first.root, '.ludory')), false);
  assert.deepEqual(fs.readdirSync(project).sort(), before);

  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'document.title = "fresh";\n');
  const stale = buildPreview(plan);
  assert.equal(stale.status, 'BLOCKED');
  assert.equal(stale.reasonCode, 'PREVIEW_SOURCE_CHANGED');

  const updated = planPreviewBuild(project);
  assert.equal(updated.status, 'READY', updated.reasonCode);
  const second = buildPreview(updated);
  assert.equal(second.status, 'BUILT', second.reasonCode);
  t.after(() => second.cleanup());
  assert.equal(fs.readFileSync(path.join(second.root, 'src', 'main.js'), 'utf8'), 'document.title = "fresh";\n');
  assert.notEqual(first.buildSha256, second.buildSha256);
});

test('the same source makes the same build SHA in independent disposable output directories', t => {
  const project = newStudioAiProject(t, { git: false });
  const plan = planPreviewBuild(project);
  const a = buildPreview(plan), b = buildPreview(plan);
  assert.equal(a.status, 'BUILT', a.reasonCode);
  assert.equal(b.status, 'BUILT', b.reasonCode);
  t.after(() => { a.cleanup(); b.cleanup(); });
  assert.equal(a.buildSha256, b.buildSha256);
  assert.notEqual(a.root, b.root);
});

test('missing local scripts or artwork block preview instead of making broken output', t => {
  const project = newStudioAiProject(t, { git: false });
  fs.writeFileSync(path.join(project, 'src', 'main.js'), "import './missing.js';\n");
  assert.equal(planPreviewBuild(project).status, 'BLOCKED');
  fs.writeFileSync(path.join(project, 'src', 'main.js'), '// valid\n');
  fs.appendFileSync(path.join(project, 'index.html'), '<img src="assets/missing.svg">');
  const blocked = planPreviewBuild(project);
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.reasonCode, 'PREVIEW_ASSET_MISSING');
});

test('symlinked public assets, forged games and paths outside the distribution are excluded', t => {
  const project = newStudioAiProject(t, { git: false });
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-preview-secret-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.writeFileSync(path.join(external, 'secret.svg'), '<svg>private</svg>');
  fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
  fs.symlinkSync(path.join(external, 'secret.svg'), path.join(project, 'assets', 'secret.svg'));
  assert.equal(planPreviewBuild(project).status, 'BLOCKED');
  fs.unlinkSync(path.join(project, 'assets', 'secret.svg'));
  fs.writeFileSync(path.join(project, '.env'), 'PRIVATE_KEY=secret');
  fs.writeFileSync(path.join(project, 'src', 'source.map'), 'private');
  fs.writeFileSync(path.join(project, 'assets', 'visible.svg'), '<svg/>');
  const plan = planPreviewBuild(project);
  assert.equal(plan.status, 'READY', plan.reasonCode);
  const built = buildPreview(plan);
  assert.equal(built.status, 'BUILT', built.reasonCode);
  t.after(() => built.cleanup());
  assert.equal(fs.existsSync(path.join(built.root, '.env')), false);
  assert.equal(fs.existsSync(path.join(built.root, 'src', 'source.map')), false);
  assert.equal(fs.readFileSync(path.join(built.root, 'assets', 'visible.svg'), 'utf8'), '<svg/>');
  assert.equal(planPreviewBuild(nativeProject(t)).status, 'BLOCKED');
});

test('static imports on the same line, fetch, art maps, srcset and inline CSS cannot hide missing files', t => {
  const project = newStudioAiProject(t, { git: false });
  const module = path.join(project, 'src', 'main.js');
  const html = path.join(project, 'index.html');
  const original = fs.readFileSync(html, 'utf8');
  for (const source of [
    "const ready = true; import './missing.js';",
    "fetch('./assets/missing.json');",
    "const assets = { art: './assets/missing.svg' };",
  ]) {
    fs.writeFileSync(module, source);
    assert.equal(planPreviewBuild(project).status, 'BLOCKED', source);
  }
  fs.writeFileSync(module, '// no missing imports\n');
  for (const fragment of [
    '<img srcset="assets/missing.png 1x, assets/another.png 2x">',
    '<style>@import "assets/missing.css";</style>',
  ]) {
    fs.writeFileSync(html, `${original}\n${fragment}\n`);
    assert.equal(planPreviewBuild(project).status, 'BLOCKED', fragment);
  }
});

test('a missing image declared by the native narrative asset manifest blocks staging', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-preview-narrative-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const planned = planCreate(project, { id: 'preview-narrative', title: 'Narrative', lang: 'ru',
    profile: 'narrative-game', template: 'narrative-interactive', targets: ['yandex-games'] });
  assert.equal(planned.status, 'READY');
  assert.equal(applyCreatePlan(planned).status, 'APPLIED');
  fs.unlinkSync(path.join(project, 'assets', 'lighthouse.svg'));
  const result = planPreviewBuild(project);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reasonCode, 'PREVIEW_ASSET_MISSING');
});

test('a file changed after another file was read invalidates the entire snapshot', t => {
  const project = newStudioAiProject(t, { git: false });
  const planned = planPreviewBuild(project);
  assert.equal(planned.status, 'READY');
  const oldOpen = fs.openSync;
  const oldRead = fs.readFileSync;
  let targetFd = null, mutated = false;
  fs.openSync = function (name, ...rest) {
    const fd = oldOpen.call(this, name, ...rest);
    if (name === path.join(project, 'src', 'main.js')) targetFd = fd;
    return fd;
  };
  fs.readFileSync = function (descriptor, ...rest) {
    if (descriptor === targetFd && !mutated) {
      fs.writeFileSync(path.join(project, 'index.html'), '<h1>changed during snapshot</h1>');
      mutated = true;
    }
    return oldRead.call(this, descriptor, ...rest);
  };
  let result;
  try { result = buildPreview(planned); }
  finally { fs.openSync = oldOpen; fs.readFileSync = oldRead; }
  assert.equal(mutated, true);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reasonCode, 'PREVIEW_SOURCE_CHANGED');
});
