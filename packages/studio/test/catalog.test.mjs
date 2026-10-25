import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCatalog, listCatalog, showCatalog } from '../src/catalog.mjs';

function external(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'profiles'));
  fs.mkdirSync(path.join(root, 'templates', 'arcade-basic'), { recursive: true });
  fs.writeFileSync(path.join(root, 'profiles', 'arcade-game.json'), JSON.stringify({
    schemaVersion: 1, id: 'arcade-game', version: '1.0.0', description: 'Arcade demo',
    engine: 'web', targets: ['vk-games'], templates: ['arcade-basic'],
  }));
  fs.writeFileSync(path.join(root, 'templates', 'arcade-basic', 'template.json'), JSON.stringify({
    schemaVersion: 1, id: 'arcade-basic', version: '1.0.0', description: 'Arcade template',
    profile: 'arcade-game', engine: 'web', targets: ['vk-games'], files: ['index.html'],
  }));
  fs.writeFileSync(path.join(root, 'templates', 'arcade-basic', 'index.html'), '<h1>Arcade</h1>');
  return root;
}

test('built-in catalogs are versioned, valid, and only expose public descriptors', () => {
  const profiles = listCatalog('profiles');
  assert.deepEqual(profiles.map(x => x.id), ['narrative-game', 'web-game']);
  assert.deepEqual(listCatalog('templates').map(x => x.id), ['narrative-basic', 'web-basic']);
  assert.equal(showCatalog('profiles', 'narrative-game').engine, 'web');
  assert.deepEqual(showCatalog('templates', 'narrative-basic').files, ['index.html', 'src/main.js']);
  assert.equal(Object.hasOwn(showCatalog('templates', 'web-basic'), 'assetBytes'), false);
  const first = loadCatalog().templates.get('web-basic');
  assert.ok(first.assets.get('index.html').bytes.length > 0);
  assert.match(first.assets.get('index.html').sha256, /^[a-f0-9]{64}$/);
});

test('explicit local catalog can add new profile/template without changing built-ins', t => {
  const catalog = external(t);
  assert.deepEqual(listCatalog('profiles', catalog).map(x => x.id), ['arcade-game', 'narrative-game', 'web-game']);
  assert.equal(showCatalog('templates', 'arcade-basic', catalog).profile, 'arcade-game');
  assert.equal(showCatalog('profiles', 'web-game', catalog).engine, 'web');
});

test('catalog rejects override IDs and invalid JSON or unknown fields', t => {
  const catalog = external(t);
  const profile = path.join(catalog, 'profiles', 'arcade-game.json');
  const value = JSON.parse(fs.readFileSync(profile, 'utf8'));
  value.id = 'web-game';
  fs.writeFileSync(profile, JSON.stringify(value));
  assert.throws(() => loadCatalog(catalog), /duplicate|override|conflict|does not match/i);
  value.id = 'arcade-game';
  value.secret = true;
  fs.writeFileSync(profile, JSON.stringify(value));
  assert.throws(() => loadCatalog(catalog), /unknown|field/i);
  fs.writeFileSync(profile, '{bad json');
  assert.throws(() => loadCatalog(catalog), /JSON|json/i);
});

test('catalog rejects traversal, absolute/Windows paths and reserved template outputs', t => {
  const catalog = external(t);
  const descriptor = path.join(catalog, 'templates', 'arcade-basic', 'template.json');
  const value = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
  for (const invalid of ['../escape', '/tmp/escape', 'src\\..\\evil', 'C:/escape', 'ludory.project.json', 'ludory.studio.json']) {
    value.files = [invalid];
    fs.writeFileSync(descriptor, JSON.stringify(value));
    assert.throws(() => loadCatalog(catalog), /path|reserved|invalid/i, invalid);
  }
});

test('catalog blocks symbolic sources or directory links', t => {
  const catalog = external(t);
  const file = path.join(catalog, 'templates', 'arcade-basic', 'index.html');
  fs.unlinkSync(file);
  const outside = path.join(catalog, 'outside.html');
  fs.writeFileSync(outside, 'owned');
  fs.symlinkSync(outside, file);
  assert.throws(() => loadCatalog(catalog), /symbolic|link|regular/i);
});

test('catalog rejects incompatible references and ambiguous duplicate file entries', t => {
  const catalog = external(t);
  const file = path.join(catalog, 'templates', 'arcade-basic', 'template.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  value.files = ['index.html', 'index.html'];
  fs.writeFileSync(file, JSON.stringify(value));
  assert.throws(() => loadCatalog(catalog), /duplicate/i);
  value.files = ['index.html'];
  value.profile = 'missing-profile';
  fs.writeFileSync(file, JSON.stringify(value));
  assert.throws(() => loadCatalog(catalog), /profile|reference/i);
});

test('catalog rejects parent output files used as directories and non-SemVer prerelease', t => {
  const catalog = external(t);
  const template = path.join(catalog, 'templates', 'arcade-basic', 'template.json');
  const descriptor = JSON.parse(fs.readFileSync(template, 'utf8'));
  descriptor.files = ['index.html', 'index.html/deeper'];
  fs.writeFileSync(template, JSON.stringify(descriptor));
  assert.throws(() => loadCatalog(catalog), /path|collision|ancestor|directory/i);
  descriptor.files = ['index.html'];
  fs.writeFileSync(template, JSON.stringify(descriptor));
  const profile = path.join(catalog, 'profiles', 'arcade-game.json');
  const data = JSON.parse(fs.readFileSync(profile, 'utf8'));
  data.version = '1.0.0-01';
  fs.writeFileSync(profile, JSON.stringify(data));
  assert.throws(() => loadCatalog(catalog), /version|semver/i);
});

test('reserved metadata filenames cannot be ancestors of generated template files', t => {
  const catalog = external(t);
  const templateRoot = path.join(catalog, 'templates', 'arcade-basic');
  const manifest = path.join(templateRoot, 'template.json');
  const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const reserved of ['ludory.project.json', 'ludory.studio.json', 'ludory.components.json',
    '.ludory/managed.js']) {
    fs.mkdirSync(path.join(templateRoot, reserved), { recursive: true });
    fs.writeFileSync(path.join(templateRoot, reserved, 'data.txt'), 'existing template asset');
    value.files = [`${reserved}/data.txt`];
    fs.writeFileSync(manifest, JSON.stringify(value));
    assert.throws(() => loadCatalog(catalog), /reserved|metadata|path/i, reserved);
  }
});
