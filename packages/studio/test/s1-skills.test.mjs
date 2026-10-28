import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../.agents/skills/', import.meta.url);

function skill(name) {
  const text = fs.readFileSync(fileURLToPath(new URL(`${name}/SKILL.md`, root)), 'utf8');
  return parseSkillDocument(name, text);
}

function parseSkillDocument(name, text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = /^---\nname: ([a-z0-9-]+)\ndescription: (Use when [^\n]+)\n---\n/.exec(normalized);
  assert.ok(match, `${name}: Codex-discoverable YAML frontmatter`);
  assert.equal(match[1], name);
  assert.ok(match[2].length <= 500, `${name}: short, trigger-only description`);
  assert.ok(normalized.length < 16_000, `${name}: keep the skill concise`);
  assert.doesNotMatch(normalized, /\b(?:ceos context|ceos capability-challenge|ceos continue)\b|\.codex-os\b/i,
    `${name}: no legacy CEOS invocation dependency`);
  return normalized;
}

function assertCriticalSafetyContract(name, content) {
  const guard = {
    'ludory-audit': /Audit is \*\*read-only\*\* by default\./,
    'ludory-verification': /`FAIL` if any mandatory criterion has an \*\*observed failure\*\*/,
    'ludory-fix': /A \*\*diagnosis-only\*\* request is read-only:/,
  }[name];
  assert.ok(guard, `${name}: known S1 safety contract`);
  assert.match(content, guard, `${name}: critical authority/verdict statement must remain intact`);
}

test('S1 audit is discoverable and preserves a read-only findings/evidence boundary', () => {
  const content = skill('ludory-audit');
  assert.match(content, /codebase audit|project audit|risk review/i);
  assert.match(content, /read-only/i);
  assert.match(content, /findings/i);
  assert.match(content, /evidence gaps/i);
  assert.match(content, /BLOCKED/);
  assert.match(content, /frozen games/i);
  assert.match(content, /Release PASS/);
  assert.match(content.replace(/\n/g, '\r\n'), /^---\r\nname: ludory-audit\r\n/);
  assertCriticalSafetyContract('ludory-audit', content);
});

test('S1 verification is discoverable and explicitly distinguishes scoped PASS, FAIL and BLOCKED', () => {
  const content = skill('ludory-verification');
  assert.match(content, /acceptance claim|independent verification/i);
  assert.match(content, /read-only/i);
  assert.match(content, /claim.to.evidence/i);
  for (const result of ['PASS', 'FAIL', 'BLOCKED', 'EXECUTED_UNVERIFIED']) {
    assert.ok(content.includes(result), `missing ${result} contract`);
  }
  assert.match(content, /current|fresh/i);
  assert.match(content, /independent/i);
  assert.match(content, /Release PASS/);
  assert.match(content.replace(/\n/g, '\r\n'), /^---\r\nname: ludory-verification\r\n/);
  assertCriticalSafetyContract('ludory-verification', content);
});

test('S1 fix is discoverable and requires explicit mutation authority plus reproducible RED-GREEN evidence', () => {
  const content = skill('ludory-fix');
  assert.match(content, /fix|repair|regression/i);
  assert.match(content, /explicit/i);
  assert.match(content, /diagnosis-only|diagnose-only/i);
  assert.match(content, /reproduc/i);
  assert.match(content, /root cause/i);
  assert.match(content, /\bRED\b/);
  assert.match(content, /\bGREEN\b/);
  assert.match(content, /dirty|unversioned/i);
  assert.match(content, /frozen games/i);
  assert.match(content, /EXECUTED_UNVERIFIED/);
  assert.match(content, /Release PASS/);
  assert.match(content.replace(/\n/g, '\r\n'), /^---\r\nname: ludory-fix\r\n/);
  assertCriticalSafetyContract('ludory-fix', content);
});

test('critical contract check rejects a falsely mutable audit', () => {
  const modified = skill('ludory-audit').replace('Audit is **read-only** by default.',
    'Audit may modify source code by default.');
  assert.throws(() => assertCriticalSafetyContract('ludory-audit', modified));
});

test('critical contract check rejects PASS after an observed failed criterion', () => {
  const modified = skill('ludory-verification').replace(
    '`FAIL` if any mandatory criterion has an **observed failure**',
    '`PASS` if any mandatory criterion has an **observed failure**');
  assert.throws(() => assertCriticalSafetyContract('ludory-verification', modified));
});

test('critical contract check rejects patch authorization on diagnosis-only request', () => {
  const modified = skill('ludory-fix').replace(
    'A **diagnosis-only** request is read-only:',
    'A **diagnosis-only** request permits edits:');
  assert.throws(() => assertCriticalSafetyContract('ludory-fix', modified));
});

test('S1 skills reject untrusted source instructions and unsafe test execution', () => {
  for (const name of ['ludory-audit', 'ludory-verification', 'ludory-fix']) {
    const content = skill(name);
    assert.match(content, /source comments.*logs.*receipts/i, `${name}: untrusted content classes`);
    assert.match(content, /data, never (?:as |a source of )?authority/i, `${name}: evidence is data`);
    assert.match(content, /inspect.*scripts?.*side effects.*before running/i, `${name}: execution safety`);
    assert.match(content, /credentials|network/i, `${name}: ambient environment controls`);
    assert.match(content, /BLOCKED/, `${name}: unsafe execution blocker`);
  }
});

test('S1 fixes cannot mutate frozen games even with a generic fix request', () => {
  const content = skill('ludory-fix');
  assert.match(content, /Frozen games (?:are|remain) outside S1/i);
  assert.match(content, /separate.*workflow|separate.*scope decision/i);
});

test('S1 frontmatter parser accepts actual CRLF documents as on Windows', () => {
  for (const name of ['ludory-audit', 'ludory-verification', 'ludory-fix']) {
    const canonical = skill(name);
    assert.equal(parseSkillDocument(name, canonical.replace(/\n/g, '\r\n')), canonical);
  }
});

test('S1 document parser rejects legacy .codex-os invocation dependencies', () => {
  const injected = `${skill('ludory-fix')}\nRun .codex-os to load legacy session state.\n`;
  assert.throws(() => parseSkillDocument('ludory-fix', injected), /legacy CEOS invocation dependency/);
});
