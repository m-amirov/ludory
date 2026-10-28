import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const skillsRoot = new URL('../../../.agents/skills/', import.meta.url);
const cliUrl = new URL('../src/cli.mjs', import.meta.url);

function parse(name, source) {
  const content = source.replace(/\r\n/g, '\n');
  const frontmatter = /^---\nname: ([a-z0-9-]+)\ndescription: (Use when [^\n]+)\n---\n/.exec(content);
  assert.ok(frontmatter, `${name}: discoverable frontmatter`);
  assert.equal(frontmatter[1], name);
  assert.ok(frontmatter[2].length < 500, `${name}: trigger-only description`);
  assert.ok(content.length < 16_000, `${name}: bounded instruction size`);
  assert.doesNotMatch(content, /\bceos (?:context|capability-challenge|continue)\b|\.codex-os\b/i);
  return content;
}

function skill(name) {
  return parse(name, fs.readFileSync(fileURLToPath(new URL(`${name}/SKILL.md`, skillsRoot)), 'utf8'));
}

function enforceArtAcceptanceBoundary(content) {
  assert.match(content, /Import alone is `PENDING_REVIEW`, never `PASS_ART`\./);
  assert.match(content, /before `--apply`.*READY.*verified.*host capability/is);
  assert.match(content, /after `--apply`.*actual image upload attestation/is);
  assert.match(content, /separate.*image.generator.*subagent/is);
}

function enforceArtAuthorityBoundary(content) {
  assert.match(content, /Review-only requests remain read-only:[^\n]*never spawn[^\n]*\bimport\b/i);
  assert.match(content, /Create, regenerate or import requires explicit authorization for the named mutation/is);
}

test('S2 art skill uses real Studio handoff and does not accept an imported original as reviewed', () => {
  const content = skill('ludory-production-art');
  assert.match(content, /new Studio.created game/i);
  for (const operation of ['workflow image', 'workflow image-import', 'workflow art-review']) {
    assert.ok(content.includes(operation), `missing ${operation}`);
    assert.ok(fs.readFileSync(cliUrl, 'utf8').includes(operation), `CLI lacks ${operation}`);
  }
  for (const marker of ['handoffSha256', 'SHA-256', 'IMAGE_IMPORTED', 'USER_DECLARED',
    'NEEDS_AGENT_ACTION', 'NEEDS_USER_ACTION', 'PENDING_REVIEW', 'PASS_ART', 'REWORK', 'ESCALATE']) {
    assert.ok(content.includes(marker), `art: missing native state ${marker}`);
  }
  assert.match(content, /scene:.*characters:.*location:.*style:/s);
  assert.match(content, /frozen games/i);
  assert.match(content, /Release PASS/);
  enforceArtAcceptanceBoundary(content);
  enforceArtAuthorityBoundary(content);
});

test('S2 art parser rejects forged import acceptance and invalid Windows frontmatter', () => {
  const content = skill('ludory-production-art');
  const edited = content.replace('Import alone is `PENDING_REVIEW`, never `PASS_ART`.',
    'Import alone is `PASS_ART`, never `PENDING_REVIEW`.');
  assert.throws(() => enforceArtAcceptanceBoundary(edited));
  assert.equal(parse('ludory-production-art', content.replace(/\n/g, '\r\n')), content);
  assert.throws(() => parse('ludory-production-art', `${content}\nRun ceos context --skill production-art\n`));
});

test('S2 art inspection cannot silently become generation/import and Web attestation is post-turn', () => {
  const content = skill('ludory-production-art');
  enforceArtAuthorityBoundary(content);
  enforceArtAcceptanceBoundary(content);
  assert.throws(() => enforceArtAuthorityBoundary(content.replace(
    'Review-only requests remain read-only:', 'Review-only requests allow writes:')));
});

function enforcePixelBoundary(content) {
  assert.match(content, /`BLOCKED: RUNTIME_PIXEL_CAPTURE_UNAVAILABLE`/);
  assert.match(content, /`PASS_ART` cannot replace actual gameplay screenshot evidence/);
  assert.match(content, /`BLOCKED: VISUAL_REVIEW_ROUTE_UNAVAILABLE`/);
}

