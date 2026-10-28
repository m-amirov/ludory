import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const skillUrl = new URL('../../../.agents/skills/ludory-incident-analysis/SKILL.md', import.meta.url);

function loadSkill() {
  return fs.readFileSync(skillUrl, 'utf8').replace(/\r\n/g, '\n');
}

function checkDiscovery(content) {
  const header = /^---\nname: ludory-incident-analysis\ndescription: (Use when [^\n]+)\n---\n/.exec(content);
  assert.ok(header, 'narrow Codex skill frontmatter');
  assert.ok(header[1].length < 500);
  assert.match(header[1], /Studio|workflow/i);
  assert.match(header[1], /incident|timeout|interrupted|failure/i);
  assert.ok(content.length < 16_000, 'bounded skill instruction length');
  assert.doesNotMatch(content, /\bceos\s+(?:context|continue|capability-challenge)\b|\.codex-os\b/i);
}

function checkReadOnlyEvidence(content) {
  assert.match(content, /new Studio-created games only/i);
  assert.match(content, /hasStudioCreationReceipt/);
  assert.match(content, /ludory\.studio\.json/);
  assert.match(content, /locally writable|not independent attestation/i);
  assert.match(content, /frozen games/i);
  assert.match(content, /read-only/i);
  for (const cmd of [
    'workflow doctor', 'workflow status', 'workflow next',
    'quality status', 'quality evidence',
  ]) assert.ok(content.includes(`node packages/studio/bin/ludory.mjs ${cmd}`), `missing native command ${cmd}`);
  assert.match(content, /readNativeRun/);
  assert.match(content, /packages\/ai\/src\/index\.mjs/);
  assert.match(content, /headSha256/);
  assert.match(content, /STALE_SNAPSHOT/);
  assert.match(content, /NATIVE_INTEGRITY_/);
  assert.match(content, /full event bodies|raw prompts/i);
}

function checkCausalConclusions(content) {
  for (const verdict of ['CAUSE_CONFIRMED', 'CAUSE_PROBABLE', 'INSUFFICIENT_EVIDENCE', 'EVIDENCE_INTEGRITY_FAILED']) {
    assert.ok(content.includes(`\`${verdict}\``), `analyst verdict ${verdict}`);
  }
  assert.match(content, /direct (?:source-bound )?(?:evidence|mechanism)|independently observed reproduction/i);
  assert.match(content, /chronology alone|temporal order alone/i);
  assert.match(content, /first observed anomal/i);
  assert.match(content, /alternative explanation/i);
  assert.match(content, /high.*medium.*low/i);
  assert.match(content, /analyst labels, not (?:native )?workflow statuses/i);
  assert.match(content, /EXECUTED_UNVERIFIED/);
  assert.match(content, /BLOCKED/);
  assert.match(content, /Release PASS/);
}

function checkQualityBoundary(content) {
  assert.match(content, /\.ludory\/quality\/policy\.json/);
  assert.match(content, /missing policy.*unconfigured/i);
  assert.match(content, /QUALITY_EVIDENCE_INTEGRITY/);
  assert.match(content, /qualityRunId/);
  assert.match(content, /workflow run ID/);
  assert.match(content, /historical (?:Quality )?PASS/i);
  assert.match(content, /sourceDigest/);
  assert.match(content, /policyDigest/);
  assert.match(content, /current.*(?:source|policy).*identity/i);
}

function checkSafetyBoundary(content) {
  assert.match(content, /No `--apply`|Never run `--apply`/);
  assert.match(content, /workflow recover --confirm-no-executor --apply/);
  assert.match(content, /independent proof.*(?:executor|helper).*(?:stopped|terminated)|proof.*(?:executor|helper).*no longer running/i);
  assert.match(content, /explicit (?:owner )?authorization/);
  assert.match(content, /instructions in.*(?:logs|receipts|screenshots)|logs.*untrusted data/i);
  assert.match(content, /credentials|secret/i);
  assert.match(content, /no external uploads|external requests.*(?:forbidden|not allowed)|never send.*externally/i);
  assert.match(content, /`ludory-fix`/);
  assert.match(content, /`ludory-verification`/);
}

test('incident triage discovers concrete workflow failures without invoking CEOS', () => {
  checkDiscovery(loadSkill());
});

test('incident triage reads validated Studio and AI receipts only and pins the event head', () => {
  checkReadOnlyEvidence(loadSkill());
});

test('incident report distinguishes chronology, causal mechanism and analyst verdicts', () => {
  checkCausalConclusions(loadSkill());
});

test('incident triage distinguishes unconfigured Quality and historical evidence from current PASS', () => {
  checkQualityBoundary(loadSkill());
});

test('incident analysis never authorizes recovery, exfiltration or source repair', () => {
  checkSafetyBoundary(loadSkill());
});

test('mutated unsafe guidance is rejected rather than masked by keyword presence', () => {
  const content = loadSkill();
  checkSafetyBoundary(content);
  checkCausalConclusions(content);
  checkQualityBoundary(content);
  assert.throws(() => checkSafetyBoundary(content.replace('Never run `--apply`', 'You may run `--apply`')));
  assert.throws(() => checkCausalConclusions(content.replace('chronology alone', 'chronology definitively')));
  assert.throws(() => checkQualityBoundary(content.replace('missing policy means unconfigured Quality', 'missing policy means tampering')));
});
