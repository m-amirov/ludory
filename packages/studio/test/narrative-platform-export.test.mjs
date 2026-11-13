import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { unzipSync, zipSync } from 'fflate';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { planPreviewBuild } from '../src/preview-build.mjs';
import { planNarrativePlatformExport, materializeNarrativePlatformSource,
  buildNarrativePlatformCandidates, verifyNarrativePlatformCandidates } from '@ludory/studio/narrative-platform-export';
import { inspectYandexArchive, inspectVkArchive } from '@ludory/release';
import { F5B3_BROWSER_CASES, F5B3_ADVERSE_CASES, F5B3_STORY_PATH,
  validateF5b3Evidence, buildF5b3Evidence } from '../../runtime-narrative/test/browser/f5b3-evidence.mjs';
import { isF5b3DirectInvocation } from '../../runtime-narrative/test/browser/f5b3-runner-path.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function refreshStoryProof(project) {
  const filename = path.join(project, 'narrative-assets.json');
  const proof = JSON.parse(fs.readFileSync(filename, 'utf8'));
  proof.storySha256 = sha(fs.readFileSync(path.join(project, 'src/story.js')));
  fs.writeFileSync(filename, `${JSON.stringify(proof, null, 2)}\n`);
}

function newProject(t, { template = 'narrative-interactive', profile = 'narrative-game',
  targets = ['yandex-games', 'vk-games'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-f5b1-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'game');
  fs.mkdirSync(project);
  const plan = planCreate(project, { id: 'f5b-one-source', version: '0.1.0',
    title: 'F5b one source', lang: 'ru', template, profile, targets });
  assert.equal(plan.status, 'READY');
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  return { root, project };
}

test('F5b1 pins one trusted narrative source for both declared SDK targets without writing source or ZIP', t => {
  const { project } = newProject(t);
  const before = fs.readFileSync(path.join(project, 'src/story.js'));
  const preview = planPreviewBuild(project);
  assert.equal(preview.status, 'READY');
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  assert.equal(plan.mode, 'narrative-platform-export');
  assert.deepEqual(plan.targets, ['yandex-games', 'vk-games']);
  assert.deepEqual(plan.writes, []);
  assert.equal(plan.sourceDigest, preview.sourceDigest);
  assert.deepEqual(plan.files, preview.files);
  assert.match(plan.sourcePlanId, /^[a-f0-9-]{36}$/);
  assert.equal(fs.readFileSync(path.join(project, 'src/story.js')).equals(before), true);

  const pinned = materializeNarrativePlatformSource(plan);
  assert.equal(pinned.status, 'SOURCE_PINNED');
  assert.equal(pinned.sourceDigest, plan.sourceDigest);
  assert.deepEqual(pinned.targets, ['yandex-games', 'vk-games']);
  assert.equal(pinned.publicationAllowed, false);
  assert.equal(pinned.releaseReady, false);
  assert.equal(pinned.candidates, undefined);
  assert.ok(path.isAbsolute(pinned.root));
  assert.notEqual(pinned.root, project);
  for (const file of plan.files) {
    const bytes = fs.readFileSync(path.join(pinned.root, file.path));
    assert.equal(sha(bytes), file.sha256);
    assert.equal(bytes.length, file.size);
  }
  pinned.cleanup();
  assert.equal(fs.existsSync(pinned.root), false);
  pinned.cleanup(); // Repeated cleanup must not delete an unrelated path.
  assert.equal(fs.readFileSync(path.join(project, 'src/story.js')).equals(before), true);
});

test('F5b1 rejects single-target or non-narrative Studio projects before generating a plan', t => {
  for (const options of [
    { targets: ['yandex-games'] }, { targets: ['vk-games'] },
    { template: 'narrative-basic' },
    { template: 'yandex-runtime', profile: 'web-game', targets: ['yandex-games'] },
  ]) {
    const { project } = newProject(t, options);
    const result = planNarrativePlatformExport(project);
    assert.equal(result.status, 'BLOCKED', JSON.stringify(options));
    assert.equal(result.writes.length, 0);
    assert.ok(!result.sourcePlanId);
  }
});

test('F5b1 refuses copied, symlinked, or source-modified projects', t => {
  const { root, project } = newProject(t);
  const copy = path.join(root, 'copied');
  fs.cpSync(project, copy, { recursive: true });
  assert.equal(planNarrativePlatformExport(copy).status, 'BLOCKED');
  const alias = path.join(root, 'alias');
  fs.symlinkSync(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(planNarrativePlatformExport(alias).status, 'BLOCKED');

  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  fs.appendFileSync(path.join(project, 'src/story.js'), '\n// author changed the story after planning\n');
  refreshStoryProof(project);
  const stale = materializeNarrativePlatformSource(plan);
  assert.equal(stale.status, 'BLOCKED');
  assert.equal(stale.writes.length, 0);
  assert.match(stale.reasonCode, /CHANGED|STALE/);
});

test('F5b1 rejects constructed or modified export plans, even if their fields look plausible', t => {
  const { project } = newProject(t);
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  for (const forgery of [
    { ...plan },
    { ...plan, project: path.dirname(project) },
    { ...plan, sourceDigest: 'f'.repeat(64) },
    { ...plan, files: [] },
    { ...plan, targets: ['vk-games'] },
    { ...plan, mode: 'other' },
  ]) {
    const result = materializeNarrativePlatformSource(forgery);
    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(result.writes, []);
  }
  assert.equal(planNarrativePlatformExport(path.join(project, 'missing')).status, 'BLOCKED');
});

test('F5b1 authenticates the exact metadata bytes used for template/target admission', t => {
  const { project: nonInteractive } = newProject(t, { template: 'narrative-basic' });
  const { project: narrative } = newProject(t);
  const originalRead = fs.readFileSync;
  const substituted = ['ludory.studio.json', 'ludory.components.json', 'ludory.project.json']
    .map(name => originalRead.call(fs, path.join(narrative, name)));
  let injected = 0;
  // Simulate precisely the TOCTOU interleaving: origin trust checked the real
  // basic narrative receipt, but the subsequent metadata read sees interactive bytes.
  fs.readFileSync = function (...args) {
    const bytes = originalRead.apply(this, args);
    const stack = new Error().stack ?? '';
    if (stack.includes('at readRegular ') && stack.includes('at sourceIdentity ') &&
        stack.includes('narrative-platform-export.mjs')) {
      return substituted[injected++];
    }
    return bytes;
  };
  try {
    const result = planNarrativePlatformExport(nonInteractive);
    assert.equal(injected, 3, `the attack must reach metadata admission: ${JSON.stringify(result)}`);
    assert.equal(result.status, 'BLOCKED');
  } finally { fs.readFileSync = originalRead; }
});

test('F5b1 admits a physical Windows casing alias of a trusted source', t => {
  if (process.platform !== 'win32') return t.skip('NTFS alias semantics are Windows-only');
  const { project } = newProject(t);
  const spelling = project.toUpperCase();
  assert.equal(fs.statSync(spelling).ino, fs.statSync(project).ino);
  assert.equal(planNarrativePlatformExport(spelling).status, 'READY_TO_DERIVE');
});

function destinations(root) {
  return { yandexZip: path.join(root, 'yandex.zip'), vkZip: path.join(root, 'vk.zip'),
    yandexBuildReceipt: path.join(root, 'yandex.build.json'),
    vkBuildReceipt: path.join(root, 'vk.build.json'), exportReceipt: path.join(root, 'paired.export.json') };
}

test('F5b2 builds two source-linked local ZIPs and verifies the actual archive/member hashes', async t => {
  const { root, project } = newProject(t);
  const storyFile = path.join(project, 'src/story.js');
  const story = fs.readFileSync(storyFile, 'utf8').replace('Маяк мигнул трижды.', 'F5B2_CUSTOM_STORY_214');
  fs.writeFileSync(storyFile, story);
  refreshStoryProof(project);
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  const paths = destinations(root);
  const built = await buildNarrativePlatformCandidates(plan, paths);
  assert.equal(built.status, 'CANDIDATES_BUILT_LOCAL', built.reasonCode);
  assert.equal(built.sourceDigest, plan.sourceDigest);
  assert.equal(built.releaseReady, false);
  assert.equal(built.publicationAllowed, false);
  assert.equal(inspectYandexArchive(paths.yandexZip).sha256, built.candidates.yandex.sha256);
  assert.equal(inspectVkArchive(paths.vkZip).sha256, built.candidates.vk.sha256);
  for (const name of ['yandex', 'vk']) {
    const receipt = JSON.parse(fs.readFileSync(paths[`${name}BuildReceipt`]));
    assert.equal(receipt.sha256, built.candidates[name].sha256);
    assert.equal(receipt.files.some(file => file.path === 'src/main.js'), true);
  }
  const paired = JSON.parse(fs.readFileSync(paths.exportReceipt));
  assert.equal(paired.sourceDigest, plan.sourceDigest);
  assert.equal(paired.candidates.length, 2);
  assert.equal(paired.candidates[0].target, 'yandex-games');
  assert.equal(paired.candidates[1].target, 'vk-games');
  assert.equal((await verifyNarrativePlatformCandidates(paths)).status, 'BLOCKED',
    'standalone editable receipts are not an authenticated source identity');
  const verified = await verifyNarrativePlatformCandidates(paths, plan);
  assert.equal(verified.status, 'LOCAL_ARCHIVES_VERIFIED', verified.reasonCode);
  assert.equal(verified.sourceDigest, plan.sourceDigest);
  assert.equal(fs.readFileSync(storyFile, 'utf8'), story);
});

test('F5b2 uses verified q95 WebP derivatives without retaining PNGs or stale references', async t => {
  const { root, project } = newProject(t);
  const sourceImage = path.join(project, 'assets', 'portrait.png');
  const sourceBytes = await sharp({ create: { width: 4, height: 3, channels: 4,
    background: { r: 36, g: 18, b: 52, alpha: 0.75 } } }).png().toBuffer();
  fs.writeFileSync(sourceImage, sourceBytes);
  const proofFile = path.join(project, 'narrative-assets.json');
  const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
  proof.assets.portrait = { path: 'assets/portrait.png', sha256: sha(sourceBytes) };
  fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`);
  const storyFile = path.join(project, 'src/story.js');
  fs.writeFileSync(storyFile, fs.readFileSync(storyFile, 'utf8')
    .replace('./assets/lighthouse.svg', './assets/portrait.png'));
  refreshStoryProof(project);
  const sourceSha256 = sha(sourceBytes);
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE', plan.reasonCode);
  const paths = destinations(root);
  const built = await buildNarrativePlatformCandidates(plan, paths);
  assert.equal(built.status, 'CANDIDATES_BUILT_LOCAL', built.reasonCode);
  const paired = JSON.parse(fs.readFileSync(paths.exportReceipt));
  for (const [key, inspect] of [['yandex', inspectYandexArchive], ['vk', inspectVkArchive]]) {
    const derivations = paired.candidates.find(candidate => candidate.target ===
      (key === 'yandex' ? 'yandex-games' : 'vk-games')).assetDerivations;
    assert.equal(derivations.length, 1);
    assert.equal(derivations[0].sourcePath, 'assets/portrait.png');
    assert.equal(derivations[0].derivedPath, 'assets/portrait.webp');
    assert.equal(derivations[0].sourceSha256, sourceSha256);
    assert.equal(derivations[0].quality, 95);
    const entries = unzipSync(new Uint8Array(fs.readFileSync(paths[`${key}Zip`])));
    assert.equal(Object.hasOwn(entries, 'assets/portrait.png'), false);
    assert.equal(Object.hasOwn(entries, 'assets/portrait.webp'), true);
    const main = Buffer.from(entries['src/main.js']).toString('utf8');
    assert.match(main, /portrait\.webp/);
    assert.doesNotMatch(main, /portrait\.png/);
    assert.equal(inspect(paths[`${key}Zip`]).files.some(file => file.path === 'assets/portrait.png'), false);
  }
  assert.equal((await verifyNarrativePlatformCandidates(paths, plan)).status, 'LOCAL_ARCHIVES_VERIFIED');
  assert.equal(sha(fs.readFileSync(sourceImage)), sourceSha256);
  fs.appendFileSync(sourceImage, Buffer.from([0]));
  assert.equal((await verifyNarrativePlatformCandidates(paths, plan)).status, 'BLOCKED');
});

test('F5b2 binds optimized output to source bytes and rewrites duplicate CSS image basenames', async t => {
  const { root, project } = newProject(t);
  const first = await sharp({ create: { width: 5, height: 4, channels: 4,
    background: { r: 210, g: 80, b: 30, alpha: 1 } } }).png().toBuffer();
  const second = await sharp({ create: { width: 5, height: 4, channels: 4,
    background: { r: 30, g: 80, b: 210, alpha: 1 } } }).png().toBuffer();
  const dynamic = await sharp({ create: { width: 5, height: 4, channels: 4,
    background: { r: 120, g: 40, b: 180, alpha: 1 } } }).png().toBuffer();
  fs.mkdirSync(path.join(project, 'assets', 'first'), { recursive: true });
  fs.mkdirSync(path.join(project, 'assets', 'second'), { recursive: true });
  fs.mkdirSync(path.join(project, 'assets', 'portraits'), { recursive: true });
  fs.writeFileSync(path.join(project, 'assets', 'first', 'portrait.png'), first);
  fs.writeFileSync(path.join(project, 'assets', 'second', 'portrait.png'), second);
  fs.writeFileSync(path.join(project, 'assets', 'portraits', 'alice.png'), dynamic);
  fs.writeFileSync(path.join(project, 'assets', 'portrait.png.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>\n');
  fs.writeFileSync(path.join(project, 'assets', 'frame.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="first/portrait.png" /></svg>\n');
  fs.writeFileSync(path.join(project, 'assets', 'theme.css'),
    '.first{background-image:url(first/portrait.png)}.second{background-image:url(second/portrait.png)}' +
    '.svg{background-image:url(portrait.png.svg)}\n');
  const proofFile = path.join(project, 'narrative-assets.json');
  const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
  proof.assets.first_portrait = { path: 'assets/first/portrait.png', sha256: sha(first) };
  proof.assets.second_portrait = { path: 'assets/second/portrait.png', sha256: sha(second) };
  proof.assets.dynamic_portrait = { path: 'assets/portraits/alice.png', sha256: sha(dynamic) };
  fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`);
  const storyFile = path.join(project, 'src/story.js');
  fs.appendFileSync(storyFile,
    "\nexport const dynamicPortrait = new URL(`./assets/portraits/${'alice'}.png`, import.meta.url);\n" +
    "export const rootRelativePortrait = '/assets/first/portrait.png';\n" +
    "export const portraitAsset = { portrait: 'alice.png' };\n" +
    "export const narrativeText = 'Open alice.png in the gallery.';\n" +
    "export const narrativeExact = 'alice.png';\n" +
    "export const narrativeFull = 'Open assets/portraits/alice.png in the gallery.';\n");
  refreshStoryProof(project);
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE', plan.reasonCode);
  const paths = destinations(root);
  const built = await buildNarrativePlatformCandidates(plan, paths);
  assert.equal(built.status, 'CANDIDATES_BUILT_LOCAL', built.reasonCode);
  const entries = unzipSync(new Uint8Array(fs.readFileSync(paths.yandexZip)));
  const css = Buffer.from(entries['assets/theme.css']).toString('utf8');
  assert.match(css, /url\(first\/portrait\.webp\)/);
  assert.match(css, /url\(second\/portrait\.webp\)/);
  assert.match(css, /url\(portrait\.png\.svg\)/);
  assert.doesNotMatch(css, /url\((?:first|second)\/portrait\.png\)/);
  const frame = Buffer.from(entries['assets/frame.svg']).toString('utf8');
  assert.match(frame, /href="first\/portrait\.webp"/);
  assert.doesNotMatch(frame, /href="first\/portrait\.png"/);
  const main = Buffer.from(entries['src/main.js']).toString('utf8');
  assert.match(main, /\.\.?\/assets\/portraits\/\$\{[^}]+\}\.webp/);
  assert.doesNotMatch(main, /\.\.?\/assets\/portraits\/\$\{[^}]+\}\.png/);
  assert.match(main, /['\"]\/assets\/first\/portrait\.webp['\"]/);
  assert.doesNotMatch(main, /['\"]\/assets\/first\/portrait\.png['\"]/);
  assert.match(main, /['\"]alice\.webp['\"]/);
  assert.doesNotMatch(main, /portrait:\s*['\"]alice\.png['\"]/);
  assert.match(main, /Open alice\.png in the gallery/);
  assert.match(main, /narrativeExact\s*=\s*["']alice\.png["']/);
  assert.match(main, /Open assets\/portraits\/alice\.png in the gallery/);

  const tampered = { ...entries };
  tampered['assets/first/portrait.webp'] = await sharp({ create: { width: 5, height: 4, channels: 4,
    background: { r: 20, g: 220, b: 60, alpha: 1 } } }).webp({ quality: 95 }).toBuffer();
  fs.writeFileSync(paths.yandexZip, Buffer.from(zipSync(tampered,
    { level: 0, mtime: new Date(1980, 0, 1) })));
  const archive = inspectYandexArchive(paths.yandexZip);
  const paired = JSON.parse(fs.readFileSync(paths.exportReceipt, 'utf8'));
  const candidate = paired.candidates.find(item => item.target === 'yandex-games');
  candidate.files = archive.files;
  candidate.archiveSha256 = archive.sha256;
  candidate.derivedFiles = archive.files;
  candidate.derivedProjectSha256 = sha(Buffer.from(JSON.stringify(archive.files)));
  const derivation = candidate.assetDerivations.find(item => item.derivedPath === 'assets/first/portrait.webp');
  const tamperedMember = archive.files.find(item => item.path === derivation.derivedPath);
  derivation.derivedSha256 = tamperedMember.sha256;
  derivation.derivedSize = tamperedMember.size;
  fs.writeFileSync(paths.exportReceipt, `${JSON.stringify(paired)}\n`);
  const buildReceipt = JSON.parse(fs.readFileSync(paths.yandexBuildReceipt, 'utf8'));
  buildReceipt.sha256 = archive.sha256;
  buildReceipt.files = archive.files;
  fs.writeFileSync(paths.yandexBuildReceipt, `${JSON.stringify(buildReceipt)}\n`);
  assert.equal((await verifyNarrativePlatformCandidates(paths, plan)).status, 'BLOCKED',
    'updated ZIP and receipts must still fail source-derived verification');
});

test('F5b2 rejects existing outputs without overwrite or unrelated candidate files', async t => {
  const { root, project } = newProject(t);
  const plan = planNarrativePlatformExport(project);
  const paths = destinations(root);
  fs.writeFileSync(paths.vkZip, 'owner file');
  const result = await buildNarrativePlatformCandidates(plan, paths);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(fs.readFileSync(paths.vkZip, 'utf8'), 'owner file');
  assert.equal(fs.existsSync(paths.yandexZip), false);
  assert.equal(fs.existsSync(paths.exportReceipt), false);
});

test('F5b2 refuses tampered ZIP, paired source digest, target or member receipt', async t => {
  const { root, project } = newProject(t);
  const paths = destinations(root);
  const plan = planNarrativePlatformExport(project);
  const built = await buildNarrativePlatformCandidates(plan, paths);
  assert.equal(built.status, 'CANDIDATES_BUILT_LOCAL', built.reasonCode);
  const clean = fs.readFileSync(paths.exportReceipt);
  for (const mutate of [
    value => { value.sourceDigest = 'f'.repeat(64); },
    value => { value.candidates[0].target = 'vk-games'; },
    value => { value.candidates[1].files[0].sha256 = 'f'.repeat(64); },
    value => { value.candidates[0].derivedProjectSha256 = '0'.repeat(64); },
  ]) {
    const value = JSON.parse(clean);
    mutate(value);
    fs.writeFileSync(paths.exportReceipt, JSON.stringify(value));
    assert.equal((await verifyNarrativePlatformCandidates(paths, plan)).status, 'BLOCKED');
  }
  fs.writeFileSync(paths.exportReceipt, clean);
  fs.appendFileSync(paths.vkZip, 'tamper');
  assert.equal((await verifyNarrativePlatformCandidates(paths, plan)).status, 'BLOCKED');
});

test('F5b2 rejects stale F5b1 plans and output paths inside the author source', async t => {
  const { root, project } = newProject(t);
  const plan = planNarrativePlatformExport(project);
  const inside = { ...destinations(root), yandexZip: path.join(project, 'yandex.zip') };
  const rejected = await buildNarrativePlatformCandidates(plan, inside);
  assert.equal(rejected.status, 'BLOCKED');
  assert.equal(fs.existsSync(inside.yandexZip), false);
  fs.appendFileSync(path.join(project, 'src/story.js'), '\n// changed after planning');
  refreshStoryProof(project);
  const stale = await buildNarrativePlatformCandidates(plan, destinations(root));
  assert.equal(stale.status, 'BLOCKED');
  assert.equal(fs.existsSync(path.join(root, 'vk.zip')), false);
});

test('F5b2 reports an uncertain second-archive partial output without deleting it', async t => {
  const { root, project } = newProject(t);
  const paths = destinations(root);
  const plan = planNarrativePlatformExport(project);
  const originalOpen = fs.openSync;
  const originalWrite = fs.writeFileSync;
  const originalUnlink = fs.unlinkSync;
  let vkDescriptor = null;
  fs.openSync = function (filename, ...args) {
    const fd = originalOpen.call(this, filename, ...args);
    if (filename === 'vk.zip') vkDescriptor = fd;
    return fd;
  };
  fs.writeFileSync = function (filename, bytes, ...args) {
    const written = originalWrite.call(this, filename, bytes, ...args);
    if (filename === vkDescriptor) throw new Error('simulated post-write VK disk failure');
    return written;
  };
  fs.unlinkSync = function (filename, ...args) {
    if (filename === 'vk.zip') throw new Error('simulated retained uncertain archive');
    return originalUnlink.call(this, filename, ...args);
  };
  let result;
  try { result = await buildNarrativePlatformCandidates(plan, paths); }
  finally { fs.openSync = originalOpen; fs.writeFileSync = originalWrite; fs.unlinkSync = originalUnlink; }
  assert.equal(result.status, 'BLOCKED');
  assert.equal(fs.existsSync(paths.vkZip), true);
  assert.ok(result.partialOutputs.includes(paths.yandexZip));
  assert.ok(result.partialOutputs.includes(paths.vkZip), 'retained uncertain output must be reported');
  assert.equal(fs.existsSync(paths.exportReceipt), false);
});

test('F5b2 blocks authored images outside the package media root instead of silently dropping them', async t => {
  const { root, project } = newProject(t);
  fs.mkdirSync(path.join(project, 'images'));
  fs.writeFileSync(path.join(project, 'images/custom.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const story = path.join(project, 'src/story.js');
  fs.writeFileSync(story, fs.readFileSync(story, 'utf8').replace('./assets/lighthouse.svg', './images/custom.svg'));
  refreshStoryProof(project);
  const plan = planNarrativePlatformExport(project);
  assert.equal(plan.status, 'READY_TO_DERIVE');
  const result = await buildNarrativePlatformCandidates(plan, destinations(root));
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reasonCode, /MEDIA|ASSET|UNSUPPORTED/i);
  assert.equal(fs.existsSync(path.join(root, 'yandex.zip')), false);
});

test('F5b2 rejects coordinated source file and digest forgery using the trusted plan', async t => {
  const { root, project } = newProject(t);
  const paths = destinations(root);
  const plan = planNarrativePlatformExport(project);
  const built = await buildNarrativePlatformCandidates(plan, paths);
  assert.equal(built.status, 'CANDIDATES_BUILT_LOCAL');
  const value = JSON.parse(fs.readFileSync(paths.exportReceipt));
  value.sourceFiles.find(file => file.path === 'src/story.js').sha256 = 'f'.repeat(64);
  value.sourceDigest = sha(Buffer.from(JSON.stringify(value.sourceFiles)));
  fs.writeFileSync(paths.exportReceipt, JSON.stringify(value));
  assert.equal((await verifyNarrativePlatformCandidates(paths, plan)).status, 'BLOCKED');
});

test('F5b2 does not create SDK ZIP in the author source after output parent becomes a symlink', async t => {
  const { root, project } = newProject(t);
  const output = path.join(root, 'export-output');
  const moved = path.join(root, 'export-output-moved');
  fs.mkdirSync(output);
  const paths = destinations(output);
  const plan = planNarrativePlatformExport(project);
  const open = fs.openSync;
  let replaced = false;
  fs.openSync = function (filename, ...args) {
    if (!replaced && typeof filename === 'string' && filename.endsWith('yandex.zip')) {
      replaced = true;
      fs.renameSync(output, moved);
      fs.symlinkSync(project, output, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return open.call(this, filename, ...args);
  };
  let built;
  try { built = await buildNarrativePlatformCandidates(plan, paths); }
  finally { fs.openSync = open; }
  assert.equal(replaced, true);
  assert.equal(built.status, 'BLOCKED');
  assert.equal(fs.existsSync(path.join(project, 'yandex.zip')), false, 'source cannot receive archive');
});

test('F5b2 does not create external receipts in source after their parent is replaced', async t => {
  const { root, project } = newProject(t);
  const output = path.join(root, 'receipt-output');
  const moved = path.join(root, 'receipt-output-moved');
  fs.mkdirSync(output);
  const paths = destinations(output);
  const plan = planNarrativePlatformExport(project);
  const open = fs.openSync;
  let replaced = false;
  fs.openSync = function (filename, ...args) {
    if (!replaced && typeof filename === 'string' && filename.endsWith('yandex.build.json')) {
      replaced = true;
      fs.renameSync(output, moved);
      fs.symlinkSync(project, output, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return open.call(this, filename, ...args);
  };
  let built;
  try { built = await buildNarrativePlatformCandidates(plan, paths); }
  finally { fs.openSync = open; }
  assert.equal(replaced, true);
  assert.equal(built.status, 'BLOCKED');
  for (const filename of ['yandex.build.json', 'vk.build.json', 'paired.export.json']) {
    assert.equal(fs.existsSync(path.join(project, filename)), false, `${filename} cannot reach source`);
  }
});

test('F5b3 evidence refuses mock browser PASS if target, engine, scenario or hashes are incomplete', () => {
  const archiveSha256 = { yandex: 'a'.repeat(64), vk: 'b'.repeat(64) };
  const results = ['yandex', 'vk'].flatMap(target => [
    ...F5B3_BROWSER_CASES.map(({ browser, device }) => ({
      target, browser, device, status: 'PASS', sourceDigest: 'c'.repeat(64),
      archiveSha256: archiveSha256[target], externalRequests: 0, mockSdkOnly: true,
      observedStoryPath: [...F5B3_STORY_PATH],
      sdkCalls: target === 'yandex'
        ? ['sdk:init', 'loading:ready', 'player:getData', 'player:setData', 'gameplay:start']
        : ['VKWebAppInit', 'VKWebAppStorageGet', 'VKWebAppStorageSet'],
    })),
    ...F5B3_ADVERSE_CASES.map(scenario => ({
      target, browser: 'chromium', device: 'desktop', scenario, status: 'PASS',
      sourceDigest: 'c'.repeat(64), archiveSha256: archiveSha256[target],
      externalRequests: 0, mockSdkOnly: true,
    })),
  ]);
  const receipt = { schemaVersion: 1, sourceDigest: 'c'.repeat(64), archiveSha256,
    results, mockSdkOnly: true, releaseReady: false, publicationAllowed: false,
    fixtureChecks: 'PASS', status: 'MOCK_SDK_BROWSER_PASS',
    httpSdkSubstitutions: { yandex: '/sdk.js', vk: '/assets/vk-bridge.js' },
    archiveMembersUnchanged: true };
  assert.equal(validateF5b3Evidence(receipt).ok, true);
  const rejected = [
    { ...receipt, results: results.slice(1) },
    { ...receipt, results: results.map((row, index) => index === 0 ? { ...row, status: 'NOT_RUN' } : row) },
    { ...receipt, results: results.map((row, index) => index === 0 ? { ...row, archiveSha256: 'f'.repeat(64) } : row) },
    { ...receipt, results: results.map((row, index) => index === 0 ? { ...row, observedStoryPath: ['spoofed'] } : row) },
    { ...receipt, results: results.map((row, index) => index === 0 ? { ...row, sdkCalls: {} } : row) },
    { ...receipt, results: results.map(row => row.scenario ? row : {
      ...row, scenario: 'normal', observedStoryPath: undefined, sdkCalls: undefined,
    }) },
    { ...receipt, results: results.map(row => row.scenario ? row : {
      ...row, scenario: ['normal'], observedStoryPath: undefined, sdkCalls: undefined,
    }) },
    { ...receipt, results: results.map((row, index) => index === 0 ? { ...row, target: ['yandex'] } : row) },
    { ...receipt, results: results.map((row, index) => index === 0 ? { ...row, browser: ['chromium'] } : row) },
    { ...receipt, results: results.map((row, index) => index === 0 ? { ...row, device: ['desktop'] } : row) },
    { ...receipt, results: results.map((row, index) => index === 0 ? { ...row, scenario: null } : row) },
    { ...receipt, results: results.map((row, index) => index === 0 ? { ...row, scenario: {} } : row) },
    { ...receipt, results: results.map((row, index) => index === 0 ? {
      ...row, scenario: '', observedStoryPath: undefined, sdkCalls: undefined,
    } : row) },
    { ...receipt, results: [...results, results[0]] },
    { ...receipt, sourceDigest: 'not-a-digest' },
    { ...receipt, mockSdkOnly: false },
    { ...receipt, fixtureChecks: 'NOT_RUN' },
    { ...receipt, httpSdkSubstitutions: { yandex: '/different-sdk.js', vk: '/assets/vk-bridge.js' } },
    { ...receipt, archiveMembersUnchanged: false },
    { ...receipt, releaseReady: true },
    { ...receipt, publicationAllowed: true },
  ];
  for (const tampered of rejected) {
    assert.equal(validateF5b3Evidence(tampered).ok, false,
      'a partial or forged receipt must never attest mock-browser PASS');
  }
  assert.equal(buildF5b3Evidence({ sourceDigest: receipt.sourceDigest,
    archiveSha256, results: results.slice(1), fixtureChecks: 'PASS' }).status, 'BLOCKED');
  const accepted = buildF5b3Evidence({ sourceDigest: receipt.sourceDigest,
    archiveSha256, results, fixtureChecks: 'PASS' });
  assert.equal(accepted.status, 'MOCK_SDK_BROWSER_PASS');
  assert.equal(accepted.releaseReady, false);
  assert.equal(accepted.publicationAllowed, false);
  assert.deepEqual(accepted.httpSdkSubstitutions, receipt.httpSdkSubstitutions);
  assert.equal(accepted.archiveMembersUnchanged, true);
});

test('F5b3 direct runner does not silently skip paths with spaces or Windows drive letters', () => {
  const linuxScript = '/tmp/ludory f5b3/#build/f5b3-platform-smoke.mjs';
  const linuxUrl = new URL('file:///tmp/ludory%20f5b3/%23build/f5b3-platform-smoke.mjs');
  assert.equal(isF5b3DirectInvocation(linuxScript, linuxUrl, 'linux'), true);
  assert.equal(isF5b3DirectInvocation('/tmp/other/script.mjs', linuxUrl, 'linux'), false);
  assert.equal(isF5b3DirectInvocation(undefined, linuxUrl, 'linux'), false);
  const winScript = 'D:\\HardWork\\LUDORY Dev\\f5b3-platform-smoke.mjs';
  const winUrl = new URL('file:///D:/HardWork/LUDORY%20Dev/f5b3-platform-smoke.mjs');
  assert.equal(isF5b3DirectInvocation(winScript, winUrl, 'win32'), true);
  assert.equal(isF5b3DirectInvocation(winScript.toLowerCase(), winUrl, 'win32'), true);
  assert.equal(isF5b3DirectInvocation('D:\\Other\\f5b3-platform-smoke.mjs', winUrl, 'win32'), false);
});
