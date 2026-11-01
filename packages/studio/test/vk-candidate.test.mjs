import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { buildVkCandidate, validateVkCandidatePath } from '../../../scripts/build-vk-candidate.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const options = { id: 'vk-candidate', title: 'VK Candidate', lang: 'en', version: '1.0.0',
  profile: 'web-game', template: 'vk-runtime', targets: ['vk-games'] };

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-vk-v5-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const game = path.join(base, 'game');
  fs.mkdirSync(game);
  const plan = planCreate(game, options);
  assert.equal(plan.status, 'READY', plan.conflicts?.join('; '));
  assert.equal(applyCreatePlan(plan).status, 'APPLIED');
  return { base, game, zip: path.join(base, 'candidate.zip') };
}

test('VK candidate builds a reproducible ZIP with two pinned bundles and license notices, without developer files', async t => {
  const { base, game, zip } = fixture(t);
  fs.appendFileSync(path.join(game, 'src/main.js'), '\n// Author-owned game behavior.\n');
  fs.writeFileSync(path.join(game, 'assets/icon.png'), Buffer.from([137, 80, 78, 71, 1]));
  fs.mkdirSync(path.join(game, 'tests'));
  fs.writeFileSync(path.join(game, 'tests/dev.test.js'), 'owner-private');
  const first = await buildVkCandidate({ projectDir: game, outputZip: zip });
  const repeat = path.join(base, 'repeat.zip');
  const second = await buildVkCandidate({ projectDir: game, outputZip: repeat });
  const bytes = fs.readFileSync(zip);
  assert.deepEqual(bytes, fs.readFileSync(repeat));
  assert.equal(first.archivePath, path.resolve(zip));
  assert.equal(first.sha256, sha(bytes));
  assert.equal(second.sha256, first.sha256);
  assert.deepEqual(first.files.map(item => item.path), [
    'assets/icon.png', 'assets/ludory-vk.js', 'assets/vk-bridge.js', 'index.html',
    'licenses/swc-helpers.txt', 'licenses/vk-bridge.txt', 'ludory.project.json', 'src/main.js',
  ]);
  const members = unzipSync(new Uint8Array(bytes));
  assert.deepEqual(Object.keys(members).sort(), first.files.map(item => item.path));
  for (const file of first.files) {
    assert.equal(file.sha256, sha(members[file.path]), file.path);
    assert.equal(file.size, members[file.path].length, file.path);
  }
  assert.equal(members['ludory.studio.json'], undefined);
  assert.equal(members['tests/dev.test.js'], undefined);
  assert.equal(members['assets/vk-bridge.js'].length > 1000, true);
});

test('VK candidate protects existing output and never creates a ZIP inside the game', async t => {
  const { game, zip } = fixture(t);
  fs.writeFileSync(zip, 'owner bytes');
  await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /exist|overwrite|conflict/i);
  assert.equal(fs.readFileSync(zip, 'utf8'), 'owner bytes');
  const inside = path.join(game, 'inside.zip');
  await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: inside }), /outside|project/i);
  assert.equal(fs.existsSync(inside), false);
});

test('VK candidate rejects changed target, missing Studio receipt and forged copied origin', async t => {
  const { game, base, zip } = fixture(t);
  const manifest = path.join(game, 'ludory.project.json');
  const original = fs.readFileSync(manifest);
  for (const targets of [['yandex-games'], ['vk-games', 'yandex-games']]) {
    fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(original), targets }));
    await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /VK|target|manifest/i);
    assert.equal(fs.existsSync(zip), false);
  }
  fs.writeFileSync(manifest, original);
  const copied = path.join(base, 'copied');
  fs.cpSync(game, copied, { recursive: true });
  await assert.rejects(() => buildVkCandidate({ projectDir: copied, outputZip: zip }), /studio|origin|trust|registered/i);
  fs.unlinkSync(path.join(game, 'ludory.studio.json'));
  await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /studio|origin|trust|receipt/i);
  assert.equal(fs.existsSync(zip), false);
});

test('VK candidate rejects tampered managed Bridge, Runtime and license bytes', async t => {
  const { game, zip } = fixture(t);
  for (const name of ['assets/vk-bridge.js', 'assets/ludory-vk.js',
    'licenses/vk-bridge.txt', 'licenses/swc-helpers.txt']) {
    const file = path.join(game, name);
    const original = fs.readFileSync(file);
    fs.appendFileSync(file, '\nchanged');
    await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /hash|managed|license|studio|trust/i, name);
    assert.equal(fs.existsSync(zip), false);
    fs.writeFileSync(file, original);
  }
});

