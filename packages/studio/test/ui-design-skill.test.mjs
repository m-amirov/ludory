import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const skillUrl = new URL('../../../.agents/skills/ludory-ui-design/SKILL.md', import.meta.url);

function readSkill() {
  return fs.readFileSync(skillUrl, 'utf8').replace(/\r\n/g, '\n');
}

function checkIdentity(text) {
  const header = /^---\nname: (ludory-ui-design)\ndescription: (Use when [^\n]+)\n---\n/.exec(text);
  assert.ok(header, 'skill must have discoverable, narrow frontmatter');
  assert.ok(header[2].length < 500, 'description must remain a short activation trigger');
  assert.match(header[2], /game UI|game interface/i);
  assert.match(header[2], /HUD|menu/i);
  assert.ok(text.length < 16_000, 'bounded skill instruction size');
}

function checkDesignContract(text) {
  for (const part of [
    'player action', 'genre', 'typeface', 'Cyrillic', 'licence',
    'hierarchy', 'spacing', 'alignment', 'icon', 'safe area',
    'touch', 'keyboard', 'focus', 'loading', 'error', 'viewport',
    'first frame', 'screenshot', 'BLOCKED',
  ]) {
    assert.ok(text.toLowerCase().includes(part.toLowerCase()), `missing design concern: ${part}`);
  }
  assert.match(text, /typeface[^\n]*sizes[^\n]*line heights/i);
  assert.match(text, /Do not invent a timer, lives, currencies, difficulty, controls or screen/);
  assert.match(text, /[Nn]o (?:generic|default) (?:AI[- ]|glass|dashboard|template)/);
}

function checkAuthority(text) {
  const boundary = text.split('## Boundary\n')[1]?.split('\n## ')[0] ?? '';
  assert.match(boundary, /Use for \*\*new Studio-created games\*\* only/);
  assert.match(boundary, /Review-only requests stay read-only/);
  assert.match(boundary, /Require explicit authorization before editing/);
  assert.match(boundary, /frozen games/i);
  assert.match(boundary, /untrusted data/i);
  assert.match(boundary, /`ludory-visual-qa` assesses \*\*actual running-build pixel screenshots\*\*/);
  assert.match(boundary, /`ludory-asset-rights` checks actual font and image licence evidence/);
  assert.match(boundary, /Release PASS/);
  assert.match(text, /`BLOCKED: RUNTIME_PIXEL_CAPTURE_UNAVAILABLE`/);
  assert.match(text, /never fabricate a screenshot/i);
  assert.match(boundary, /External uploads or paid calls require separate scoped approval/);
  assert.doesNotMatch(text, /\bceos (?:context|capability-challenge|continue)\b|\.codex-os\b/i);
}

test('UI design skill is discoverable for game screens without hijacking other review domains', () => {
  checkIdentity(readSkill());
});

test('UI design skill gives concrete anti-generic typography, composition and state decisions', () => {
  checkDesignContract(readSkill());
});

test('UI design skill preserves read-only review, asset rights and live visual QA boundaries', () => {
  checkAuthority(readSkill());
});

test('UI design safety assertions detect removed approval or fake runtime pixel evidence', () => {
  const content = readSkill();
  checkAuthority(content);
  assert.throws(() => checkAuthority(content.replace(/review.only.*read.only/i,
    'Review-only requests may change files')));
  assert.throws(() => checkAuthority(content.replace(
    'Require explicit authorization before editing', 'Editing is allowed by default')));
  assert.throws(() => checkAuthority(content.replace(/Release PASS/g, 'release approved')));
  assert.throws(() => checkDesignContract(content.replace(/Cyrillic/g, 'Latin-only')));
  assert.throws(() => checkDesignContract(content.replace(
    'Do not invent a timer, lives, currencies, difficulty, controls or screen',
    'Invent a timer, lives, currencies, difficulty, controls or screen')));
  assert.throws(() => checkAuthority(content.replace(
    '`BLOCKED: RUNTIME_PIXEL_CAPTURE_UNAVAILABLE`', '`PASS: RUNTIME_PIXEL_CAPTURE_COMPLETE`')));
});
