import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLegacyGameSpec } from '../src/legacy.mjs';

const gameSpec = `schemaVersion: 2
project:
  slug: winter-story
  title:
    ru: Зимняя история
    en: "Winter Story"
  platform: yandex-games
  engine: phaser
  target: release-candidate
game:
  description: >-
    Story content remains owned by the game.
`;

function fixture(t, spec = gameSpec, version = '0.9.3') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ludory-legacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'game-spec.yaml'), spec);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'winter-story', version }));
  return root;
}

test('extracts only project identity, engine and declared platform without rewriting legacy spec', t => {
  const root = fixture(t);
  const before = fs.readFileSync(path.join(root, 'game-spec.yaml'));
  const result = readLegacyGameSpec(root);
  assert.deepEqual(result.manifest, {
    schemaVersion: 1,
    id: 'winter-story',
    version: '0.9.3',
    title: { ru: 'Зимняя история', en: 'Winter Story' },
    engine: 'phaser',
    targets: ['yandex-games'],
  });
  assert.deepEqual(result.sources.map(x => x.path), ['game-spec.yaml', 'package.json']);
  for (const source of result.sources) assert.match(source.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'game-spec.yaml')), before);
  assert.equal(fs.existsSync(path.join(root, 'ludory.project.json')), false);
});

test('supports safe quoted titles without inferring another distribution target', t => {
  const root = fixture(t, gameSpec.replace('Зимняя история', "'История: часть 1'").replace('  platform: yandex-games', '  platform: vk-games'));
  const { manifest } = readLegacyGameSpec(root);
  assert.equal(manifest.title.ru, 'История: часть 1');
  assert.deepEqual(manifest.targets, ['vk-games']);
});

test('fails closed on missing, ambiguous or unsupported legacy fields', t => {
  const root = fixture(t);
  for (const invalid of [
    gameSpec.replace('  slug: winter-story', '  slug: winter-story\n  slug: duplicate'),
    gameSpec.replace('  slug: winter-story', '  slug: *legacy'),
    gameSpec.replace('  platform: yandex-games', ''),
    gameSpec.replace('schemaVersion: 2', 'schemaVersion: 1'),
    gameSpec.replace('    ru: Зимняя история', '    ru: &title Story'),
    gameSpec.replace('  engine: phaser', '  engine: true'),
    gameSpec.replace('  platform: yandex-games', '  platform: 123'),
    gameSpec.replace('    ru: Зимняя история', '    ru: null'),
    gameSpec.replace('  slug: winter-story', '  slug: winter-story\n  slug : another'),
    gameSpec.replace('  slug: winter-story', '  slug: winter-story\n  "slug": another'),
    gameSpec.replace('schemaVersion: 2', 'schemaVersion: 2\nschemaVersion : 1'),
    gameSpec.replace('project:\n', 'project:\n').replace('game:\n', 'project : {slug: hijack}\ngame:\n'),
    gameSpec.replace('  engine: phaser', '  engine: phaser\n    extended'),
    gameSpec.replace('  platform: yandex-games', '  platform: yandex-games\n  ? platform\n  : vk-games'),
    gameSpec.replace('  platform: yandex-games', '  platform: yandex-games\n  "plat\\u0066orm": vk-games'),
    `${gameSpec}\n"pro\\u006aect": {slug: other-game, title: {en: Other}, platform: vk-games, engine: pixi}\n`,
    `${gameSpec}\n? project\n: {slug: other-game, title: {en: Other}, platform: vk-games, engine: pixi}\n`,
    `${gameSpec}\n"schema\\u0056ersion": 1\n`,
    gameSpec.replace('project:\n', '---\nproject:\n'),
    gameSpec.replace('schemaVersion: 2', 'schemaVersion: 2\n  continued'),
  ]) {
    fs.writeFileSync(path.join(root, 'game-spec.yaml'), invalid);
    assert.throws(() => readLegacyGameSpec(root), /schemaVersion|project|duplicate|unsupported|platform|title|slug/i);
  }
});

test('does not invent a version when package metadata is missing or invalid', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'winter-story' }));
  assert.throws(() => readLegacyGameSpec(root), /version/i);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: 'latest' }));
  assert.throws(() => readLegacyGameSpec(root), /version/i);
});

test('rejects symbolic links for legacy files', t => {
  const root = fixture(t);
  const source = path.join(root, 'real-spec.yaml');
  fs.renameSync(path.join(root, 'game-spec.yaml'), source);
  fs.symlinkSync(source, path.join(root, 'game-spec.yaml'));
  assert.throws(() => readLegacyGameSpec(root), /symbolic|symlink/i);
});