test('VK candidate rejects hidden, duplicate, absolute and redirected executable HTML', async t => {
  const { game, zip } = fixture(t);
  const file = path.join(game, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const tag = '<script type="module" src="src/main.js"></script>';
  assert.ok(html.includes(tag));
  const variants = [
    html.replace(tag, `<!-- ${tag} -->`),
    html.replace(tag, `<template>${tag}</template>`),
    html.replace(tag, `<textarea>${tag}</textarea>`),
    html.replace(tag, `<script type="text/plain" src="src/main.js"></script>`),
    html.replace(tag, `${tag}\n<script src="https://evil.example/sdk.js"></script>`),
    html.replace(tag, `${tag}\n<script>console.log('unexpected')</script>`),
    html.replace('<head>', '<head><base href="https://evil.example/">'),
    html.replace(tag, '<script type="module" src="/src/main.js"></script>'),
    html.replace(tag, '<script type="module" src="https://evil.example/main.js"></script>'),
  ];
  for (const variant of variants) {
    fs.writeFileSync(file, variant);
    await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /html|script|module|base|sdk/i);
    assert.equal(fs.existsSync(zip), false);
  }
});

test('VK candidate requires both local imports and rejects a foreign SDK URL in the game entrypoint', async t => {
  const { game, zip } = fixture(t);
  const file = path.join(game, 'src/main.js');
  const original = fs.readFileSync(file, 'utf8');
  for (const changed of [
    original.replace('../assets/vk-bridge.js', 'https://example.invalid/vk-bridge.js'),
    original.replace('../assets/ludory-vk.js', '../assets/other.js'),
    `${original}\nYaGames.init();`,
  ]) {
    fs.writeFileSync(file, changed);
    await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /bridge|import|sdk|foreign|local|bundle/i);
    assert.equal(fs.existsSync(zip), false);
  }
});

test('VK candidate requires real executable import declarations, not text in comments', async t => {
  const { game, zip } = fixture(t);
  const file = path.join(game, 'src/main.js');
  const original = fs.readFileSync(file, 'utf8');
  for (const changed of [
    "// '../assets/ludory-vk.js' '../assets/vk-bridge.js'\nconsole.log('missing imports');",
    `${original.replace("'../assets/vk-bridge.js'", "'//unpkg.com/@vkontakte/vk-bridge/dist/browser.min.js'")}\n// '../assets/vk-bridge.js'`,
    `${original}\nimport('https://example.com/unexpected-game.js');`,
  ]) {
    fs.writeFileSync(file, changed);
    await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /import|sdk|remote|bundle|module/i);
    assert.equal(fs.existsSync(zip), false);
  }
});

test('VK candidate rejects executable HTML handlers and nested external browsing contexts', async t => {
  const { game, zip } = fixture(t);
  const filename = path.join(game, 'index.html');
  const html = fs.readFileSync(filename, 'utf8');
  for (const modified of [
    html.replace('<body>', '<body onload="import(\'//unpkg.com/vk-bridge.js\')">'),
    html.replace('<main>', '<main onclick="import(\'https://example.invalid/remote.js\')">'),
    html.replace('</body>', '<iframe src="https://evil.example/"></iframe></body>'),
    html.replace('</body>', '<object data="https://evil.example/game.html"></object></body>'),
    html.replace('</head>', '<meta http-equiv="refresh" content="0;url=https://evil.example/"></head>'),
    html.replace('<body>', '<body><a href="javascript:import(\'//evil.example/\')">link</a>'),
  ]) {
    fs.writeFileSync(filename, modified);
    await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /html|event|foreign|active|iframe|object|remote|script|sdk|unsafe/i);
    assert.equal(fs.existsSync(zip), false);
  }
});

test('VK candidate packages the exact previously validated managed bytes across an intervening source mutation', async t => {
  const { game, zip } = fixture(t);
  const bridge = path.join(game, 'assets/vk-bridge.js');
  const trusted = fs.readFileSync(bridge);
  const original = fs.readdirSync;
  let changed = false;
  fs.readdirSync = function (directory, ...args) {
    if (!changed && path.resolve(directory) === path.join(game, 'assets')) {
      changed = true;
      fs.writeFileSync(bridge, 'globalThis.fakeBridge = true;');
    }
    return original.call(this, directory, ...args);
  };
  let report;
  try { report = await buildVkCandidate({ projectDir: game, outputZip: zip }); }
  finally { fs.readdirSync = original; }
  assert.equal(changed, true);
  assert.deepEqual(Buffer.from(unzipSync(new Uint8Array(fs.readFileSync(zip)))['assets/vk-bridge.js']), trusted);
  assert.equal(report.files.find(file => file.path === 'assets/vk-bridge.js').sha256, sha(trusted));
});

