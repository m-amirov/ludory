import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const skillPath = fileURLToPath(new URL('../../../.agents/skills/ludory-engineering-quality/SKILL.md', import.meta.url));

test('repository-local Engineering Quality skill is discoverable and documents bounded evidence rules', () => {
  const text = fs.readFileSync(skillPath, 'utf8');
  assert.match(text, /^---\r?\nname: ludory-engineering-quality\r?\n/m);
  assert.match(text.replace(/\r?\n/g, '\r\n'), /^---\r?\nname: ludory-engineering-quality\r?\n/m,
    'CRLF checkout should be accepted on Windows');
  assert.match(text, /^description: Use when /m);
  for (const command of ['quality enable', 'quality check', 'quality status', 'quality evidence']) {
    assert.ok(text.includes(command), `missing ${command}`);
  }
  assert.match(text, /first.*test|test.*first/i);
  assert.match(text, /root cause/i);
  assert.match(text, /CRAP < 10/i);
  assert.match(text, /mutat/i);
  assert.match(text, /source.bound|SHA-256/i);
  assert.match(text, /Release PASS/i);
  assert.match(text, /global/i);
});
