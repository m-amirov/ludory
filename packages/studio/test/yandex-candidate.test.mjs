import './setup-trust-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { planCreate, applyCreatePlan } from '../src/scaffold.mjs';
import { buildYandexCandidate, validateYandexCandidatePath } from '../../../scripts/build-yandex-candidate.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const options = { id: 'zip-game', title: 'Yandex candidate', lang: 'en', version: '1.0.0',
  profile: 'web-game', template: 'yandex-runtime', targets: ['yandex-games'] };

function project(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-c5-zip-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'game');
  fs.mkdirSync(root);
  const preview = planCreate(root, options);
  assert.equal(preview.status, 'READY');
  assert.equal(applyCreatePlan(preview).status, 'APPLIED');
  return { root, base, zip: path.join(base, 'candidate.zip') };
}

test('Yandex candidate bytes and entry hashes reproduce and contain no developer metadata or SDK copy', async t => {
  const { root, base, zip } = project(t);
  const gameScript = path.join(root, 'src/main.js');
  fs.appendFileSync(gameScript, '\n// Author-owned game enhancement.\n');
  fs.writeFileSync(path.join(root, 'assets/icon.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
  fs.mkdirSync(path.join(root, '.codex-os'));
  fs.writeFileSync(path.join(root, '.codex-os', 'evidence.json'), 'frozen evidence');
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'tests', 'dev.test.js'), 'secret');
  const first = await buildYandexCandidate({ projectDir: root, outputZip: zip });
  const secondPath = path.join(base, 'repeat.zip');
  const second = await buildYandexCandidate({ projectDir: root, outputZip: secondPath });
  const archive = fs.readFileSync(zip);
  assert.deepEqual(archive, fs.readFileSync(secondPath));
  assert.equal(first.sha256, sha256(archive));
  assert.equal(second.sha256, first.sha256);
  assert.deepEqual(first.files.map(item => item.path), [
    'assets/icon.png', 'assets/ludory-yandex.js', 'index.html', 'ludory.project.json', 'src/main.js',
  ]);
  const extracted = unzipSync(new Uint8Array(archive));
  assert.deepEqual(Object.keys(extracted).sort(), first.files.map(item => item.path));
  for (const { path: filename, sha256: hash, size } of first.files) {
    assert.equal(sha256(extracted[filename]), hash);
    assert.equal(extracted[filename].byteLength, size);
    assert.doesNotMatch(filename, /(^|\/)(?:\.codex-os|tests|sdk\.js)(?:\/|$)|\.\./i);
  }
});

test('Yandex candidate uses canonical physical paths when ordinary realpath differs from native', async t => {
  const { root, zip } = project(t);
  const canonical = fs.realpathSync.native(root);
  const alternateSpelling = `${root}${path.sep}..${path.sep}${path.basename(root)}`;
  assert.equal(fs.statSync(alternateSpelling).ino, fs.statSync(root).ino);

  const original = fs.realpathSync;
  const divergentRealpath = (...args) => {
    if (path.resolve(args[0]) === root) return alternateSpelling;
    return original(...args);
  };
  divergentRealpath.native = original.native;
  fs.realpathSync = divergentRealpath;
  try {
    const candidate = await buildYandexCandidate({ projectDir: root, outputZip: zip });
    assert.equal(candidate.archivePath, path.resolve(zip));
    assert.ok(candidate.files.some(file => file.path === 'index.html'));
    assert.ok(fs.existsSync(zip));
    assert.equal(fs.realpathSync.native(root), canonical);
  } finally {
    fs.realpathSync = original;
  }
});

test('Yandex candidate rejects output inside the game even with divergent realpath spellings', async t => {
  const { root } = project(t);
  const insideZip = path.join(root, 'inside.zip');
  const sibling = path.join(path.dirname(root), 'alias-segment');
  fs.mkdirSync(sibling);
  const alias = `${sibling}${path.sep}..${path.sep}${path.basename(root)}`;
  assert.equal(fs.statSync(alias).ino, fs.statSync(root).ino);
  const original = fs.realpathSync;
  let rootLookups = 0;
  const divergentRealpath = (...args) => {
    if (path.resolve(args[0]) === root && ++rootLookups === 2) return alias;
    return original(...args);
  };
  divergentRealpath.native = original.native;
  fs.realpathSync = divergentRealpath;
  try {
    await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: insideZip }),
      /outside|project/i);
    assert.equal(fs.existsSync(insideZip), false);
  } finally {
    fs.realpathSync = original;
  }
});