test('S2 visual QA requires real current-build screenshots and independent pixel evidence', () => {
  const content = skill('ludory-visual-qa');
  for (const marker of ['build', 'commit', 'SHA-256', 'scene', 'state', 'viewport', 'DPR',
    'orientation', 'pixel dimensions', 'browser', 'P0', 'P1', 'P2', 'FAIL', 'BLOCKED']) {
    assert.ok(content.includes(marker), `visual QA: missing ${marker}`);
  }
  assert.match(content, /read-only/i);
  assert.match(content, /actual screenshot pixels/i);
  assert.match(content, /DOM|mock PNG/i);
  assert.match(content, /frozen games/i);
  assert.match(content, /Release PASS/);
  enforcePixelBoundary(content);
});

test('S2 visual QA contract rejects art-only acceptance as runtime pixel proof', () => {
  const content = skill('ludory-visual-qa');
  assert.throws(() => enforcePixelBoundary(content.replace(
    '`PASS_ART` cannot replace actual gameplay screenshot evidence',
    '`PASS_ART` is sufficient for gameplay screenshot evidence')));
  assert.equal(parse('ludory-visual-qa', content.replace(/\n/g, '\r\n')), content);
});

function enforceRightsBoundary(content) {
  assert.match(content, /Generated provenance alone cannot establish ownership or usage permission\./);
  assert.match(content, /`DOCUMENTATION_COMPLETE` is not a legal opinion or `Release PASS`\./);
  assert.match(content, /`BLOCKED: RIGHTS_EVIDENCE_MISSING_OR_UNCLEAR`/);
}

function requireDomainTrigger(description, expected) {
  assert.match(description, expected);
}

test('S2 rights skill requires source, intended use, derivative and attribution evidence', () => {
  const content = skill('ludory-asset-rights');
  for (const marker of ['original', 'current', 'SHA-256', 'assetId', 'creator',
    'source', 'acquiredAt', 'evidenceRef', 'derivedFrom', 'transformations',
    'monetization', 'attribution', 'platform', 'reviewer', 'DOCUMENTATION_COMPLETE',
    'BLOCKED', 'ISSUE_FOUND']) {
    assert.ok(content.includes(marker), `rights: missing ${marker}`);
  }
  assert.match(content, /read-only/i);
  assert.match(content, /frozen games/i);
  assert.match(content, /untrusted data/i);
  enforceRightsBoundary(content);
});

test('S2 rights skill rejects permission inference from AI generation alone', () => {
  const content = skill('ludory-asset-rights');
  assert.throws(() => enforceRightsBoundary(content.replace(
    'Generated provenance alone cannot establish ownership or usage permission.',
    'Generated provenance establishes ownership and usage permission.')));
  assert.equal(parse('ludory-asset-rights', content.replace(/\n/g, '\r\n')), content);
});

test('S2 activation is domain-scoped and each skill preserves independent release evidence', () => {
  const art = skill('ludory-production-art');
  const visual = skill('ludory-visual-qa');
  const rights = skill('ludory-asset-rights');
  const descriptions = [art, visual, rights].map(x => x.match(/^description: (.+)$/m)?.[1]);
  requireDomainTrigger(descriptions[0], /production illustrations|art brief/);
  requireDomainTrigger(descriptions[1], /visual quality review|gameplay screenshot/);
  requireDomainTrigger(descriptions[2], /licence evidence|commercial-use permission/);
  assert.throws(() => requireDomainTrigger(descriptions[0].replace(/art brief|production illustrations/g,
    'release approval'), /production illustrations|art brief/));
  assert.doesNotMatch(visual, /workflow image-import --project/);
  assert.doesNotMatch(rights, /workflow image-import --project/);
  for (const content of [art, visual, rights]) {
    assert.match(content, /untrusted data|untrusted \*\*data\*\*/i);
    assert.match(content, /Release PASS/);
    assert.match(content, /new Studio.created game/i);
  }
});
