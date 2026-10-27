import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../.agents/skills/ludory-narrative-review/', import.meta.url);
const read = name => fs.readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

test('Codex discovers a repo-local narrative skill with research-grounded, actionable guidance', () => {
  const skill = read('SKILL.md');
  const frontmatter = /^---\r?\nname: ludory-narrative-review\r?\ndescription: Use when /;
  assert.match(skill, frontmatter);
  // Git checks out Markdown with CRLF on Windows, even though the blob uses LF.
  assert.match(skill.replace(/\r?\n/g, '\r\n'), frontmatter);
  for (const trigger of ['episode-script', 'visual novel', 'branch', 'review']) assert.ok(skill.includes(trigger));
  for (const rule of ['NARRATIVE_REVIEW_REQUESTED', 'NARRATIVE_REVIEW_RESULT', 'REWORK',
    'BLOCKED', 'SHA-256', 'P0', 'P1', 'P2']) assert.ok(skill.includes(rule));
  assert.match(skill, /references\/storyscope\.md/);
});

test('research reference makes correlations advisory and avoids author detection and formulaic quotas', () => {
  const rubric = read('references/storyscope.md');
  assert.match(rubric, /2604\.03136/);
  assert.match(rubric, /93\.2%/);
  assert.match(rubric, /not an AI detector|not a detector/i);
  assert.match(rubric, /flashback/i);
  assert.match(rubric, /choice/i);
});