test('Yandex candidate refuses existing output and protects its bytes', async t => {
  const { root, zip } = project(t);
  fs.writeFileSync(zip, 'user-owned ZIP');
  await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }), /exist|overwrite|conflict/i);
  assert.equal(fs.readFileSync(zip, 'utf8'), 'user-owned ZIP');
  await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: path.join(root, 'in-project.zip') }),
    /outside|project/i);
});

test('Yandex candidate rejects altered target and incomplete Studio trust without writing output', async t => {
  const { root, zip } = project(t);
  const manifest = path.join(root, 'ludory.project.json');
  const original = fs.readFileSync(manifest);
  fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(original), targets: ['vk-games'] }));
  await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }), /target|yandex|manifest/i);
  assert.equal(fs.existsSync(zip), false);
  fs.writeFileSync(manifest, original);
  fs.unlinkSync(path.join(root, 'ludory.studio.json'));
  await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }), /studio|receipt|provenance/i);
  assert.equal(fs.existsSync(zip), false);
});

test('Yandex candidate requires host-bound Studio creation, not copied or self-hashed receipts', async t => {
  const { root, base, zip } = project(t);
  const copy = path.join(base, 'forged');
  fs.cpSync(root, copy, { recursive: true });
  await assert.rejects(() => buildYandexCandidate({ projectDir: copy, outputZip: zip }),
    /studio|origin|trust|registered/i);
  assert.equal(fs.existsSync(zip), false);

  const bundle = path.join(root, 'assets/ludory-yandex.js');
  fs.appendFileSync(bundle, '\n// forged managed bundle');
  const changedHash = sha256(fs.readFileSync(bundle));
  const receipt = path.join(root, 'ludory.studio.json');
  const components = path.join(root, 'ludory.components.json');
  const receiptData = JSON.parse(fs.readFileSync(receipt));
  const componentsData = JSON.parse(fs.readFileSync(components));
  receiptData.files['assets/ludory-yandex.js'] = changedHash;
  componentsData.files['assets/ludory-yandex.js'] = changedHash;
  fs.writeFileSync(receipt, `${JSON.stringify(receiptData, null, 2)}\n`);
  fs.writeFileSync(components, `${JSON.stringify(componentsData, null, 2)}\n`);
  await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }),
    /studio|origin|trust|registered/i);
  assert.equal(fs.existsSync(zip), false);
});

test('Yandex candidate rejects stale managed bundle and SDK tag changes', async t => {
  const { root, zip } = project(t);
  const bundle = path.join(root, 'assets/ludory-yandex.js');
  const original = fs.readFileSync(bundle);
  fs.appendFileSync(bundle, '\n// corrupted managed bytes');
  await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }), /bundle|hash|managed/i);
  fs.writeFileSync(bundle, original);
  const html = path.join(root, 'index.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('/sdk.js', 'https://sdk.games.s3.yandex.net/sdk.js'));
  await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }), /sdk|script|relative/i);
  assert.equal(fs.existsSync(zip), false);
});