test('VK candidate does not redirect the output into the game if the output parent changes', async t => {
  const { game, base } = fixture(t);
  const parent = path.join(base, 'outside');
  fs.mkdirSync(parent);
  const output = path.join(parent, 'candidate.zip');
  const original = fs.readdirSync;
  let changed = false;
  fs.readdirSync = function (directory, ...args) {
    if (!changed && path.resolve(directory) === path.join(game, 'assets')) {
      changed = true;
      fs.renameSync(parent, path.join(base, 'moved-parent'));
      fs.symlinkSync(game, parent, 'dir');
    }
    return original.call(this, directory, ...args);
  };
  try {
    await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: output }),
      /output|parent|directory|changed|outside|symlink/i);
  } finally { fs.readdirSync = original; }
  assert.equal(changed, true);
  assert.equal(fs.existsSync(path.join(game, 'candidate.zip')), false);
});

test('VK candidate preserves exact 64-bit output directory identity when inode exceeds safe integers', async t => {
  const { base, game } = fixture(t);
  const parent = path.join(base, 'large-inode-parent');
  fs.mkdirSync(parent);
  const output = path.join(parent, 'candidate.zip');
  const exactInode = 9_007_199_254_740_993n;
  const originalLstat = fs.lstatSync;
  const originalStat = fs.statSync;
  fs.lstatSync = function (filename, options) {
    const result = originalLstat.apply(this, arguments);
    if (path.resolve(filename) === parent) {
      result.ino = options?.bigint ? exactInode : Number(exactInode);
    }
    return result;
  };
  fs.statSync = function (filename, options) {
    const result = originalStat.apply(this, arguments);
    if (filename === '.' && process.cwd() === parent) {
      result.ino = options?.bigint ? exactInode : Number(exactInode);
    }
    return result;
  };
  try {
    const receipt = await buildVkCandidate({ projectDir: game, outputZip: output });
    assert.equal(receipt.archivePath, output);
    assert.equal(receipt.sha256, sha(fs.readFileSync(output)));
  } finally {
    fs.lstatSync = originalLstat;
    fs.statSync = originalStat;
  }
});

test('VK candidate rejects output paths through symbolic ancestor directories', async t => {
  const { game, base } = fixture(t);
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  const alias = path.join(base, 'alias');
  try { fs.symlinkSync(outside, alias, 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic('Symlinks unavailable'); return; }
    throw error;
  }
  const nested = path.join(alias, 'nested');
  fs.mkdirSync(nested);
  const zip = path.join(nested, 'candidate.zip');
  await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /symbolic|symlink|unsafe|output|parent/i);
  assert.equal(fs.existsSync(zip), false);
});

test('VK candidate rejects a ZIP whose complete pretty-JSON receipt exceeds the verifier limit', async t => {
  const { game, zip } = fixture(t);
  for (let index = 0; index < 3400; index++) {
    fs.writeFileSync(path.join(game, 'assets', `asset-${String(index).padStart(5, '0')}-${'a'.repeat(180)}.png`), 'x');
  }
  await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /receipt|size|file count|limit/i);
  assert.equal(fs.existsSync(zip), false);
});

test('VK candidate refuses linked media, linked root, case ambiguity and unsafe archive paths', async t => {
  const { game, base, zip } = fixture(t);
  const owner = path.join(base, 'owner.png');
  fs.writeFileSync(owner, 'protected');
  const alias = path.join(game, 'assets', 'linked.png');
  try {
    fs.symlinkSync(owner, alias);
    await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /symbolic|link|regular/i);
    assert.equal(fs.readFileSync(owner, 'utf8'), 'protected');
    fs.unlinkSync(alias);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    t.diagnostic('Symlink creation is unavailable');
  }
  assert.throws(() => validateVkCandidatePath('assets/CON.png'), /unsafe|reserved|device/i);
  assert.throws(() => validateVkCandidatePath('../secret'), /unsafe|reserved|device/i);
  assert.throws(() => validateVkCandidatePath('assets/space name.png'), /unsafe|reserved|device/i);
  fs.writeFileSync(path.join(game, 'assets/A.png'), 'A');
  fs.writeFileSync(path.join(game, 'assets/a.png'), 'a');
  const a = fs.statSync(path.join(game, 'assets/A.png'));
  const b = fs.statSync(path.join(game, 'assets/a.png'));
  if (a.ino !== b.ino || a.dev !== b.dev) {
    await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /case|duplicate|ambiguous/i);
  }
  assert.equal(fs.existsSync(zip), false);
});

test('VK candidate rejects case-insensitive file-versus-directory collisions before writing', async t => {
  const { game, zip } = fixture(t);
  fs.writeFileSync(path.join(game, 'assets/Icon.png'), 'icon');
  const collidingDirectory = path.join(game, 'assets/icon.png');
  try { fs.mkdirSync(collidingDirectory); }
  catch (error) {
    if (error.code === 'EEXIST') { t.skip('Filesystem is case-insensitive'); return; }
    throw error;
  }
  fs.writeFileSync(path.join(collidingDirectory, 'frame.png'), 'frame');
  await assert.rejects(() => buildVkCandidate({ projectDir: game, outputZip: zip }), /case|collision|ambiguous/i);
  assert.equal(fs.existsSync(zip), false);
});