test('Yandex candidate rejects inert, commented, duplicate or misplaced SDK scripts', async t => {
  const { root, zip } = project(t);
  const htmlPath = path.join(root, 'index.html');
  const original = fs.readFileSync(htmlPath, 'utf8');
  const sdkTag = '<script src="/sdk.js"></script>';
  assert.ok(original.includes(sdkTag));
  const variants = [
    ['commented', original.replace(sdkTag, `<!-- ${sdkTag} -->`)],
    ['inert', original.replace(sdkTag, '<script type="text/plain" src="/sdk.js"></script>')],
    ['duplicate-unquoted', original.replace('</head>', '<script src=/sdk.js></script></head>')],
    ['duplicate-spaced', original.replace('</head>', '<script src = "/sdk.js"></script></head>')],
    ['extra-inline', original.replace('</head>', '<script>alert(1)</script></head>')],
    ['wrong-head', original.replace(sdkTag, '').replace('<body>', `<body>${sdkTag}`)],
    ['style-raw-text', original.replace(sdkTag, '').replace('</style>', `${sdkTag}</style>`) ],
    ['title-raw-text', original.replace(sdkTag, '').replace('</title>', `${sdkTag}</title>`) ],
    ['textarea-raw-text', original.replace(sdkTag, '').replace('</head>',
      `<textarea>${sdkTag}</textarea></head>`) ],
    ['attribute-lookalike', original.replace(sdkTag, '').replace('<head>',
      `<head><div data-pretend='${sdkTag}'></div>`) ],
    ['module-textarea', original.replace('<script type="module" src="src/main.js"></script>', '').replace('</body>',
      '<textarea><script type="module" src="src/main.js"></script></textarea></body>')],
  ];
  for (const [name, changed] of variants) {
    fs.writeFileSync(htmlPath, changed);
    await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }),
      /sdk|script|html|head/i, `unexpectedly accepted ${name}`);
    assert.equal(fs.existsSync(zip), false);
  }
});

test('Yandex candidate rejects foreign SDK and copied sdk.js, even if not in the file list', async t => {
  const { root, zip } = project(t);
  const entry = path.join(root, 'src/main.js');
  const original = fs.readFileSync(entry);
  fs.appendFileSync(entry, '\nVKWebAppInit();\n');
  await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }), /VK|foreign|platform/i);
  fs.writeFileSync(entry, original);
  fs.writeFileSync(path.join(root, 'sdk.js'), 'copied platform SDK');
  await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }), /sdk\.js|copy/i);
  assert.equal(fs.existsSync(zip), false);
});

test('Yandex candidate refuses linked assets and case-ambiguous paths', async t => {
  const { root, base, zip } = project(t);
  const owner = path.join(base, 'owner.png');
  fs.writeFileSync(owner, 'untouched');
  const symlink = path.join(root, 'assets', 'evil.png');
  try {
    fs.symlinkSync(owner, symlink);
    await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }), /symbolic|link|regular/i);
    assert.equal(fs.readFileSync(owner, 'utf8'), 'untouched');
    fs.unlinkSync(symlink);
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.diagnostic('File symlink creation is unavailable on this Windows host');
  }
  fs.writeFileSync(path.join(root, 'assets', 'A.png'), 'a');
  fs.writeFileSync(path.join(root, 'assets', 'a.png'), 'b');
  const upper = fs.statSync(path.join(root, 'assets', 'A.png'));
  const lower = fs.statSync(path.join(root, 'assets', 'a.png'));
  if (upper.ino === lower.ino && upper.dev === lower.dev) {
    t.diagnostic('Case-colliding fixture is impossible on this case-insensitive filesystem');
  } else {
    await assert.rejects(() => buildYandexCandidate({ projectDir: root, outputZip: zip }), /case|duplicate|ambiguous/i);
  }
  assert.equal(fs.existsSync(zip), false);
});

test('Yandex candidate rejects a linked project root and Windows device names', async t => {
  const { root, base, zip } = project(t);
  const alias = path.join(base, 'game-link');
  try {
    fs.symlinkSync(root, alias, 'dir');
    await assert.rejects(() => buildYandexCandidate({ projectDir: alias, outputZip: zip }), /symbolic|link|root/i);
    fs.unlinkSync(alias);
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.diagnostic('Directory symlink creation is unavailable on this Windows host');
  }
  assert.throws(() => validateYandexCandidatePath('assets/CON.png'), /reserved|device|unsafe/i);
  assert.throws(() => validateYandexCandidatePath('assets/aux.webp'), /reserved|device|unsafe/i);
  assert.equal(fs.existsSync(zip), false);
});
